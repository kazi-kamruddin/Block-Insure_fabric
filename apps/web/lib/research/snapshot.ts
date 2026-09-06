import { createHash } from "node:crypto";
import type {
  AuditorDecision, BenefitRequest, Claim, ClaimAppeal, ClaimReview,
  EvidenceAccessGrant, EvidenceAccessRecord, EvidenceReference, FraudAssessment,
  Liability, Policy, PremiumAdjustment, PremiumPayment, Settlement,
} from "@/lib/fabric/types";

export type ResearchInput = {
  policies: Policy[];
  claims: Claim[];
  reviews: ClaimReview[];
  decisions: AuditorDecision[];
  appeals: ClaimAppeal[];
  fraudAssessments: FraudAssessment[];
  evidence: EvidenceReference[];
  evidenceGrants: EvidenceAccessGrant[];
  evidenceAccess: EvidenceAccessRecord[];
  settlements: Settlement[];
  premiumPayments: PremiumPayment[];
  premiumAdjustments: PremiumAdjustment[];
  benefitRequests: BenefitRequest[];
  liabilities: Liability[];
};

const countBy = <T>(values: T[], key: (value: T) => string) => values.reduce<Record<string, number>>((counts, value) => {
  const name = key(value) || "UNKNOWN";
  counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}, {});

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function buildResearchSnapshot(
  input: ResearchInput,
  provenance: { channel: string; chaincode: string; ledgerSchemaVersion: number; checkpoint: { blockNumber: string; transactionId: string } | null; indexedEvents: number; eventCounts: Record<string, number> },
  generatedAt = new Date().toISOString(),
) {
  const closedReviews = input.reviews.filter((review) => review.closedAt);
  const reviewLatencies = closedReviews.map((review) => Date.parse(review.closedAt) - Date.parse(review.openedAt)).filter((value) => Number.isFinite(value) && value >= 0);
  const finalizedDecisionByReview = new Map(closedReviews.map((review) => [review.id, review.status === "APPROVED" ? "APPROVE" : "REJECT"]));
  const alignedVotes = input.decisions.filter((decision) => finalizedDecisionByReview.get(decision.reviewId) === decision.outcome).length;
  const now = Date.parse(generatedAt);
  const grantState = (grant: EvidenceAccessGrant) => grant.status === "REVOKED" ? "REVOKED" : Date.parse(grant.expiresAt) <= now ? "EXPIRED" : grant.accessCount >= grant.maxAccesses ? "EXHAUSTED" : "ACTIVE";
  const confirmedSettlements = input.settlements.filter((item) => item.status === "CONFIRMED");
  const paidBenefits = input.benefitRequests.filter((item) => item.status === "PAID");

  const body = {
    schemaVersion: 1,
    generatedAt,
    provenance,
    portfolio: {
      policies: input.policies.length,
      policyStatus: countBy(input.policies, (item) => item.status),
      claims: input.claims.length,
      claimStatus: countBy(input.claims, (item) => item.status),
      claimAmountMinor: sum(input.claims.map((item) => item.amountMinor)),
    },
    adjudication: {
      reviewRounds: input.reviews.length,
      reviewStatus: countBy(input.reviews, (item) => item.status),
      meanVotesPerClosedReview: closedReviews.length ? sum(closedReviews.map((item) => item.votesCast)) / closedReviews.length : null,
      meanClosureLatencyMs: reviewLatencies.length ? sum(reviewLatencies) / reviewLatencies.length : null,
      voteAlignmentBps: input.decisions.length ? Math.round(alignedVotes * 10_000 / input.decisions.length) : null,
      appeals: input.appeals.length,
      appealStatus: countBy(input.appeals, (item) => item.status),
    },
    fraudDecisionSupport: {
      assessments: input.fraudAssessments.length,
      riskLevels: countBy(input.fraudAssessments, (item) => item.riskLevel),
      meanScoreBps: input.fraudAssessments.length ? sum(input.fraudAssessments.map((item) => item.scoreBps)) / input.fraudAssessments.length : null,
      engineVersions: countBy(input.fraudAssessments, (item) => `${item.engineId}@${item.engineVersion}`),
      advisoryOnly: input.fraudAssessments.every((item) => item.advisory === true),
    },
    evidenceGovernance: {
      references: input.evidence.length,
      grants: input.evidenceGrants.length,
      grantState: countBy(input.evidenceGrants, grantState),
      accesses: input.evidenceAccess.length,
      grantBackedAccesses: input.evidenceAccess.filter((item) => Boolean(item.grantId)).length,
      accessPurpose: countBy(input.evidenceAccess, (item) => item.purpose),
    },
    financialOperations: {
      premiumReceipts: input.premiumPayments.length,
      premiumCollectedMinor: sum(input.premiumPayments.map((item) => item.amountMinor)),
      premiumReversedMinor: sum(input.premiumAdjustments.map((item) => item.amountMinor)),
      confirmedSettlements: confirmedSettlements.length,
      confirmedSettlementMinor: sum(confirmedSettlements.map((item) => item.amountMinor)),
      paidBenefits: paidBenefits.length,
      paidBenefitMinor: sum(paidBenefits.map((item) => item.amountMinor)),
      openLiabilityMinor: sum(input.liabilities.filter((item) => item.status !== "PAID").map((item) => item.amountMinor)),
    },
    interpretationBoundaries: [
      "Metrics describe the current local Fabric ledger and are not clinical or causal findings.",
      "Fraud scores are deterministic triage aids; only governed review transactions decide claims.",
      "Latency reflects transaction timestamps in this development network, not production capacity.",
      "Counts can include uniquely named records created by verification and demonstration runs.",
    ],
  };
  const reproducibleBody = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "generatedAt"));
  return { ...body, reproducibilityHash: createHash("sha256").update(canonical(reproducibleBody)).digest("hex") };
}
