import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import { loadFabricConfig } from "@/lib/fabric/config";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { hasFinalMedicalApproval } from "@/lib/fabric/medical-timeline";
import { buildEvidenceMerkleTree, evidenceLeafHash } from "@/lib/evidence/merkle";
import type {
  AuditorDecision,
  Claim,
  ClaimAppeal,
  ClaimReview,
  ClaimHistoryRecord,
  EvidenceAccessRecord,
  EvidenceAccessGrant,
  EvidenceReference,
  EvidenceMerkleBatch,
  MerkleProofStep,
  FraudAssessment,
  HospitalVerification,
  MedicalApprovalCertificate,
  OracleCommitment,
  OracleRegistrySnapshot,
  OracleRequest,
  OracleResult,
  Settlement,
} from "@/lib/fabric/types";

const isFinalReview = (review: ClaimReview) =>
  ["APPROVED", "REJECTED", "TIMED_OUT", "ACCESS_FAILED", "SUPERSEDED"].includes(review.status);

export type ClaimAuditDossier = {
  schemaVersion: 6;
  exportedAt: string;
  claim: Claim;
  history: ClaimHistoryRecord[];
  evidence: EvidenceReference[];
  evidenceMerkle: Array<{ batch: EvidenceMerkleBatch; proofs: Array<{ evidenceId: string; leafHash: string; proof: MerkleProofStep[] }> }>;
  evidenceAccess: EvidenceAccessRecord[];
  evidenceGrants: EvidenceAccessGrant[];
  hospitalVerification: HospitalVerification | null;
  hospitalVerifications: HospitalVerification[];
  oracleRequests: OracleRequest[];
  oracleCommitments: OracleCommitment[];
  oracleResults: OracleResult[];
  oracleRegistrySnapshots: OracleRegistrySnapshot[];
  auditorDecisions: AuditorDecision[];
  reviewRounds: ClaimReview[];
  appeals: ClaimAppeal[];
  fraudAssessments: FraudAssessment[];
  settlement: Settlement | null;
  approvalCertificate?: MedicalApprovalCertificate | null;
};

export async function loadClaimAuditDossier(claimId: string, auditorSubject?: string): Promise<ClaimAuditDossier | null> {
  const claim = await ledger.readClaim(claimId);
  const devLiteMedical = !!claim.episodeId && loadFabricConfig().channelName === medicalDevLiteChannel;
  const auditorMedicalExport = devLiteMedical && auditorSubject !== undefined;
  if (auditorMedicalExport) {
    const review = claim.currentReviewId ? await ledger.readClaimReview(claim.currentReviewId) : null;
    if (!review || !isFinalReview(review) || review.medicalVersion !== claim.version ||
        !review.assignedAuditorIds.includes(auditorSubject)) return null;
  }
  const [history, allEvidence, allEvidenceBatches, allAccess, allGrants, allVerifications, allDecisions, allReviews, allAppeals, allFraudAssessments, allSettlements, allOracleRequests, allOracleCommitments, allOracleResults, allOracleSnapshots, approvalCertificate] = await Promise.all([
    ledger.claimHistory(claimId),
    ledger.listEvidenceReferences(),
    ledger.listEvidenceMerkleBatches(),
    ledger.listEvidenceAccessRecords(),
    ledger.listEvidenceAccessGrants(),
    ledger.listHospitalVerifications(),
    ledger.listAuditorDecisions(),
    ledger.listClaimReviews(),
    ledger.listClaimAppeals(),
    ledger.listFraudAssessments(),
    ledger.listSettlements(),
    ledger.listOracleRequests(),
    ledger.listOracleCommitments(),
    ledger.listOracleResults(),
    ledger.listOracleRegistrySnapshots(),
    devLiteMedical && hasFinalMedicalApproval(claim) ? ledger.readMedicalApprovalCertificate(claim.id, claim.version) : null,
  ]);

  const claimEvidence = allEvidence.filter((item) => item.claimId === claimId);
  const claimEvidenceIds = new Set(claimEvidence.map((item) => item.id));
  const evidenceMerkle = allEvidenceBatches.filter((batch) => batch.evidenceIds.some((id) => claimEvidenceIds.has(id))).map((batch) => {
    const tree = buildEvidenceMerkleTree(batch.evidenceIds.map((id) => {
      const evidence = allEvidence.find((item) => item.id === id);
      if (!evidence) throw new Error(`Evidence ${id} from Merkle batch ${batch.id} is unavailable`);
      return evidence;
    }));
    if (tree.rootHash !== batch.rootHash) throw new Error(`Merkle batch ${batch.id} no longer reproduces its anchored root`);
    return {
      batch,
      proofs: claimEvidence.filter((item) => batch.evidenceIds.includes(item.id)).map((item) => ({ evidenceId: item.id, leafHash: evidenceLeafHash(item), proof: tree.proofFor(item.id) })),
    };
  });

  const reviewRounds = allReviews.filter(review => review.claimId === claimId &&
    (!auditorMedicalExport || isFinalReview(review)));
  const exportRoundIds = new Set(reviewRounds.map(review => review.id));
  return {
    schemaVersion: 6,
    exportedAt: new Date().toISOString(),
    claim,
    history,
    evidence: claimEvidence,
    evidenceMerkle,
    evidenceAccess: allAccess.filter((item) => item.claimId === claimId),
    evidenceGrants: allGrants.filter((item) => item.claimId === claimId),
    hospitalVerification: allVerifications.find((item) => item.id === claim.hospitalVerificationId) ?? null,
    hospitalVerifications: allVerifications.filter((item) => item.claimId === claimId),
    oracleRequests: allOracleRequests.filter((item) => item.claimId === claimId),
    oracleCommitments: allOracleCommitments.filter((item) => item.claimId === claimId),
    oracleResults: allOracleResults.filter((item) => item.claimId === claimId),
    oracleRegistrySnapshots: allOracleSnapshots.filter((snapshot) => allOracleRequests.some((request) => request.claimId === claimId && request.registrySnapshotId === snapshot.id)),
    auditorDecisions: allDecisions.filter(item => item.claimId === claimId &&
      (!auditorMedicalExport || exportRoundIds.has(item.reviewId))),
    reviewRounds,
    appeals: allAppeals.filter((item) => item.claimId === claimId),
    fraudAssessments: allFraudAssessments.filter((item) => item.claimId === claimId),
    settlement: allSettlements.find(item => item.claimId === claimId &&
      (!devLiteMedical || item.id === claim.medicalSettlementId)) ?? null,
    ...(devLiteMedical ? { approvalCertificate } : {}),
  };
}
