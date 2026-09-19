import "server-only";

import { ledger } from "@/lib/fabric/ledger";
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
  OracleCommitment,
  OracleRegistrySnapshot,
  OracleRequest,
  OracleResult,
  Settlement,
} from "@/lib/fabric/types";

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
};

export async function loadClaimAuditDossier(claimId: string): Promise<ClaimAuditDossier> {
  const claim = await ledger.readClaim(claimId);
  const [history, allEvidence, allEvidenceBatches, allAccess, allGrants, allVerifications, allDecisions, allReviews, allAppeals, allFraudAssessments, allSettlements, allOracleRequests, allOracleCommitments, allOracleResults, allOracleSnapshots] = await Promise.all([
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
    auditorDecisions: allDecisions.filter((item) => item.claimId === claimId),
    reviewRounds: allReviews.filter((item) => item.claimId === claimId),
    appeals: allAppeals.filter((item) => item.claimId === claimId),
    fraudAssessments: allFraudAssessments.filter((item) => item.claimId === claimId),
    settlement: allSettlements.find((item) => item.claimId === claimId) ?? null,
  };
}
