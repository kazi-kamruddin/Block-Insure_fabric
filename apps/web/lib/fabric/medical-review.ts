import { z } from "zod";
import { ledgerIdSchema as id } from "./validation";
import type { AuditorDecision, Claim, ClaimAppeal, ClaimReview, EvidenceAccessGrant, EvidenceReference, OracleRequest } from "./types";
import type { MedicalQuote } from "./medical";
import type { MedicalTimeline } from "./medical-timeline";
import type { RevisionProof } from "./revision-proof";

const date = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const optionalHash = z.union([hash, z.literal("")]);
const message = z.string().trim().min(1).max(2000);
const voteReason = z.enum(["TERMS_AND_EVIDENCE_SUPPORT", "EVIDENCE_DOES_NOT_SUPPORT_SERVICE", "INSUFFICIENT_REQUIRED_EVIDENCE", "EPISODE_FACTS_CONFLICT"]);
const voteOutcome = z.enum(["APPROVE", "REJECT"]);
const voteRound = z.number().int().positive().safe();
export const medicalReviewCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("escalate"), claimId: id }),
  z.strictObject({ action: z.literal("release"), claimId: id }),
  z.strictObject({ action: z.literal("retire"), claimId: id, reasonHash: hash }),
  z.strictObject({ action: z.literal("explainDuplicate"), claimId: id, message: z.string().trim().min(1).max(1000) }),
  z.strictObject({ action: z.literal("disclose"), reviewId: id }),
  z.strictObject({ action: z.literal("acknowledge"), reviewId: id }),
  z.strictObject({ action: z.literal("replace"), reviewId: id, auditorId: id }),
  z.strictObject({ action: z.literal("commitVote"), reviewId: id, round: voteRound, commitment: hash }),
  z.strictObject({ action: z.literal("revealVote"), reviewId: id, round: voteRound, decisionId: id, outcome: voteOutcome,
    reasonCode: voteReason, reasonHash: hash, salt: hash }),
  z.strictObject({ action: z.literal("prepare"), claimId: id, reviewId: id, prepareBy: date }),
  z.strictObject({ action: z.literal("open"), reviewId: id, deadline: date }),
  z.strictObject({ action: z.literal("recover"), reviewId: id, newId: id, prepareBy: date }),
  z.strictObject({ action: z.literal("expire"), reviewId: id }),
  z.strictObject({ action: z.literal("oracleTimeout"), requestId: id }),
  z.strictObject({ action: z.literal("recordReceiptSummary"), claimId: id, summary: z.strictObject({
    evidenceId: id, invoiceNumber: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./_-]{0,63}$/),
    amountMinor: z.number().int().positive().safe(), serviceDate: z.iso.date(), hospitalId: id,
    derivedFrom: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  }) }),
  z.strictObject({ action: z.literal("ask"), reviewId: id, id, deadline: date, message }),
  z.strictObject({ action: z.literal("respond"), id, response: z.enum(["ANSWER", "UNAVAILABLE", "MATERIAL", "EXPIRED"]), evidenceHash: optionalHash, message: z.string().trim().max(2000) }),
  z.strictObject({ action: z.literal("share"), reviewId: id, expiresAt: date }),
  z.strictObject({ action: z.literal("confirm"), reviewId: id, evidenceId: id, accessId: id, contentHash: hash }),
  z.strictObject({ action: z.literal("vote"), reviewId: id, decisionId: id, outcome: voteOutcome, reasonCode: voteReason, reasonHash: hash }),
  z.strictObject({ action: z.literal("appeal"), id, claimId: id, decisionId: id, evidenceHash: optionalHash,
    revision: z.number().int().nonnegative().safe(), acceptedStatementHash: optionalHash, message }),
  z.strictObject({ action: z.literal("recordOCR"), evidenceId: id, id, engineVersion: z.string().regex(/^[a-z0-9.:-]{1,80}$/),
    sourceHash: hash, suggestionsHash: hash, confirmedHash: hash, lowConfidence: z.boolean(), accessId: z.union([id, z.literal("")]) }),
]);
export type MedicalReviewCommand = z.infer<typeof medicalReviewCommand>;

/** Mirrors the chaincode `medicalAppealWindow` on the certificate channel. */
export const medicalAppealWindowDays = 30;

export function readMedicalAppealWindow(ledgerTime: number | null | undefined, closedAt: string) {
  const endsAt = Date.parse(closedAt) + medicalAppealWindowDays * 86_400_000;
  return { endsAt: Number.isFinite(endsAt) ? endsAt : null,
    canAppeal: typeof ledgerTime === "number" && Number.isFinite(ledgerTime) && endsAt > ledgerTime };
}

/**
 * When a rejected claim's coverage reservation may be released: now (null)
 * once no appeal or recovery remains, otherwise when the window closes. The
 * chaincode decides with transaction time; this is display guidance only.
 */
export function medicalReleaseAvailableAt(claim: Pick<Claim, "appealCount" | "medicalRecoveryUsed">, review: Pick<ClaimReview, "status" | "closedAt">): Date | null {
  const remaining = review.status === "REJECTED" ? claim.appealCount < 1 : !claim.medicalRecoveryUsed;
  return remaining ? new Date(Date.parse(review.closedAt) + medicalAppealWindowDays * 86_400_000) : null;
}
export const medicalReasonLabels = {
  TERMS_AND_EVIDENCE_SUPPORT: "The issued terms and evidence support reimbursement",
  EVIDENCE_DOES_NOT_SUPPORT_SERVICE: "The evidence does not establish the covered service",
  INSUFFICIENT_REQUIRED_EVIDENCE: "Required evidence is insufficient",
  EPISODE_FACTS_CONFLICT: "The recorded episode facts conflict",
} as const;
export type MedicalClarification = {
  id: string; reviewId: string; claimId: string; claimVersion: number; question: string;
  answer: string; evidenceHash: string; status: string; deadline: string; resolvedAt: string;
};
export type MedicalEvidenceCheck = { reviewId: string; evidenceId: string; grantId: string; auditorId: string; checkedAt: string };
export type MedicalReviewFacts = { service: string; serviceDate: string; termsHash: string; quote: MedicalQuote; duplicateExplanation?: string };
export type MedicalReviewView = {
  oracleV2?: boolean;
  oracle?: OracleRequest | null;
  devLite?: boolean;
  viewerHasVoted?: boolean;
  viewerCommitment?: string;
  viewerSubjectId?: string;
  r2?: boolean;
  certificate?: import("./types").MedicalApprovalCertificate | null;
  /** Server clock when the view was read, in epoch milliseconds. */
  readAt?: number;
  ledgerTime?: number | null;
  revisionProof?: RevisionProof | null;
  issuedTerms?: { sublimitMinor: number; insurerShareBps: number } | null;
  hospitalName?: string;
  timeline?: MedicalTimeline;
  claim: Claim; review: ClaimReview | null; appeal: ClaimAppeal | null; clarification: MedicalClarification | null;
  appealExplanation: string | null;
  facts: MedicalReviewFacts | null;
  documents: EvidenceReference[]; grants: EvidenceAccessGrant[]; checks: MedicalEvidenceCheck[]; decisions: AuditorDecision[];
};
