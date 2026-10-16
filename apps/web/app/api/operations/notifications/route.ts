import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { notificationsFor } from "@/lib/events/projection";
import { readEventProjection } from "@/lib/events/store";
import { ledger } from "@/lib/fabric/ledger";

export const runtime = "nodejs";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  try {
    const projection = await readEventProjection();
    const ownedAssetIds = new Set<string>();
    if (session.role === "policyholder" && projection.notifications.some((item) => item.recipientRole === "policyholder" && !item.recipientSubject)) {
      const [policies, claims] = await Promise.all([ledger.listPolicies(), ledger.listClaims()]);
      for (const policy of policies) if (policy.policyholderId === session.subjectId) ownedAssetIds.add(policy.id);
      for (const claim of claims) if (claim.claimantId === session.subjectId) ownedAssetIds.add(claim.id);
    }
    return NextResponse.json({
      checkpoint: projection.checkpoint,
      updatedAt: projection.updatedAt,
      notifications: notificationsFor(projection, session.role, session.subjectId, ownedAssetIds).slice(-50).reverse(),
    });
  } catch {
    return NextResponse.json({ message: "Notifications are temporarily unavailable" }, { status: 503 });
  }
}
