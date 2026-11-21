import "server-only";

import { cookies } from "next/headers";
import { verifySessionToken, type Session } from "./session-token";
import { memberForAccount } from "@/lib/customers/member-id";
import { onboardingEnabled } from "@/lib/customers/settings";
import { CustomerStore, type CustomerRecord } from "@/lib/customers/store";

export const sessionCookieName = "block_insure_session";

function authSecret() {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  const session = token ? verifySessionToken(token, authSecret()) : null;
  if (!session?.accountId.startsWith("customer:")) return session;
  const memberId = memberForAccount(session.accountId);
  if (!memberId || !onboardingEnabled()) return null;
  return matchesActiveCustomer(session, await new CustomerStore().find(memberId)) ? session : null;
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
