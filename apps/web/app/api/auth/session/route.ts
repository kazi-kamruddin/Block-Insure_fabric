import { NextResponse } from "next/server";
import { findDemoAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { memberForAccount } from "@/lib/customers/member-id";
import { CustomerStore } from "@/lib/customers/store";

export async function GET() {
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ account: null }, { status: 401 });

    const memberId = memberForAccount(session.accountId);
    if (memberId) {
      const customer = await new CustomerStore().find(memberId);
      if (customer?.status !== "ACTIVE" || customer.sessionId !== session.sessionId) {
        return NextResponse.json({ account: null }, { status: 401 });
      }
      return NextResponse.json({ account: { id: session.accountId, role: session.role, subjectId: memberId,
        displayName: customer.fullName, organization: "InsurerMSP" } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ account: findDemoAccount(session.accountId) ?? null });
  } catch {
    return NextResponse.json({ account: null }, { status: 503 });
  }
}
