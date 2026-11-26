import "server-only";

import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { verifySessionToken, type Session } from "./session-token";
import { memberForAccount } from "@/lib/customers/member-id";
import { onboardingEnabled } from "@/lib/customers/settings";
import { CustomerStore, type CustomerRecord } from "@/lib/customers/store";
import { readJson, serialized, writeJson } from "@/lib/customers/state-file";

export const sessionCookieName = "block_insure_session";
const revocations = z.record(z.string().regex(/^[a-f0-9]{64}$/), z.number().int().positive());
const revocationFile = () => path.resolve(process.env.AUTH_SESSION_STATE_ROOT ?? process.env.OTP_STATE_ROOT ?? "../../data/otp", "revoked-sessions.json");
const tokenFingerprint = (token: string) => createHash("sha256").update(token).digest("hex");

function authSecret() {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;
  const session = verifySessionToken(token, authSecret());
  if (!session) return null;
  const revoked = revocations.parse(await readJson(revocationFile(), {}));
  if (revoked[tokenFingerprint(token)] > Math.floor(Date.now() / 1_000)) return null;
  if (!session.accountId.startsWith("customer:")) return session;
  const memberId = memberForAccount(session.accountId);
  if (!memberId || !onboardingEnabled()) return null;
  return matchesActiveCustomer(session, await new CustomerStore().find(memberId)) ? session : null;
}

export async function revokeSessionToken(token: string) {
  const session = verifySessionToken(token, authSecret());
  if (!session) return;
  const file = revocationFile();
  await serialized(file, async () => {
    const now = Math.floor(Date.now() / 1_000);
    const existing = revocations.parse(await readJson(file, {}));
    const active = Object.fromEntries(Object.entries(existing).filter(([, expiresAt]) => expiresAt > now));
    active[tokenFingerprint(token)] = session.expiresAt;
    await writeJson(file, active);
  });
  const memberId = memberForAccount(session.accountId);
  if (memberId && onboardingEnabled()) {
    await new CustomerStore().update(records => {
      const customer = records.find(record => record.memberId === memberId);
      if (customer && matchesActiveCustomer(session, customer)) delete customer.sessionId;
    });
  }
}

export function matchesActiveCustomer(session: Session, customer: CustomerRecord | undefined) {
  return !!customer && customer.status === "ACTIVE" && session.role === "policyholder"
    && session.accountId === `customer:${customer.memberId}` && session.subjectId === customer.memberId
    && !!session.sessionId && session.sessionId === customer.sessionId;
}

export function sessionSecret() {
  return authSecret();
}

export function sessionTtlSeconds() {
  const value = Number(process.env.SESSION_TTL_SECONDS ?? 28_800);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("SESSION_TTL_SECONDS must be a positive integer");
  }
  return value;
}
