import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { readEventProjection } from "@/lib/events/store";
import { projectedClaims, reconcileClaimProjection } from "@/lib/events/claim-reconciliation";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (session?.role !== "insurerAdmin") return NextResponse.json({ message: "Insurer access required" }, { status: 403 });
  try {
    const [projection, claims, settlements] = await Promise.all([readEventProjection(), ledger.listClaims(), ledger.listSettlements()]);
    const settlementById = new Map(settlements.map(settlement => [settlement.id, settlement]));
    const canonical = claims.map(claim => ({ id: claim.id, status: claim.status, version: claim.version, amountMinor: claim.amountMinor,
      certificateHash: claim.medicalSettlementId ? settlementById.get(claim.medicalSettlementId)?.approvalCertificateHash : undefined }));
    const cached = projectedClaims(projection.events);
    return NextResponse.json({ checkpoint: projection.checkpoint, checked: canonical.length,
      differences: reconcileClaimProjection(cached, canonical) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "Projection and ledger could not be reconciled" }, { status: 503 });
  }
}
