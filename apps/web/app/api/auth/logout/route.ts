import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth/current-session";
import { checkMutationOrigin } from "@/lib/security/request-origin";

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  (await cookies()).delete(sessionCookieName);
  return NextResponse.json({ status: "signed-out" });
}
