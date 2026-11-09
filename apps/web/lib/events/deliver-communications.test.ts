import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { readPolicy: vi.fn() } }));
vi.mock("@/lib/banking/email-gateway", () => ({ deliverBankCommunication: vi.fn() }));
vi.mock("./store", () => ({ readEventProjection: vi.fn(), updateProjectedCommunication: vi.fn() }));
import { ledger } from "@/lib/fabric/ledger";
import { deliverBankCommunication } from "@/lib/banking/email-gateway";
import { readEventProjection, updateProjectedCommunication } from "./store";
import { applyFabricEvent, emptyEventProjection } from "./projection";
import { deliverPendingBankCommunications } from "./deliver-communications";

beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  const projection = applyFabricEvent(emptyEventProjection(), { id: "1:tx:BankTransferProcessed", transactionId: "tx", blockNumber: "1", eventName: "BankTransferProcessed", payload: { id: "transfer-1", policyId: "policy-1", method: "OTP", status: "SETTLED", amountMinor: 10000 } }, "2026-11-09T00:00:00Z");
  vi.mocked(readEventProjection).mockResolvedValue(projection);
  vi.mocked(ledger.readPolicy).mockResolvedValue({ policyholderId: "unmapped-owner" } as Awaited<ReturnType<typeof ledger.readPolicy>>);
  vi.mocked(deliverBankCommunication).mockResolvedValue({ adapter: "email-gateway", recipient: "configured@example.invalid", messageId: "message-1" });
});

it("fails visibly rather than sending an unmapped owner's receipt to a generic fallback", async () => {
  vi.stubEnv("POLICYHOLDER_TRANSACTION_EMAIL", "someone-else@example.invalid");
  try {
    expect(await deliverPendingBankCommunications()).toEqual({ delivered: 0, failed: 1 });
    expect(deliverBankCommunication).not.toHaveBeenCalled();
    expect(updateProjectedCommunication).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: "FAILED" }));
  } finally { vi.unstubAllEnvs(); }
});

it("binds configured recipients to the ledger subject and retry keys to deployment and event", async () => {
  vi.stubEnv("POLICYHOLDER_TRANSACTION_EMAIL", "configured@example.invalid");
  vi.stubEnv("POLICYHOLDER_TRANSACTION_SUBJECT", "unmapped-owner");
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-delivery-test");
  try {
    await deliverPendingBankCommunications(); await deliverPendingBankCommunications();
    const calls = vi.mocked(deliverBankCommunication).mock.calls;
    expect(calls[0][0]).toMatchObject({ recipient: "configured@example.invalid", idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(calls[1][0]).toEqual(calls[0][0]);
    vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-another-deployment");
    await deliverPendingBankCommunications();
    expect(vi.mocked(deliverBankCommunication).mock.calls[2][0]).not.toEqual(calls[0][0]);
  } finally { vi.unstubAllEnvs(); }
});
