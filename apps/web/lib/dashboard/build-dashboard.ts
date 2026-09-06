import type { FabricRole } from "@/lib/fabric/config";
import type {
  BankMandate,
  AuditorDecision,
  BenefitRequest,
  Claim,
  ClaimAppeal,
  ClaimReview,
  FraudAssessment,
  EvidenceReference,
  EvidenceAccessRecord,
  Policy,
  PolicyPackage,
  PremiumCollection,
  PremiumPayment,
  Liability,
  Settlement,
} from "@/lib/fabric/types";

export type DashboardMetric = { label: string; value: number; hint: string };

export type DashboardItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  command?: Record<string, unknown>;
  commandLabel?: string;
};

export type RoleDashboard = {
  title: string;
  description: string;
  metrics: DashboardMetric[];
  queueTitle: string;
  queue: DashboardItem[];
  recentClaims: Claim[];
};

export type DashboardAssets = {
  packages: PolicyPackage[];
  policies: Policy[];
  claims: Claim[];
  evidence: EvidenceReference[];
  settlements: Settlement[];
  evidenceAccess: EvidenceAccessRecord[];
  mandates?: BankMandate[];
  premiumPayments?: PremiumPayment[];
  premiumCollections?: PremiumCollection[];
  benefitRequests?: BenefitRequest[];
  liabilities?: Liability[];
  reviews?: ClaimReview[];
  appeals?: ClaimAppeal[];
  decisions?: AuditorDecision[];
  fraudAssessments?: FraudAssessment[];
};

const terminalClaimStatuses = new Set(["REJECTED", "SETTLED"]);

function newestClaims(claims: Claim[]) {
  return [...claims]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8);
}

function money(minor: number) {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function buildRoleDashboard(
  role: FabricRole,
  assets: DashboardAssets,
  subjectId?: string,
): RoleDashboard {
  const mandates = assets.mandates ?? [];
  const premiumPayments = assets.premiumPayments ?? [];
  const premiumCollections = assets.premiumCollections ?? [];
  const benefitRequests = assets.benefitRequests ?? [];
  const liabilities = assets.liabilities ?? [];
  const reviews = assets.reviews ?? [];
  const decisions = assets.decisions ?? [];
  const fraudAssessments = assets.fraudAssessments ?? [];
  const ownedPolicies = role === "policyholder"
    ? assets.policies.filter((policy) => policy.policyholderId === subjectId)
    : assets.policies;
  const ownedClaims = role === "policyholder"
    ? assets.claims.filter((claim) => claim.claimantId === subjectId)
    : assets.claims;
  const ownedPolicyIds = new Set(ownedPolicies.map((policy) => policy.id));
  const visibleMandates = role === "policyholder" ? mandates.filter((item) => item.ownerId === subjectId) : mandates;
  const visiblePayments = role === "policyholder" ? premiumPayments.filter((item) => ownedPolicyIds.has(item.policyId)) : premiumPayments;
  const visibleBenefits = role === "policyholder" ? benefitRequests.filter((item) => item.requesterId === subjectId) : benefitRequests;

  if (role === "policyholder") {
    return {
      title: "Coverage and claims overview",
      description: "Your coverage, premium standing, benefit requests, claims, and confirmed payouts.",
      metrics: [
        { label: "Active policies", value: ownedPolicies.filter((item) => item.status === "ACTIVE").length, hint: "coverage issued to you" },
        { label: "Open claims", value: ownedClaims.filter((item) => !terminalClaimStatuses.has(item.status)).length, hint: "still moving through the network" },
        { label: "Premium receipts", value: visiblePayments.length, hint: "reconciled external payments" },
        { label: "Open benefits", value: visibleBenefits.filter((item) => !["PAID", "REJECTED"].includes(item.status)).length, hint: "governed benefit requests" },
        { label: "Active mandates", value: visibleMandates.filter((item) => item.status === "ACTIVE").length, hint: "bank-approved collections" },
      ],
      queueTitle: "Your active coverage",
      queue: [
        ...ownedClaims.filter((claim) => claim.status === "REJECTED" && claim.appealCount < 1).map((claim) => ({
          id: claim.id,
          title: claim.id,
          detail: `${money(claim.amountMinor)} rejected claim · one appeal available`,
          status: claim.status,
          commandLabel: "Prepare appeal",
          command: { operation: "submitClaimAppeal", appealId: `appeal-${Date.now()}-${claim.id}`, claimId: claim.id },
        })),
        ...ownedPolicies.map((policy) => ({
        id: policy.id,
        title: policy.id,
        detail: `${money(policy.coverageLimitMinor)} coverage · ends ${policy.endDate}`,
        status: policy.status,
        commandLabel: policy.status === "ACTIVE" ? "Prepare claim" : "Manage coverage",
        command: policy.status === "ACTIVE" ? {
          operation: "submitClaim", id: `claim-${Date.now()}`, policyId: policy.id,
          amountMinor: 250000, incidentDate: new Date().toISOString().slice(0, 10), descriptionHash: "a".repeat(64),
        } : { operation: "requestBankMandate", policyId: policy.id },
        })),
      ],
      recentClaims: newestClaims(ownedClaims),
    };
  }

  if (role === "hospitalOfficer") {
    const queue = assets.claims.filter((claim) => claim.status === "SUBMITTED");
    return {
      title: "Hospital verification desk",
      description: "Claims awaiting an independent clinical attestation from HospitalMSP.",
      metrics: [
        { label: "Awaiting verification", value: queue.length, hint: "submitted claims" },
        { label: "Verified", value: assets.claims.filter((item) => item.status !== "SUBMITTED").length, hint: "claims past hospital review" },
        { label: "Evidence access", value: assets.evidenceAccess.length, hint: "auditable retrieval events" },
      ],
      queueTitle: "Verification requests",
      queue: queue.map((claim) => ({
        id: claim.id,
        title: claim.id,
        detail: `${money(claim.amountMinor)} · incident ${claim.incidentDate}`,
        status: claim.status,
        commandLabel: "Prepare verification",
        command: {
          operation: "verifyClaim",
          claimId: claim.id,
          verificationId: `verification-${Date.now()}-${claim.id}`,
          outcome: "VERIFIED",
          clinicalReferenceHash: "a".repeat(64),
        },
      })),
      recentClaims: newestClaims(assets.claims),
    };
  }

  if (role === "auditor") {
    const decidedReviewIds = new Set(decisions.filter((decision) => decision.auditorId === subjectId).map((decision) => decision.reviewId));
    const queue = reviews.filter((review) =>
      review.status === "OPEN" && Boolean(subjectId) && review.assignedAuditorIds.includes(subjectId!) && !decidedReviewIds.has(review.id),
    );
    return {
      title: "Independent claim audit",
      description: "Vote with an assigned Fabric identity; no single auditor can finalize a claim.",
      metrics: [
        { label: "Assigned votes", value: queue.length, hint: "open rounds awaiting your vote" },
        { label: "Approved", value: assets.claims.filter((item) => ["APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"].includes(item.status)).length, hint: "positive decisions" },
        { label: "Evidence audits", value: assets.evidenceAccess.filter((item) => item.accessorRole === "auditor").length, hint: "auditor retrieval events" },
      ],
      queueTitle: "Claims requiring a decision",
      queue: queue.map((review) => ({
        id: review.id,
        title: review.claimId,
        detail: `Round ${review.round} · ${review.approvals}/${review.approvalThreshold} approve · ${review.rejections}/${review.rejectionThreshold} reject`,
        status: review.status,
        commandLabel: "Prepare decision",
        command: {
          operation: "recordAuditorDecision",
          reviewId: review.id,
          decisionId: `decision-${Date.now()}-${review.id}`,
          outcome: "APPROVE",
          reasonHash: "a".repeat(64),
        },
      })),
      recentClaims: newestClaims(assets.claims),
    };
  }

  if (role === "bankOfficer") {
    const pendingMandates = mandates.filter((item) => item.status === "PENDING");
    const dueCollections = premiumCollections.filter((item) => ["DUE", "RETRY"].includes(item.status));
    const readyBenefits = benefitRequests.filter((item) => item.status === "PAYMENT_READY");
    const readySettlements = assets.settlements.filter((item) => item.status === "AUTHORIZED");
    const queue: DashboardItem[] = [
      ...pendingMandates.map((mandate) => ({ id: mandate.id, title: mandate.id, detail: `${money(mandate.amountMinor)} · policy ${mandate.policyId}`, status: mandate.status, commandLabel: "Review mandate", command: { operation: "reviewBankMandate", id: mandate.id, outcome: "APPROVE" } })),
      ...dueCollections.map((collection) => ({ id: collection.id, title: collection.id, detail: `${money(collection.amountMinor)} · due ${collection.dueDate}`, status: collection.status, commandLabel: "Reconcile collection", command: { operation: "completePremiumCollection", collectionId: collection.id } })),
      ...readyBenefits.map((benefit) => ({ id: benefit.id, title: benefit.id, detail: `${money(benefit.amountMinor)} · ${benefit.benefitType.toLowerCase()} benefit`, status: benefit.status, commandLabel: "Confirm payout", command: { operation: "confirmBenefitPayment", id: benefit.id } })),
      ...readySettlements.map((settlement) => ({ id: settlement.id, title: settlement.id, detail: `${money(settlement.amountMinor)} · claim ${settlement.claimId}`, status: settlement.status, commandLabel: "Prepare confirmation", command: { operation: "confirmSettlement", settlementId: settlement.id } })),
    ];
    return {
      title: "Banking operations desk",
      description: "Review debit mandates, reconcile premium collections, and confirm claim and benefit payouts.",
      metrics: [
        { label: "Bank action queue", value: queue.length, hint: "mandates, collections, and payouts" },
        { label: "Premium receipts", value: premiumPayments.length, hint: "replay-protected confirmations" },
        { label: "Paid liabilities", value: liabilities.filter((item) => item.status === "PAID").length, hint: "external transfers reconciled" },
      ],
      queueTitle: "Mandates, collections, and payouts",
      queue,
      recentClaims: newestClaims(assets.claims.filter((claim) =>
        assets.settlements.some((settlement) => settlement.claimId === claim.id),
      )),
    };
  }

  const reviewQueue = assets.claims.filter((claim) =>
    ["HOSPITAL_VERIFIED", "APPEAL_SUBMITTED", "APPROVED"].includes(claim.status),
  );
  return {
    title: "Portfolio oversight",
    description: "Govern packages, monitor claims, initiate audit review, and authorize settlements.",
    metrics: [
      { label: "Published packages", value: assets.packages.filter((item) => item.status === "PUBLISHED").length, hint: "available product definitions" },
      { label: "Active policies", value: assets.policies.filter((item) => item.status === "ACTIVE").length, hint: "issued coverage records" },
      { label: "Open claims", value: assets.claims.filter((item) => !terminalClaimStatuses.has(item.status)).length, hint: "portfolio work in progress" },
      { label: "High-risk advisories", value: fraudAssessments.filter((item) => item.riskLevel === "HIGH").length, hint: "triage only; never automatic rejection" },
      { label: "Needs insurer action", value: reviewQueue.length + benefitRequests.filter((item) => ["SUBMITTED", "FUNDING_REQUIRED"].includes(item.status)).length, hint: "claims and benefit liabilities" },
    ],
    queueTitle: "Insurer action queue",
    queue: [
      ...benefitRequests.filter((item) => ["SUBMITTED", "FUNDING_REQUIRED"].includes(item.status)).map((benefit) => ({
        id: benefit.id, title: benefit.id, detail: `${money(benefit.amountMinor)} · ${benefit.benefitType.toLowerCase()} benefit`, status: benefit.status,
        commandLabel: benefit.status === "SUBMITTED" ? "Prepare decision" : "Record funding",
        command: benefit.status === "SUBMITTED" ? { operation: "decideBenefitRequest", id: benefit.id, outcome: "APPROVE" } : { operation: "markBenefitPaymentReady", id: benefit.id },
      })),
      ...reviewQueue.map((claim) => {
      const approved = claim.status === "APPROVED";
      const appealed = claim.status === "APPEAL_SUBMITTED";
      return {
        id: claim.id,
        title: claim.id,
        detail: `${money(claim.amountMinor)} · policy ${claim.policyId}`,
        status: claim.status,
        commandLabel: approved ? "Prepare settlement" : appealed ? "Prepare appeal review" : "Prepare distributed review",
        command: approved
          ? { operation: "authorizeSettlement", settlementId: `settlement-${Date.now()}-${claim.id}`, claimId: claim.id }
          : appealed
            ? { operation: "openAppealReview", appealId: claim.currentAppealId, reviewId: `review-appeal-${Date.now()}-${claim.id}` }
            : { operation: "openClaimReview", claimId: claim.id, reviewId: `review-${Date.now()}-${claim.id}` },
      };
      }),
    ],
    recentClaims: newestClaims(assets.claims),
  };
}
