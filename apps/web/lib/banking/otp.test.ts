import { describe, expect, it } from "vitest";
import { OtpChallengeStore } from "./otp";

const secret = "test-secret-that-is-longer-than-thirty-two-characters";
const binding = { policyId: "policy-1", sourceAccountId: "account-1", subjectId: "policyholder1" };

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
});
