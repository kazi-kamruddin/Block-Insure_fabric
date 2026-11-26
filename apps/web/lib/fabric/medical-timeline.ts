import type { MedicalClarification, MedicalEvidenceCheck } from "./medical-review";
import type { Claim, ClaimAppeal, ClaimReview, EvidenceAccessGrant, EvidenceReference, MedicalApprovalCertificate, OracleRequest, Settlement } from "./types";

export type MedicalTimeline = {
  nextAction: string;
  referrals: string[];
  milestones: { label: string; at: string }[];
  oracle: { requestId: string; snapshotId: string; modelVersion: string; modelHash: string; finalizationCode: OracleRequest["finalizationCode"] } | null;
  approval: { path: MedicalApprovalCertificate["path"]; hash: string } | null;
  payout: {
    id: string; amountMinor: number; status: Settlement["status"]; transferId: string;
    failureCode: string; confirmedAt: string;
  } | null;
};

export function hasFinalMedicalApproval(claim: Claim) {
  return ["APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"].includes(claim.status);
}

export function medicalPayoutTimeline(settlement: Settlement) {
  const { id, amountMinor, status, transferId, failureCode, confirmedAt } = settlement;
  return { id, amountMinor, status, transferId, failureCode, confirmedAt };
}

function nextAction({ claim, review, clarification, appeal, documents, grants, checks, settlement, readAt }: TimelineRecords) {
  const claimantDocuments = documents.filter(doc => doc.submittedBy === claim.claimantId && doc.claimVersion <= claim.version);
  switch (claim.status) {
    case "SUBMITTED":
    case "APPEAL_SUBMITTED": {
      const missing = (type: string, hash?: string) => hash && !claimantDocuments.some(
        doc => doc.claimVersion === claim.version && doc.documentType === type && doc.contentHash.toLowerCase() === hash.toLowerCase(),
      );
      const missingPrimary = claim.medicalEvidenceRequired && !claimantDocuments.some(doc =>
        doc.documentType === "INVOICE" || (claim.version > 1 && doc.documentType === "APPEAL_DOCUMENT"));
      return missingPrimary || missing("CLARIFICATION_DOCUMENT", claim.medicalSupplementHash) || missing("APPEAL_DOCUMENT", appeal?.evidenceHash)
        ? "Policyholder uploads the committed evidence."
        : "Insurer starts Oracle verification.";
    }
    case "ORACLE_PENDING":
      return "Oracle workers complete verification.";
    case "MEDICAL_AUDIT_PENDING":
      return "Audit selection awaits the seed reveal and resolution.";
    case "ORACLE_FAILED":
    case "MEDICAL_REVIEW_REQUIRED":
      return "Insurer prepares panel review.";
    case "MEDICAL_REVIEW_PREPARING": {
      if (review?.prepareBy && Date.parse(review.prepareBy) < readAt) return "Insurer finalizes the expired review.";
      if (clarification?.status === "PENDING") {
        return Date.parse(clarification.deadline) < readAt
          ? "Insurer closes the expired clarification." : "Policyholder answers the clarification request.";
      }
      if (review) {
        // The workspace opens a 24-hour voting window. Chaincode checks the actual transaction timestamp and deadline.
        const votingEnds = readAt + 24 * 60 * 60 * 1_000;
        const activeGrants = grants.filter(grant => grant.medicalReviewId === review.id && grant.status === "ACTIVE" &&
          grant.accessCount < grant.maxAccesses && Date.parse(grant.expiresAt) >= votingEnds);
        const required = claimantDocuments.flatMap(doc => review.assignedAuditorIds.map(auditor => ({
          evidenceId: doc.id, auditor, grants: activeGrants.filter(grant => grant.evidenceId === doc.id && grant.granteeSubject === auditor),
        })));
        if (required.some(pair => pair.grants.length === 0)) return "Policyholder grants evidence access to the assigned auditors.";
        if (required.some(pair => !checks.some(check => check.reviewId === review.id && check.evidenceId === pair.evidenceId &&
          check.auditorId === pair.auditor && pair.grants.some(grant => grant.id === check.grantId)))) {
          return "Assigned auditors confirm that they can decrypt the evidence.";
        }
      }
      return claim.medicalEscalatedAt
        ? "Assigned auditors open voting once evidence is ready."
        : "Insurer opens voting once evidence is ready.";
    }
    case "UNDER_REVIEW":
      return review?.deadline && Date.parse(review.deadline) < readAt
        ? "Insurer finalizes the expired review." : "Assigned auditors review and vote.";
    case "APPROVED":
      return "Insurer authorizes settlement.";
    case "SETTLEMENT_AUTHORIZED":
      return settlement?.status === "PAYMENT_FAILED"
        ? "Bank resolves the payment failure and retries confirmation."
        : "Bank confirms the payout.";
    case "REJECTED":
      if (review?.status === "TIMED_OUT" || review?.status === "ACCESS_FAILED") {
        return claim.medicalRecoveryUsed ? "No further procedural recovery is available." : "Insurer may start the permitted recovery round.";
      }
      return review?.status === "REJECTED" && !claim.appealCount
        ? "Policyholder may appeal with new material." : "Review is complete.";
    case "SETTLED":
      return "Payout complete.";
    default:
      return "No action pending.";
  }
}

type TimelineRecords = {
  claim: Claim; review: ClaimReview | null; clarification: MedicalClarification | null;
  appeal: ClaimAppeal | null; documents: EvidenceReference[]; oracle: OracleRequest | null;
  grants: EvidenceAccessGrant[]; checks: MedicalEvidenceCheck[];
  certificate: MedicalApprovalCertificate | null; settlement: Settlement | null;
  readAt: number;
};

export function buildMedicalTimeline(input: TimelineRecords): MedicalTimeline {
  const { claim, review, clarification, appeal, oracle, certificate, settlement } = input;
  const referrals: string[] = [];
  if (claim.medicalDuplicateReview) referrals.push("Duplicate screening flagged a similar episode or a crowded matching window.");
  if (claim.medicalEscalatedAt) referrals.push("The claimant escalated after the processing deadline.");
  if (appeal) referrals.push("A new panel decision is required for this appeal.");
  else if (claim.medicalRevisionKind === "CORRECTION" || claim.medicalSupplementHash) {
    referrals.push("The current version contains new or corrected material.");
  }
  if (oracle?.status === "FAILED" && !claim.medicalEscalatedAt) {
    referrals.push(oracle.finalizationCode === "MODEL_HELD"
      ? "The held Oracle model release requires panel review."
      : "Oracle verification did not establish a positive result.");
  }

  const milestones: MedicalTimeline["milestones"] = [];
  function record(label: string, at?: string) {
    if (at) milestones.push({ label, at });
  }
  record("Claim submitted", claim.createdAt);
  record("Appeal filed", appeal?.createdAt);
  record("Oracle verification requested", oracle?.requestedAt);
  record("Oracle verification finalized", oracle?.finalizedAt);
  record("Claim escalated", claim.medicalEscalatedAt);
  record("Clarification resolved", clarification?.resolvedAt);
  record("Panel voting opened", review?.openedAt);
  record("Panel round closed", review?.closedAt);
  record(certificate?.path === "ORACLE_AUTO" ? "Oracle finalised at" : "Panel approved at", certificate?.approvedAt);
  record("Settlement authorized", settlement?.authorizedAt);
  if (settlement?.status === "PAYMENT_FAILED") record("Payment attempt failed", settlement.updatedAt);
  record("Bank payout confirmed", settlement?.confirmedAt);

  return {
    nextAction: nextAction(input),
    referrals,
    milestones: milestones.sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    oracle: oracle ? {
      requestId: oracle.id, snapshotId: oracle.registrySnapshotId, modelVersion: oracle.modelVersion,
      modelHash: oracle.modelHash, finalizationCode: oracle.finalizationCode,
    } : null,
    approval: certificate ? { path: certificate.path, hash: certificate.hash } : null,
    payout: settlement ? medicalPayoutTimeline(settlement) : null,
  };
}
