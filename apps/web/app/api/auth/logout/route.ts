import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSessionToken, sessionCookieName } from "@/lib/auth/current-session";
import { checkMutationOrigin } from "@/lib/security/request-origin";

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  const jar = await cookies();
  const token = jar.get(sessionCookieName)?.value;
  try {
    if (token) await revokeSessionToken(token);
  } catch {
    return NextResponse.json({ message: "Sign-out is temporarily unavailable" }, { status: 503 });
  }
  jar.delete(sessionCookieName);
  return NextResponse.json({ status: "signed-out" });
}
