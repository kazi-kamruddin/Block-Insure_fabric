import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { findDemoAccount } from "@/lib/auth/accounts";
import {
  sessionCookieName,
  sessionSecret,
  sessionTtlSeconds,
} from "@/lib/auth/current-session";
import { createSessionToken } from "@/lib/auth/session-token";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const requestSchema = z.object({ accountId: z.string().trim().min(1) });

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });

  if (process.env.ENABLE_DEMO_AUTH !== "true") {
    return NextResponse.json({ message: "Demo authentication is disabled" }, { status: 404 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  const account = parsed.success ? findDemoAccount(parsed.data.accountId) : undefined;
  if (!account) {
    return NextResponse.json({ message: "Unknown demo account" }, { status: 400 });
  }

  const ttlSeconds = sessionTtlSeconds();
  const token = createSessionToken(
    { accountId: account.id, role: account.role, subjectId: account.subjectId },
    sessionSecret(),
    ttlSeconds,
  );
  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.SESSION_COOKIE_SECURE === "true",
    maxAge: ttlSeconds,
    path: "/",
  });

  return NextResponse.json({ account });
}
