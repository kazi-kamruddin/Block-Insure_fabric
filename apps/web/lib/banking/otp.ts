import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

type Challenge = {
  policyId: string;
  sourceAccountId: string;
  subjectId: string;
  digest: string;
  expiresAt: number;
  attempts: number;
  bindingHash: string;
};

export type OtpBinding = Pick<Challenge, "policyId" | "sourceAccountId" | "subjectId"> & { intentHash?: string; recipient?: string };
const bindingHash = (binding: OtpBinding) => createHash("sha256").update(JSON.stringify(Object.entries(binding).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");

function digest(challengeId: string, code: string, secret: string) {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest();
}

export class OtpChallengeStore {
  private readonly challenges = new Map<string, Challenge>();
  constructor(private readonly directory?: string) {}

  private mutate<T>(secret: string, action: () => T): T {
    if (!this.directory) return action();
    mkdirSync(this.directory, { recursive: true });
    const statePath = path.join(this.directory, "challenges.json");
    const lockPath = path.join(this.directory, "challenges.lock");
    let lock: number;
    try { lock = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(readFileSync(lockPath, "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("OTP state lock requires recovery");
      try { process.kill(owner, 0); throw new Error("OTP state is busy; retry"); }
      catch (ownerError) { if ((ownerError as NodeJS.ErrnoException).code !== "ESRCH") throw ownerError; }
      unlinkSync(lockPath);
      lock = openSync(lockPath, "wx", 0o600);
    }
    try {
      writeFileSync(lock, String(process.pid));
      fsyncSync(lock);
      this.challenges.clear();
      if (existsSync(statePath)) {
        const stored = JSON.parse(readFileSync(statePath, "utf8")) as { body: { version: number; challenges: Array<[string, Challenge]> }; mac: string };
        const expected = createHmac("sha256", secret).update(JSON.stringify(stored.body)).digest();
        const supplied = Buffer.from(stored.mac, "hex");
        if (stored.body.version !== 1 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("OTP state authentication failed");
        for (const [id, value] of stored.body.challenges) this.challenges.set(id, value);
      }
      try { return action(); }
      finally {
        const body = { version: 1, challenges: [...this.challenges] };
        const state = { body, mac: createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex") };
        const temporary = `${statePath}.${process.pid}.tmp`;
        const handle = openSync(temporary, "w", 0o600);
        try { writeFileSync(handle, JSON.stringify(state)); fsyncSync(handle); }
        finally { closeSync(handle); }
        renameSync(temporary, statePath);
      }
    } finally { closeSync(lock); unlinkSync(lockPath); }
  }

  issue(
    binding: OtpBinding,
    secret: string,
    ttlSeconds = 300,
    now = Date.now(),
    generated: { id: string; code: string } = { id: randomUUID(), code: String(randomInt(0, 1_000_000)).padStart(6, "0") },
  ) {
    return this.mutate(secret, () => this.issueInMemory(binding, secret, ttlSeconds, now, generated));
  }

  private issueInMemory(binding: OtpBinding, secret: string, ttlSeconds: number, now: number, generated: { id: string; code: string }) {
    if (secret.length < 32) throw new Error("OTP secret must contain at least 32 characters");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
      throw new Error("OTP TTL must be between 30 and 900 seconds");
    }
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now || (challenge.subjectId === binding.subjectId && challenge.policyId === binding.policyId)) this.challenges.delete(id);
    }
    this.challenges.set(generated.id, {
      ...binding,
      bindingHash: bindingHash(binding),
      digest: digest(generated.id, generated.code, secret).toString("hex"),
      expiresAt: now + ttlSeconds * 1_000,
      attempts: 0,
    });
    return { challengeId: generated.id, code: generated.code, expiresAt: now + ttlSeconds * 1_000 };
  }

  consume(challengeId: string, code: string, binding: OtpBinding, secret: string, now = Date.now()) {
    return this.mutate(secret, () => this.consumeInMemory(challengeId, code, binding, secret, now));
  }

  revoke(challengeId: string, secret: string) {
    this.mutate(secret, () => this.challenges.delete(challengeId));
  }

  private consumeInMemory(challengeId: string, code: string, binding: OtpBinding, secret: string, now: number) {
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
      && challenge.subjectId === binding.subjectId && challenge.bindingHash === bindingHash(binding);
    if (!bindingMatches || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      if (challenge.attempts >= 5) this.challenges.delete(challengeId);
      throw new Error("The OTP challenge is invalid or expired");
    }
    this.challenges.delete(challengeId);
  }
}

const globalOtp = globalThis as typeof globalThis & { blockInsureOtpStore?: OtpChallengeStore };
export const otpChallenges = globalOtp.blockInsureOtpStore ??= new OtpChallengeStore(path.join(
  path.resolve(process.cwd(), process.env.OTP_STATE_ROOT ?? "../../data/otp"),
  createHash("sha256").update(process.env.FABRIC_CHANNEL_NAME ?? "insurance-channel").digest("hex"),
));
