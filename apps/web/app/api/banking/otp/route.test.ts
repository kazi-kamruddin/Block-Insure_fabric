import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn(async () => ({ role: "policyholder", subjectId: "holder1", accountId: "holder1" })), sessionSecret: () => "synthetic-session-secret-at-least-32-characters" }));
vi.mock("@/lib/auth/accounts", () => ({ findDemoAccount: () => ({ email: "holder@example.invalid" }) }));
vi.mock("@/lib/security/request-origin", () => ({ checkMutationOrigin: () => ({ trusted: true }) }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { readPolicy: vi.fn(), readBankAccountReference: vi.fn() } }));
vi.mock("@/lib/banking/otp", () => ({ otpChallenges: { issue: vi.fn(), revoke: vi.fn() } }));
vi.mock("@/lib/banking/email-gateway", () => ({ deliverBankOtp: vi.fn() }));
import { ledger } from "@/lib/fabric/ledger";
import { otpChallenges } from "@/lib/banking/otp";
import { deliverBankOtp } from "@/lib/banking/email-gateway";
import { POST } from "./route";
const intent = { policyId: "policy-test", sourceAccountId: "customer-test", destinationAccountId: "insurer-test", transferId: "transfer-test", paymentId: "payment-test",
  periodStartDate: "2026-01-01", periodEndDate: "2026-01-30", amountMinor: 1000, externalReferenceHash: "a".repeat(64) };
const request = (data = intent) => new Request("http://localhost/api/banking/otp", { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" } });
describe("recipient-bound OTP delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(ledger.readPolicy).mockResolvedValue({ policyholderId: "holder1", premiumMinor: 1000, bankIds: ["bank-test"] } as never);
    vi.mocked(ledger.readBankAccountReference).mockImplementation(async (id) => ({ id, ownerId: id === "customer-test" ? "holder1" : "insurer", accountType: id === "customer-test" ? "CUSTOMER" : "INSURER", status: "VERIFIED", bankId: "bank-test" } as never));
    vi.mocked(otpChallenges.issue).mockReturnValue({ challengeId: "00000000-0000-4000-8000-000000000001", code: "123456", expiresAt: Date.now() + 60000 });
  });
  it("revokes a challenge when delivery fails without returning a usable OTP", async () => {
    vi.mocked(deliverBankOtp).mockRejectedValue(new Error("delivery unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(otpChallenges.revoke).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain("123456");
  });
  it("rejects mismatched premium amounts before issuing a challenge", async () => {
    expect((await POST(request({ ...intent, amountMinor: 2000 }))).status).toBe(403);
    expect(otpChallenges.issue).not.toHaveBeenCalled();
    expect(deliverBankOtp).not.toHaveBeenCalled();
  });
});
