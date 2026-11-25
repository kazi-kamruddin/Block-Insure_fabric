import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import { loadFabricConfig } from "@/lib/fabric/config";
import { withFabricContract } from "@/lib/fabric/gateway";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { hasFinalMedicalApproval } from "@/lib/fabric/medical-timeline";
import { isVoteVisible, redactVoteTallies, visibleDecisions } from "@/lib/fabric/vote-visibility";
import { buildEvidenceMerkleTree, evidenceLeafHash } from "@/lib/evidence/merkle";
import { readDossierLedgerEvidence } from "./dossier-ledger-evidence.mjs";
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

export type ClaimAuditDossier = Partial<Awaited<ReturnType<typeof readDossierLedgerEvidence>>> & {
  schemaVersion: 6 | 7;
  channel?: string;
  chaincode?: string;
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
  const config = loadFabricConfig();
  const devLiteMedical = !!claim.episodeId && config.channelName === medicalDevLiteChannel;
  const auditorMedicalExport = devLiteMedical && auditorSubject !== undefined;
  const viewer = auditorSubject === undefined ? { role: "insurerAdmin" as const } : { role: "auditor" as const, subjectId: auditorSubject };
  if (auditorMedicalExport) {
    const review = claim.currentReviewId ? await ledger.readClaimReview(claim.currentReviewId) : null;
    if (!review || !isVoteVisible(review, viewer) || review.medicalVersion !== claim.version) return null;
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
    (!auditorMedicalExport || isVoteVisible(review, viewer))).map(review => redactVoteTallies(review, viewer));
  const exportRoundIds = new Set(reviewRounds.map(review => review.id));
  const oracleRequests = allOracleRequests.filter((item) => item.claimId === claimId);
  const oracleResults = allOracleResults.filter((item) => item.claimId === claimId);
  const proof = devLiteMedical ? await withFabricContract("insurerAdmin", (contract, gateway) =>
    readDossierLedgerEvidence({
      contract, qscc: gateway.getNetwork(config.channelName).getContract("qscc"),
      channel: config.channelName, chaincode: config.chaincodeName,
    }, { claim, history, oracleRequests, oracleResults, approvalCertificate }),
  ) : {};
  return {
    schemaVersion: devLiteMedical ? 7 : 6,
    exportedAt: new Date().toISOString(),
    claim,
    history,
    evidence: claimEvidence,
    evidenceMerkle,
    evidenceAccess: allAccess.filter((item) => item.claimId === claimId),
    evidenceGrants: allGrants.filter((item) => item.claimId === claimId),
    hospitalVerification: allVerifications.find((item) => item.id === claim.hospitalVerificationId) ?? null,
    hospitalVerifications: allVerifications.filter((item) => item.claimId === claimId),
    oracleRequests,
    oracleCommitments: allOracleCommitments.filter((item) => item.claimId === claimId),
    oracleResults,
    oracleRegistrySnapshots: allOracleSnapshots.filter((snapshot) => oracleRequests.some((request) => request.registrySnapshotId === snapshot.id)),
    auditorDecisions: visibleDecisions(allDecisions.filter(item => item.claimId === claimId &&
      (!auditorMedicalExport || exportRoundIds.has(item.reviewId))), allReviews, viewer),
    reviewRounds,
    appeals: allAppeals.filter((item) => item.claimId === claimId),
    fraudAssessments: allFraudAssessments.filter((item) => item.claimId === claimId),
    settlement: allSettlements.find(item => item.claimId === claimId &&
      (!devLiteMedical || item.id === claim.medicalSettlementId)) ?? null,
    ...(devLiteMedical ? { channel: config.channelName, chaincode: config.chaincodeName, approvalCertificate, ...proof } : {}),
  };
}
