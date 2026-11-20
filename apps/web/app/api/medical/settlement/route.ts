import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { loadFabricConfig } from "@/lib/fabric/config";
import { ledger } from "@/lib/fabric/ledger";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { medicalPayoutTimeline } from "@/lib/fabric/medical-timeline";
import { ledgerIdSchema } from "@/lib/fabric/validation";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (loadFabricConfig().channelName !== medicalDevLiteChannel) return reply({ message: "Medical settlement view is unavailable on this deployment" }, 404);
  const session = await currentSession().catch(() => null);
  if (session?.role !== "bankOfficer" || !session.subjectId) return reply({ message: "Bank access required" }, 403);
  const id = ledgerIdSchema.safeParse(new URL(request.url).searchParams.get("settlement"));
  if (!id.success) return reply({ message: "Enter a valid settlement ID" }, 400);
  const unavailable = () => reply({ message: "Current medical settlement is unavailable" }, 404);

  try {
    const settlement = await ledger.readSettlement(id.data);
    if (!settlement.approvalCertificateHash) return unavailable();
    const source = await ledger.readBankAccountReference(settlement.sourceAccountId);
    if (source.bankId !== session.subjectId) return unavailable();
    const claim = await ledger.readClaim(settlement.claimId);
    if (!claim.episodeId || claim.medicalSettlementId !== settlement.id) return unavailable();
    const certificate = await ledger.readMedicalApprovalCertificate(claim.id, claim.version);
    if (certificate.hash !== settlement.approvalCertificateHash || certificate.amountMinor !== settlement.amountMinor ||
        certificate.currency !== settlement.currency) return unavailable();
    return reply({ claimId: claim.id, claimVersion: certificate.claimVersion,
      approval: { hash: certificate.hash, path: certificate.path }, payout: medicalPayoutTimeline(settlement) });
  } catch {
    return unavailable();
  }
}
