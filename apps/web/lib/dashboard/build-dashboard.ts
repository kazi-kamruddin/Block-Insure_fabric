import type { FabricRole } from "@/lib/fabric/config";
import type {
  BankMandate,
  BankAccountReference,
  BankTransfer,
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
  OracleRequest,
  PartnerAgreement,
  HospitalInvoice,
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
  accountCards?: Array<{ id: string; label: string; maskedAccount: string; accountType: string; balanceMinor: number; currency: string; status: string }>;
};

export type DashboardAssets = {
  packages: PolicyPackage[];
  policies: Policy[];
  claims: Claim[];
  evidence: EvidenceReference[];
  settlements: Settlement[];
  evidenceAccess: EvidenceAccessRecord[];
  mandates?: BankMandate[];
  bankAccounts?: BankAccountReference[];
  bankTransfers?: BankTransfer[];
  premiumPayments?: PremiumPayment[];
  premiumCollections?: PremiumCollection[];
  benefitRequests?: BenefitRequest[];
  liabilities?: Liability[];
  reviews?: ClaimReview[];
  appeals?: ClaimAppeal[];
  decisions?: AuditorDecision[];
  fraudAssessments?: FraudAssessment[];
  oracleRequests?: OracleRequest[];
  partnerAgreements?: PartnerAgreement[];
  hospitalInvoices?: HospitalInvoice[];
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
  const bankAccounts = assets.bankAccounts ?? [];
  const bankTransfers = assets.bankTransfers ?? [];
  const premiumPayments = assets.premiumPayments ?? [];
  const premiumCollections = assets.premiumCollections ?? [];
  const benefitRequests = assets.benefitRequests ?? [];
  const reviews = assets.reviews ?? [];
  const decisions = assets.decisions ?? [];
  const fraudAssessments = assets.fraudAssessments ?? [];
  const oracleRequests = assets.oracleRequests ?? [];
  const partnerAgreements = assets.partnerAgreements ?? [];
  const hospitalInvoices = assets.hospitalInvoices ?? [];
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
          operation: "submitClaim", id: `claim-${Date.now()}`, policyId: policy.id, hospitalId: "hospital-demo",
          hospitalInvoiceId: "", amountMinor: 250000, incidentDate: new Date().toISOString().slice(0, 10), descriptionHash: "a".repeat(64),
        } : { operation: "requestBankMandate", policyId: policy.id },
        })),
      ],
      recentClaims: newestClaims(ownedClaims),
      accountCards: bankAccounts.filter((item) => item.ownerId === subjectId).map((item) => ({ id: item.id, label: item.accountLabel, maskedAccount: item.maskedAccount, accountType: item.accountType, balanceMinor: item.balanceMinor, currency: item.currency, status: item.status })),
    };
  }

  if (role === "hospitalOfficer") {
    const ownInvoices = hospitalInvoices.filter((invoice) => invoice.hospitalId === subjectId);
    const agreement = partnerAgreements.find((item) => item.partnerType === "HOSPITAL" && item.partnerId === subjectId && item.status !== "ENDED");
    const drafts = ownInvoices.filter((invoice) => invoice.status === "DRAFT");
    return {
      title: "Independent Hospital billing register",
      description: "Maintain this Hospital's patient invoices independently. Block-Insure receives agreement-scoped, read-only verification access.",
      metrics: [
        { label: "Patient invoices", value: ownInvoices.length, hint: "records owned by this Hospital" },
        { label: "Draft invoices", value: drafts.length, hint: "still editable before finalization" },
        { label: "Finalized invoices", value: ownInvoices.filter((item) => item.status === "FINALIZED").length, hint: "available for insurer cross-check" },
        { label: "Agreement active", value: agreement?.status === "ACTIVE" ? 1 : 0, hint: agreement ? `${agreement.name} · ${agreement.tier || "network partner"}` : "no active insurer agreement" },
      ],
      queueTitle: "Draft invoice work",
      queue: drafts.map((invoice) => ({
        id: invoice.id,
        title: invoice.id,
        detail: `${money(invoice.amountMinor)} · ${invoice.admissionDate} to ${invoice.dischargeDate}`,
        status: invoice.status,
        commandLabel: "Update invoice",
        command: {
          operation: "updateHospitalInvoice",
          id: invoice.id,
          amountMinor: invoice.amountMinor,
          admissionDate: invoice.admissionDate,
          dischargeDate: invoice.dischargeDate,
          status: invoice.status,
        },
      })),
      recentClaims: [],
    };
  }

  if (role === "auditor") {
    const decidedReviewIds = new Set(decisions.filter((decision) => decision.auditorId === subjectId).map((decision) => decision.reviewId));
    const ownDecisions = decisions.filter((decision) => decision.auditorId === subjectId);
    const finalizedById = new Map(reviews.filter((review) => ["APPROVED", "REJECTED"].includes(review.status)).map((review) => [review.id, review.status]));
    const alignedDecisions = ownDecisions.filter((decision) =>
      (decision.outcome === "APPROVE" && finalizedById.get(decision.reviewId) === "APPROVED")
      || (decision.outcome === "REJECT" && finalizedById.get(decision.reviewId) === "REJECTED"),
    ).length;
    const queue = reviews.filter((review) =>
      review.status === "OPEN" && Boolean(subjectId) && review.assignedAuditorIds.includes(subjectId!) && !decidedReviewIds.has(review.id),
    );
    return {
      title: "Independent claim audit",
      description: "Vote with an assigned Fabric identity; no single auditor can finalize a claim.",
      metrics: [
        { label: "Assigned votes", value: queue.length, hint: "open rounds awaiting your vote" },
        { label: "Decision history", value: ownDecisions.length, hint: ownDecisions.length ? `${Math.round((alignedDecisions / ownDecisions.length) * 100)}% final-outcome alignment` : "observational; never quorum weight" },
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
    const readySettlements = assets.settlements.filter((item) => ["AUTHORIZED", "PAYMENT_FAILED"].includes(item.status));
    const queue: DashboardItem[] = [
      ...pendingMandates.map((mandate) => ({ id: mandate.id, title: mandate.id, detail: `${money(mandate.amountMinor)} · policy ${mandate.policyId}`, status: mandate.status, commandLabel: "Review mandate", command: { operation: "reviewBankMandate", id: mandate.id, outcome: "APPROVE" } })),
      ...dueCollections.map((collection) => ({ id: collection.id, title: collection.id, detail: `${money(collection.amountMinor)} · due ${collection.dueDate}`, status: collection.status, commandLabel: "Process EFT", command: { operation: "processPremiumCollection", collectionId: collection.id, destinationAccountId: "bank-insurer-premium" } })),
      ...readyBenefits.map((benefit) => ({ id: benefit.id, title: benefit.id, detail: `${money(benefit.amountMinor)} · ${benefit.benefitType.toLowerCase()} benefit`, status: benefit.status, commandLabel: "Confirm payout", command: { operation: "confirmBenefitPayment", id: benefit.id } })),
      ...readySettlements.map((settlement) => ({ id: settlement.id, title: settlement.id, detail: `${money(settlement.amountMinor)} · ${settlement.destinationAccountId}${settlement.failureCode ? ` · ${settlement.failureCode}` : ""}`, status: settlement.status, commandLabel: settlement.status === "PAYMENT_FAILED" ? "Retry payout" : "Execute payout", command: { operation: "confirmSettlement", settlementId: settlement.id, transferId: `payout-transfer-${Date.now()}-${settlement.id}` } })),
    ];
    return {
      title: "Banking operations desk",
      description: "Operate the connected Bank simulation: maintain balances, approve EFT mandates, and process deterministic premium debits.",
      metrics: [
        { label: "Bank action queue", value: queue.length, hint: "mandates, collections, and payouts" },
        { label: "Customer balances", value: bankAccounts.filter((item) => item.accountType === "CUSTOMER").reduce((sum, item) => sum + item.balanceMinor, 0) / 100, hint: "BDT across verified demo accounts" },
        { label: "Settled / bounced", value: bankTransfers.filter((item) => item.status === "SETTLED").length, hint: `${bankTransfers.filter((item) => item.status === "BOUNCED").length} bounced for insufficient funds` },
      ],
      queueTitle: "Mandates, collections, and payouts",
      queue,
      recentClaims: [],
      accountCards: bankAccounts.map((item) => ({ id: item.id, label: item.accountLabel, maskedAccount: item.maskedAccount, accountType: item.accountType, balanceMinor: item.balanceMinor, currency: item.currency, status: item.status })),
    };
  }

  const reviewQueue = assets.claims.filter((claim) =>
    ["SUBMITTED", "HOSPITAL_VERIFIED", "ORACLE_FAILED", "APPROVED"].includes(claim.status)
      || (claim.status === "APPEAL_SUBMITTED" && Boolean(claim.hospitalVerificationId)),
  );
  return {
    title: "Portfolio oversight",
    description: "Govern packages, monitor claims, initiate audit review, and authorize settlements.",
    metrics: [
      { label: "Published packages", value: assets.packages.filter((item) => item.status === "PUBLISHED").length, hint: "available product definitions" },
      { label: "Active partners", value: partnerAgreements.filter((item) => item.status === "ACTIVE").length, hint: "contracted Hospitals and Banks" },
      { label: "Active policies", value: assets.policies.filter((item) => item.status === "ACTIVE").length, hint: "issued coverage records" },
      { label: "Open claims", value: assets.claims.filter((item) => !terminalClaimStatuses.has(item.status)).length, hint: "portfolio work in progress" },
      { label: "Oracle consensus", value: oracleRequests.filter((item) => item.finalizationCode === "EXACT_CONSENSUS").length, hint: "two exact certificate-bound results" },
      { label: "Oracle fallback", value: oracleRequests.filter((item) => item.status === "FAILED").length, hint: "negative, conflict, or timeout" },
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
      const oracleFailed = claim.status === "ORACLE_FAILED";
      const needsInvoiceCheck = claim.status === "SUBMITTED";
      return {
        id: claim.id,
        title: claim.id,
        detail: `${money(claim.amountMinor)} · policy ${claim.policyId}`,
        status: claim.status,
        commandLabel: approved ? "Prepare settlement" : oracleFailed ? "Prepare auditor fallback" : needsInvoiceCheck ? "Cross-check invoice" : "Prepare Oracle request",
        command: approved
          ? { operation: "authorizeSettlement", settlementId: `settlement-${Date.now()}-${claim.id}`, claimId: claim.id, sourceAccountId: "bank-insurer-premium", destinationAccountId: "showcase-customer-account" }
          : oracleFailed
            ? { operation: "routeOracleFailureToReview", requestId: claim.currentOracleRequestId, reviewId: `review-oracle-${Date.now()}-${claim.id}` }
            : needsInvoiceCheck
              ? { operation: "crossCheckClaimInvoice", claimId: claim.id, verificationId: `invoice-check-${Date.now()}-${claim.id}` }
            : { operation: "requestOracleVerification", requestId: `oracle-request-${Date.now()}-${claim.id}`, claimId: claim.id, snapshotId: "registry-demo-v1" },
      };
      }),
    ],
    recentClaims: newestClaims(assets.claims),
  };
}
