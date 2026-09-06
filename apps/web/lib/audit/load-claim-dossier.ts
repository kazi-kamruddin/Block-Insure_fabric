import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type {
  AuditorDecision,
  Claim,
  ClaimAppeal,
  ClaimReview,
  ClaimHistoryRecord,
  EvidenceAccessRecord,
  EvidenceAccessGrant,
  EvidenceReference,
  FraudAssessment,
  HospitalVerification,
  Settlement,
} from "@/lib/fabric/types";

export type ClaimAuditDossier = {
  schemaVersion: 3;
  exportedAt: string;
  claim: Claim;
  history: ClaimHistoryRecord[];
  evidence: EvidenceReference[];
  evidenceAccess: EvidenceAccessRecord[];
  evidenceGrants: EvidenceAccessGrant[];
  hospitalVerification: HospitalVerification | null;
  auditorDecisions: AuditorDecision[];
  reviewRounds: ClaimReview[];
  appeals: ClaimAppeal[];
  fraudAssessments: FraudAssessment[];
  settlement: Settlement | null;
};

export async function loadClaimAuditDossier(claimId: string): Promise<ClaimAuditDossier> {
  const claim = await ledger.readClaim(claimId);
  const [history, allEvidence, allAccess, allGrants, allVerifications, allDecisions, allReviews, allAppeals, allFraudAssessments, allSettlements] = await Promise.all([
    ledger.claimHistory(claimId),
    ledger.listEvidenceReferences(),
    ledger.listEvidenceAccessRecords(),
    ledger.listEvidenceAccessGrants(),
    ledger.listHospitalVerifications(),
    ledger.listAuditorDecisions(),
    ledger.listClaimReviews(),
    ledger.listClaimAppeals(),
    ledger.listFraudAssessments(),
    ledger.listSettlements(),
  ]);

  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    claim,
    history,
    evidence: allEvidence.filter((item) => item.claimId === claimId),
    evidenceAccess: allAccess.filter((item) => item.claimId === claimId),
    evidenceGrants: allGrants.filter((item) => item.claimId === claimId),
    hospitalVerification: allVerifications.find((item) => item.id === claim.hospitalVerificationId) ?? null,
    auditorDecisions: allDecisions.filter((item) => item.claimId === claimId),
    reviewRounds: allReviews.filter((item) => item.claimId === claimId),
    appeals: allAppeals.filter((item) => item.claimId === claimId),
    fraudAssessments: allFraudAssessments.filter((item) => item.claimId === claimId),
    settlement: allSettlements.find((item) => item.claimId === claimId) ?? null,
  };
}
