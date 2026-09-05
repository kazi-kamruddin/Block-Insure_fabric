import { NextResponse } from "next/server";
import { findDemoAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";

export async function GET() {
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ account: null }, { status: 401 });

    return NextResponse.json({ account: findDemoAccount(session.accountId) ?? null });
  } catch {
    return NextResponse.json({ account: null }, { status: 503 });
  }
}
