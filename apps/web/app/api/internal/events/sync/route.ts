import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { syncFabricEvents } from "@/lib/events/sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const workerAuthorized = Boolean(process.env.EVENT_WORKER_SECRET && supplied === process.env.EVENT_WORKER_SECRET);
  const session = workerAuthorized ? null : await currentSession().catch(() => null);
  if (!workerAuthorized) {
    const trust = checkMutationOrigin(request);
    if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
    if (session?.role !== "insurerAdmin") return NextResponse.json({ message: "Insurer administrator access required" }, { status: 403 });
  }
  try {
    return NextResponse.json(await syncFabricEvents());
  } catch (error) {
    console.error("Fabric event synchronization failed", error);
    return NextResponse.json({ message: "Fabric event synchronization failed" }, { status: 502 });
  }
}
