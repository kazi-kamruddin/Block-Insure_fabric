import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { readPolicy: vi.fn() } }));
vi.mock("@/lib/banking/email-gateway", () => ({ deliverBankCommunication: vi.fn() }));
import { ledger } from "@/lib/fabric/ledger";
import { deliverBankCommunication } from "@/lib/banking/email-gateway";
import { appendProjectedEvent, readEventProjection, updateProjectedCommunication } from "./store";
import { CustomerStore } from "@/lib/customers/store";
import { deliverPendingBankCommunications } from "./deliver-communications";

let root: string;
const event = { id: "1:tx:BankTransferProcessed", transactionId: "tx", blockNumber: "1", eventName: "BankTransferProcessed",
  payload: { id: "transfer-1", policyId: "policy-1", method: "OTP", status: "SETTLED", amountMinor: 10000 } };

beforeEach(async () => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-notify-"));
  vi.stubEnv("EVENT_PROJECTION_ROOT", path.join(root, "events"));
  vi.stubEnv("CUSTOMER_STATE_ROOT", path.join(root, "customers"));
  vi.stubEnv("DEV_LITE_ONBOARDING", "true");
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  await appendProjectedEvent(event);
  vi.mocked(ledger.readPolicy).mockResolvedValue({ policyholderId: "unmapped-owner" } as Awaited<ReturnType<typeof ledger.readPolicy>>);
  vi.mocked(deliverBankCommunication).mockResolvedValue({ adapter: "email-gateway", recipient: "configured@example.invalid", messageId: "message-1" });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it("does not send an unmapped owner's receipt to a generic fallback", async () => {
  vi.stubEnv("POLICYHOLDER_TRANSACTION_EMAIL", "someone-else@example.invalid");
  try {
    expect(await deliverPendingBankCommunications()).toEqual({ delivered: 0, failed: 1 });
    expect(deliverBankCommunication).not.toHaveBeenCalled();
    expect((await readEventProjection()).communications[0]).toMatchObject({ status: "PENDING", deliveryAttempts: 1 });
  } finally { vi.unstubAllEnvs(); }
});

it("resolves an onboarded policyholder and delivers each event and recipient once", async () => {
  const memberId = "BI-01234567";
  vi.mocked(ledger.readPolicy).mockResolvedValue({ policyholderId: memberId } as Awaited<ReturnType<typeof ledger.readPolicy>>);
  await new CustomerStore().update(rows => rows.push({
    memberId, email: "member@example.invalid", status: "ACTIVE", createdAt: "2026-11-24T00:00:00Z",
  }));
  vi.mocked(deliverBankCommunication).mockResolvedValue({ adapter: "email-gateway", recipient: "member@example.invalid", messageId: "m1" });
  await Promise.all([deliverPendingBankCommunications(), deliverPendingBankCommunications()]);
  await appendProjectedEvent(event);
  await deliverPendingBankCommunications();
  expect(deliverBankCommunication).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    recipient: "member@example.invalid", idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect((await readEventProjection()).communications[0]).toMatchObject({ status: "DELIVERED" });
});

it("backs off, uses the same delivery key, and stops after five attempts", async () => {
  vi.stubEnv("POLICYHOLDER_TRANSACTION_EMAIL", "configured@example.invalid");
  vi.stubEnv("POLICYHOLDER_TRANSACTION_SUBJECT", "unmapped-owner");
  vi.mocked(deliverBankCommunication).mockRejectedValue(new Error("delivery transport unavailable"));
  let now = Date.parse("2026-11-25T00:00:00Z");
  for (let attempt = 1; attempt <= 5; attempt++) {
    await deliverPendingBankCommunications(() => now);
    const row = (await readEventProjection()).communications[0];
    expect(row).toMatchObject({ deliveryAttempts: attempt, status: attempt < 5 ? "PENDING" : "FAILED" });
    if (attempt < 5) {
      expect(Date.parse(row.nextAttemptAt!) - now).toBe(5_000 * 2 ** (attempt - 1));
      await deliverPendingBankCommunications(() => now);
      expect(deliverBankCommunication).toHaveBeenCalledTimes(attempt);
      now = Date.parse(row.nextAttemptAt!);
    }
  }
  await deliverPendingBankCommunications(() => now + 60_000);
  expect(deliverBankCommunication).toHaveBeenCalledTimes(5);
  expect(new Set(vi.mocked(deliverBankCommunication).mock.calls.map(([input]) => input.idempotencyKey)).size).toBe(1);
  const files = await fs.readdir(path.join(root, "events", "dead-letter"));
  expect(files).toHaveLength(1);
  const failed = JSON.parse(await fs.readFile(path.join(root, "events", "dead-letter", files[0]), "utf8"));
  expect(failed).toMatchObject({ eventId: event.id, status: "FAILED", deliveryAttempts: 5 });
});

it("dead-letters an interrupted fifth attempt without attempting a sixth delivery", async () => {
  const row = (await readEventProjection()).communications[0];
  await updateProjectedCommunication(row.id, {
    deliveryAttempts: 5, nextAttemptAt: "2026-11-25T00:00:00Z",
  });
  await deliverPendingBankCommunications(() => Date.parse("2026-11-25T00:01:00Z"));
  expect(deliverBankCommunication).not.toHaveBeenCalled();
  expect((await readEventProjection()).communications[0]).toMatchObject({ deliveryAttempts: 5, status: "FAILED" });
  expect(await fs.readdir(path.join(root, "events", "dead-letter"))).toHaveLength(1);
});
