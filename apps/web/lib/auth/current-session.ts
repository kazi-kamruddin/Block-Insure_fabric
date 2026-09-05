import "server-only";

import { cookies } from "next/headers";
import { verifySessionToken, type Session } from "./session-token";

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
  return token ? verifySessionToken(token, authSecret()) : null;
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
