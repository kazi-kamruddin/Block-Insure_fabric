import { z } from "zod";
import { ledgerIdSchema as id } from "./validation";
import type { AuditorDecision, Claim, ClaimAppeal, ClaimReview, EvidenceAccessGrant, EvidenceReference } from "./types";
import type { MedicalQuote } from "./medical";
import type { MedicalTimeline } from "./medical-timeline";

const date = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const optionalHash = z.union([hash, z.literal("")]);
const message = z.string().trim().min(1).max(2000);
export const medicalReviewCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("escalate"), claimId: id }),
  z.strictObject({ action: z.literal("release"), claimId: id }),
  z.strictObject({ action: z.literal("prepare"), claimId: id, reviewId: id, prepareBy: date }),
  z.strictObject({ action: z.literal("open"), reviewId: id, deadline: date }),
  z.strictObject({ action: z.literal("recover"), reviewId: id, newId: id, prepareBy: date }),
  z.strictObject({ action: z.literal("expire"), reviewId: id }),
  z.strictObject({ action: z.literal("ask"), reviewId: id, id, deadline: date, message }),
  z.strictObject({ action: z.literal("respond"), id, response: z.enum(["ANSWER", "UNAVAILABLE", "MATERIAL", "EXPIRED"]), evidenceHash: optionalHash, message: z.string().trim().max(2000) }),
  z.strictObject({ action: z.literal("share"), reviewId: id, expiresAt: date }),
  z.strictObject({ action: z.literal("confirm"), reviewId: id, evidenceId: id, accessId: id, contentHash: hash }),
  z.strictObject({ action: z.literal("vote"), reviewId: id, decisionId: id, outcome: z.enum(["APPROVE", "REJECT"]),
    reasonCode: z.enum(["TERMS_AND_EVIDENCE_SUPPORT", "EVIDENCE_DOES_NOT_SUPPORT_SERVICE", "INSUFFICIENT_REQUIRED_EVIDENCE", "EPISODE_FACTS_CONFLICT"]), reasonHash: hash }),
  z.strictObject({ action: z.literal("appeal"), id, claimId: id, decisionId: id, evidenceHash: optionalHash,
    revision: z.number().int().nonnegative().safe(), acceptedStatementHash: optionalHash, message }),
  z.strictObject({ action: z.literal("recordOCR"), evidenceId: id, id, engineVersion: z.string().regex(/^[a-z0-9.:-]{1,80}$/),
    sourceHash: hash, suggestionsHash: hash, confirmedHash: hash, lowConfidence: z.boolean(), accessId: z.union([id, z.literal("")]) }),
]);
export type MedicalReviewCommand = z.infer<typeof medicalReviewCommand>;

/** Mirrors the chaincode `medicalAppealWindow` on the certificate channel. */
export const medicalAppealWindowDays = 30;

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
export type MedicalReviewFacts = { service: string; serviceDate: string; termsHash: string; quote: MedicalQuote };
export type MedicalReviewView = {
  devLite?: boolean;
  /** Server clock when the view was read, in epoch milliseconds. */
  readAt?: number;
  timeline?: MedicalTimeline;
  claim: Claim; review: ClaimReview | null; appeal: ClaimAppeal | null; clarification: MedicalClarification | null;
  appealExplanation: string | null;
  facts: MedicalReviewFacts;
  documents: EvidenceReference[]; grants: EvidenceAccessGrant[]; checks: MedicalEvidenceCheck[]; decisions: AuditorDecision[];
};
