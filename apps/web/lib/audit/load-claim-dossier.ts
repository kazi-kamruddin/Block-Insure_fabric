import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type {
  AuditorDecision,
  Claim,
  ClaimHistoryRecord,
  EvidenceAccessRecord,
  EvidenceReference,
  HospitalVerification,
  Settlement,
} from "@/lib/fabric/types";

export type ClaimAuditDossier = {
  schemaVersion: 1;
  exportedAt: string;
  claim: Claim;
  history: ClaimHistoryRecord[];
  evidence: EvidenceReference[];
  evidenceAccess: EvidenceAccessRecord[];
  hospitalVerification: HospitalVerification | null;
  auditorDecision: AuditorDecision | null;
  settlement: Settlement | null;
};

export async function loadClaimAuditDossier(claimId: string): Promise<ClaimAuditDossier> {
  const claim = await ledger.readClaim(claimId);
  const [history, allEvidence, allAccess, allVerifications, allDecisions, allSettlements] = await Promise.all([
    ledger.claimHistory(claimId),
    ledger.listEvidenceReferences(),
    ledger.listEvidenceAccessRecords(),
    ledger.listHospitalVerifications(),
    ledger.listAuditorDecisions(),
    ledger.listSettlements(),
  ]);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    claim,
    history,
    evidence: allEvidence.filter((item) => item.claimId === claimId),
    evidenceAccess: allAccess.filter((item) => item.claimId === claimId),
    hospitalVerification: allVerifications.find((item) => item.id === claim.hospitalVerificationId) ?? null,
    auditorDecision: allDecisions.find((item) => item.id === claim.auditorDecisionId) ?? null,
    settlement: allSettlements.find((item) => item.claimId === claimId) ?? null,
  };
}
