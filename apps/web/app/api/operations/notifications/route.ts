import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { notificationsFor } from "@/lib/events/projection";
import { readEventProjection } from "@/lib/events/store";

export const runtime = "nodejs";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const projection = await readEventProjection();
  return NextResponse.json({
    checkpoint: projection.checkpoint,
    updatedAt: projection.updatedAt,
    notifications: notificationsFor(projection, session.role, session.subjectId).slice(-50).reverse(),
  });
}
