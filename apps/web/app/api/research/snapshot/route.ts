import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { loadResearchSnapshot } from "@/lib/research/load-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "insurerAdmin" && session.role !== "auditor") return NextResponse.json({ message: "Research dashboard access is limited to insurer and auditor roles" }, { status: 403 });
  try {
    const snapshot = await loadResearchSnapshot();
    const download = new URL(request.url).searchParams.get("download") === "1";
    return NextResponse.json(snapshot, { headers: download ? { "content-disposition": `attachment; filename="block-insure-research-${snapshot.reproducibilityHash.slice(0, 12)}.json"` } : undefined });
  } catch (error) {
    console.error("Research snapshot failed", error);
    return NextResponse.json({ message: "Research snapshot could not be generated" }, { status: 502 });
  }
}
