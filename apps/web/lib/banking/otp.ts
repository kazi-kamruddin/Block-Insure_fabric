import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";

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
type AttemptBuckets = Map<string, number[]>;
type StoredOtpState = {
  version: number;
  challenges: Array<[string, Challenge]>;
  sendAttempts?: Array<[string, number[]]>;
  verifyAttempts?: Array<[string, number[]]>;
};

const rateWindow = 10 * 60_000;

export class OtpRateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super("Too many OTP requests. Try again later.");
  }
}

function recordAttempt(buckets: AttemptBuckets, binding: OtpBinding, ip: string, limits: [number, number], now: number) {
  for (const [key, values] of buckets) {
    const active = values.filter(value => value > now - rateWindow);
    if (active.length) buckets.set(key, active);
    else buckets.delete(key);
  }
  const keys = [`account:${binding.subjectId}:${binding.sourceAccountId}`, `ip:${ip}`];
  const active = keys.map(key => buckets.get(key) ?? []);
  const delay = Math.max(...active.map((values, index) => values.length >= limits[index] ? values[0] + rateWindow - now : 0));
  if (delay > 0) throw new OtpRateLimitError(Math.ceil(delay / 1_000));
  keys.forEach((key, index) => buckets.set(key, [...active[index], now]));
}

function loopbackAddress(address: string) {
  return ["localhost", "::1", "[::1]"].includes(address)
    || /^127\./.test(address) && isIP(address) === 4
    || /^::ffff:127\./.test(address) && isIP(address) === 6;
}

export function otpRequestContext(request: Request) {
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
  const configured = process.env.APP_ORIGIN;
  const directLoopback = Boolean(configured && loopbackAddress(new URL(configured).hostname)
    && loopbackAddress(new URL(request.url).hostname));
  const loopback = directLoopback && forwarded.every(loopbackAddress) && (!realIp || loopbackAddress(realIp));
  // Only an ingress that overwrites x-real-ip and blocks direct access can opt in.
  const trustedIp = process.env.OTP_TRUST_PROXY_IP === "true" && isIP(realIp)
    ? realIp.toLowerCase().replace(/^::ffff:(?=\d+\.)/, "") : null;
  return { ip: trustedIp ?? (directLoopback ? "loopback" : "unattributed"), loopback };
}

const bindingHash = (binding: OtpBinding) => createHash("sha256").update(JSON.stringify(Object.entries(binding).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");

function digest(challengeId: string, code: string, secret: string) {
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest();
}

export class OtpChallengeStore {
  private readonly challenges = new Map<string, Challenge>();
  private readonly sendAttempts: AttemptBuckets = new Map();
  private readonly verifyAttempts: AttemptBuckets = new Map();
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
      this.sendAttempts.clear();
      this.verifyAttempts.clear();
      if (existsSync(statePath)) {
        const stored = JSON.parse(readFileSync(statePath, "utf8")) as { body: StoredOtpState; mac: string };
        const expected = createHmac("sha256", secret).update(JSON.stringify(stored.body)).digest();
        const supplied = Buffer.from(stored.mac, "hex");
        if (stored.body.version !== 1 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("OTP state authentication failed");
        for (const [id, value] of stored.body.challenges) this.challenges.set(id, value);
        for (const [key, values] of stored.body.sendAttempts ?? []) this.sendAttempts.set(key, values);
        for (const [key, values] of stored.body.verifyAttempts ?? []) this.verifyAttempts.set(key, values);
      }
      try { return action(); }
      finally {
        const body = { version: 1, challenges: [...this.challenges], sendAttempts: [...this.sendAttempts], verifyAttempts: [...this.verifyAttempts] };
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
    ip = "unattributed",
  ) {
    return this.mutate(secret, () => this.issueInMemory(binding, secret, ttlSeconds, now, generated, ip));
  }

  private issueInMemory(binding: OtpBinding, secret: string, ttlSeconds: number, now: number, generated: { id: string; code: string }, ip: string) {
    if (secret.length < 32) throw new Error("OTP secret must contain at least 32 characters");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
      throw new Error("OTP TTL must be between 30 and 900 seconds");
    }
    recordAttempt(this.sendAttempts, binding, ip, [3, 12], now);
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

  consume(challengeId: string, code: string, binding: OtpBinding, secret: string, now = Date.now(), ip = "unattributed") {
    return this.mutate(secret, () => {
      recordAttempt(this.verifyAttempts, binding, ip, [15, 60], now);
      return this.consumeInMemory(challengeId, code, binding, secret, now);
    });
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
