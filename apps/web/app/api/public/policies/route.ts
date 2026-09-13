import { NextResponse } from "next/server";
import { ledger } from "@/lib/fabric/ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const packages = (await ledger.listPolicyPackages()).filter((item) => item.status === "PUBLISHED");
    return NextResponse.json({ packages }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json({ message: "Policy catalog is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
