import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { loadRoleDashboard } from "@/lib/dashboard/load-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  try {
    return NextResponse.json({ dashboard: await loadRoleDashboard(session) });
  } catch (error) {
    console.error("Dashboard load failed", error);
    return NextResponse.json({ message: "Ledger dashboard is temporarily unavailable" }, { status: 503 });
  }
}
