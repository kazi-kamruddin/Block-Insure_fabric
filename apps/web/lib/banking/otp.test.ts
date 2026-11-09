import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OtpChallengeStore } from "./otp";
import { premiumOtpBinding } from "./premium-intent";

const secret = "test-secret-that-is-longer-than-thirty-two-characters";
const binding = { policyId: "policy-1", sourceAccountId: "account-1", subjectId: "policyholder1" };
const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("manual premium OTP challenges", () => {
  it("binds a one-time challenge to its policyholder, policy, and source account", () => {
    const store = new OtpChallengeStore();
    const challenge = store.issue(binding, secret, 60, 1_000, { id: "challenge-1", code: "123456" });
    expect(() => store.consume(challenge.challengeId, "123456", binding, secret, 2_000)).not.toThrow();
    expect(() => store.consume(challenge.challengeId, "123456", binding, secret, 2_000)).toThrow(/invalid or expired/);
  });

  it("rejects altered bindings and expired challenges", () => {
    const store = new OtpChallengeStore();
    store.issue(binding, secret, 60, 1_000, { id: "challenge-2", code: "654321" });
    expect(() => store.consume("challenge-2", "654321", { ...binding, policyId: "policy-2" }, secret, 2_000)).toThrow(/invalid or expired/);
    expect(() => store.consume("challenge-2", "654321", binding, secret, 62_000)).toThrow(/invalid or expired/);
  });

  it("retains attempts and single consumption across independent process-store instances", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "fabric-otp-test-"));
    temporaryDirectories.push(directory);
    new OtpChallengeStore(directory).issue(binding, secret, 60, 1000, { id: "durable", code: "123456" });
    for (let n = 0; n < 4; n++) expect(() => new OtpChallengeStore(directory).consume("durable", "000000", binding, secret, 2000)).toThrow();
    new OtpChallengeStore(directory).consume("durable", "123456", binding, secret, 2000);
    expect(() => new OtpChallengeStore(directory).consume("durable", "123456", binding, secret, 2000)).toThrow();
    const saved = JSON.parse(readFileSync(path.join(directory, "challenges.json"), "utf8"));
    expect(saved.body.challenges).toEqual([]);
  });

  it("invalidates replaced codes and detects persisted-state tampering", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "fabric-otp-test-"));
    temporaryDirectories.push(directory);
    const store = new OtpChallengeStore(directory);
    store.issue(binding, secret, 60, 1000, { id: "old", code: "123456" });
    store.issue(binding, secret, 60, 1000, { id: "new", code: "654321" });
    expect(() => store.consume("old", "123456", binding, secret, 2000)).toThrow();
    const filename = path.join(directory, "challenges.json");
    const saved = JSON.parse(readFileSync(filename, "utf8"));
    saved.body.challenges[0][1].attempts = -100;
    writeFileSync(filename, JSON.stringify(saved));
    expect(() => new OtpChallengeStore(directory).consume("new", "654321", binding, secret, 2000)).toThrow(/authentication/);
  });

  it("binds amount, recipient, installment and operation IDs to authorization", () => {
    const payment = { policyId: "policy-1", sourceAccountId: "account-1", destinationAccountId: "insurer-1", transferId: "transfer-1", paymentId: "payment-1",
      periodStartDate: "2026-01-01", periodEndDate: "2026-01-30", amountMinor: 1000, externalReferenceHash: "a".repeat(64) };
    const original = premiumOtpBinding(payment, binding.subjectId, "holder@example.invalid");
    for (const changed of [{ ...payment, amountMinor: 1001 }, { ...payment, transferId: "other-transfer" }, { ...payment, periodEndDate: "2026-02-01" }, { ...payment, destinationAccountId: "other-insurer" }]) {
      const store = new OtpChallengeStore();
      store.issue(original, secret, 60, 1000, { id: "intent", code: "123456" });
      expect(() => store.consume("intent", "123456", premiumOtpBinding(changed, binding.subjectId, original.recipient), secret, 2000)).toThrow();
    }
    const store = new OtpChallengeStore();
    store.issue(original, secret, 60, 1000, { id: "recipient", code: "123456" });
    expect(() => store.consume("recipient", "123456", { ...original, recipient: "different@example.invalid" }, secret, 2000)).toThrow();
  });
});
