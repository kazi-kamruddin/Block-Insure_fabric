import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { communicationsFor } from "@/lib/events/projection";
import { readEventProjection } from "@/lib/events/store";

export const runtime = "nodejs";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "bankOfficer") return NextResponse.json({ message: "Bank officer role required" }, { status: 403 });
  const projection = await readEventProjection();
  return NextResponse.json({
    checkpoint: projection.checkpoint,
    updatedAt: projection.updatedAt,
    communications: communicationsFor(projection).slice(0, 100),
  });
}
