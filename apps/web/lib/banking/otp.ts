import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

type Challenge = {
  policyId: string;
  sourceAccountId: string;
  subjectId: string;
  digest: string;
  expiresAt: number;
  attempts: number;
};

export type OtpBinding = Pick<Challenge, "policyId" | "sourceAccountId" | "subjectId">;

function digest(challengeId: string, code: string, secret: string) {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest();
}

export class OtpChallengeStore {
  private readonly challenges = new Map<string, Challenge>();

  issue(
    binding: OtpBinding,
    secret: string,
    ttlSeconds = 300,
    now = Date.now(),
    generated: { id: string; code: string } = { id: randomUUID(), code: String(randomInt(0, 1_000_000)).padStart(6, "0") },
  ) {
    if (secret.length < 32) throw new Error("OTP secret must contain at least 32 characters");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
      throw new Error("OTP TTL must be between 30 and 900 seconds");
    }
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
    this.challenges.set(generated.id, {
      ...binding,
      digest: digest(generated.id, generated.code, secret).toString("hex"),
      expiresAt: now + ttlSeconds * 1_000,
      attempts: 0,
    });
    return { challengeId: generated.id, code: generated.code, expiresAt: now + ttlSeconds * 1_000 };
  }

  consume(challengeId: string, code: string, binding: OtpBinding, secret: string, now = Date.now()) {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.expiresAt <= now || challenge.attempts >= 5) {
      this.challenges.delete(challengeId);
      throw new Error("The OTP challenge is invalid or expired");
    }
    challenge.attempts += 1;
    const expected = Buffer.from(challenge.digest, "hex");
    const supplied = digest(challengeId, code, secret);
    const bindingMatches = challenge.policyId === binding.policyId
      && challenge.sourceAccountId === binding.sourceAccountId
      && challenge.subjectId === binding.subjectId;
    if (!bindingMatches || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      if (challenge.attempts >= 5) this.challenges.delete(challengeId);
      throw new Error("The OTP challenge is invalid or expired");
    }
    this.challenges.delete(challengeId);
  }
}

const globalOtp = globalThis as typeof globalThis & { blockInsureOtpStore?: OtpChallengeStore };
export const otpChallenges = globalOtp.blockInsureOtpStore ??= new OtpChallengeStore();
