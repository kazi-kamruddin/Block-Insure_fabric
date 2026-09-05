import type { FabricRole } from "@/lib/fabric/config";
import type {
  Claim,
  EvidenceReference,
  EvidenceAccessRecord,
  Policy,
  PolicyPackage,
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
  const ownedPolicies = role === "policyholder"
    ? assets.policies.filter((policy) => policy.policyholderId === subjectId)
    : assets.policies;
  const ownedClaims = role === "policyholder"
    ? assets.claims.filter((claim) => claim.claimantId === subjectId)
    : assets.claims;
  const ownedClaimIds = new Set(ownedClaims.map((claim) => claim.id));
  const visibleSettlements = role === "policyholder"
    ? assets.settlements.filter((settlement) => ownedClaimIds.has(settlement.claimId))
    : assets.settlements;
  const visibleEvidence = role === "policyholder"
    ? assets.evidence.filter((item) => item.submittedBy === subjectId)
    : assets.evidence;

  if (role === "policyholder") {
    return {
      title: "Coverage and claims overview",
      description: "Your owned policies, active claims, evidence anchors, and confirmed settlements.",
      metrics: [
        { label: "Active policies", value: ownedPolicies.filter((item) => item.status === "ACTIVE").length, hint: "coverage issued to you" },
        { label: "Open claims", value: ownedClaims.filter((item) => !terminalClaimStatuses.has(item.status)).length, hint: "still moving through the network" },
        { label: "Evidence anchors", value: visibleEvidence.length, hint: "ciphertext references on ledger" },
        { label: "Settled", value: visibleSettlements.filter((item) => item.status === "CONFIRMED").length, hint: "bank-confirmed claims" },
      ],
      queueTitle: "Your active coverage",
      queue: ownedPolicies.map((policy) => ({
        id: policy.id,
        title: policy.id,
        detail: `${money(policy.coverageLimitMinor)} coverage · ends ${policy.endDate}`,
        status: policy.status,
        commandLabel: "Prepare claim",
        command: {
          operation: "submitClaim",
          id: `claim-${Date.now()}`,
          policyId: policy.id,
          amountMinor: 250000,
          incidentDate: new Date().toISOString().slice(0, 10),
          descriptionHash: "a".repeat(64),
        },
      })),
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
    const queue = assets.claims.filter((claim) => claim.status === "UNDER_REVIEW");
    return {
      title: "Independent claim audit",
      description: "Review hospital-verified claims and record one immutable auditor decision.",
      metrics: [
        { label: "Decision queue", value: queue.length, hint: "claims under review" },
        { label: "Approved", value: assets.claims.filter((item) => ["APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"].includes(item.status)).length, hint: "positive decisions" },
        { label: "Evidence audits", value: assets.evidenceAccess.filter((item) => item.accessorRole === "auditor").length, hint: "auditor retrieval events" },
      ],
      queueTitle: "Claims requiring a decision",
      queue: queue.map((claim) => ({
        id: claim.id,
        title: claim.id,
        detail: `${money(claim.amountMinor)} · ${claim.evidenceIds.length} evidence reference(s)`,
        status: claim.status,
        commandLabel: "Prepare decision",
        command: {
          operation: "recordAuditorDecision",
          claimId: claim.id,
          decisionId: `decision-${Date.now()}-${claim.id}`,
          outcome: "APPROVE",
          reasonHash: "a".repeat(64),
        },
      })),
      recentClaims: newestClaims(assets.claims),
    };
  }

  if (role === "bankOfficer") {
    const queue = assets.settlements.filter((item) => item.status === "AUTHORIZED");
    return {
      title: "Settlement confirmation desk",
      description: "Confirm external EFT references for insurer-authorized settlements.",
      metrics: [
        { label: "Awaiting confirmation", value: queue.length, hint: "authorized settlements" },
        { label: "Confirmed", value: assets.settlements.filter((item) => item.status === "CONFIRMED").length, hint: "bank references committed" },
        { label: "Total settlements", value: assets.settlements.length, hint: "ledger settlement records" },
      ],
      queueTitle: "Authorized settlements",
      queue: queue.map((settlement) => ({
        id: settlement.id,
        title: settlement.id,
        detail: `${money(settlement.amountMinor)} · claim ${settlement.claimId}`,
        status: settlement.status,
        commandLabel: "Prepare confirmation",
        command: {
          operation: "confirmSettlement",
          settlementId: settlement.id,
          bankReferenceHash: "a".repeat(64),
        },
      })),
      recentClaims: newestClaims(assets.claims.filter((claim) =>
        assets.settlements.some((settlement) => settlement.claimId === claim.id),
      )),
    };
  }

  const reviewQueue = assets.claims.filter((claim) =>
    ["HOSPITAL_VERIFIED", "APPROVED"].includes(claim.status),
  );
  return {
    title: "Portfolio oversight",
    description: "Govern packages, monitor claims, initiate audit review, and authorize settlements.",
    metrics: [
      { label: "Published packages", value: assets.packages.filter((item) => item.status === "PUBLISHED").length, hint: "available product definitions" },
      { label: "Active policies", value: assets.policies.filter((item) => item.status === "ACTIVE").length, hint: "issued coverage records" },
      { label: "Open claims", value: assets.claims.filter((item) => !terminalClaimStatuses.has(item.status)).length, hint: "portfolio work in progress" },
      { label: "Needs insurer action", value: reviewQueue.length, hint: "review or settlement step" },
    ],
    queueTitle: "Insurer action queue",
    queue: reviewQueue.map((claim) => {
      const approved = claim.status === "APPROVED";
      return {
        id: claim.id,
        title: claim.id,
        detail: `${money(claim.amountMinor)} · policy ${claim.policyId}`,
        status: claim.status,
        commandLabel: approved ? "Prepare settlement" : "Prepare review",
        command: approved
          ? { operation: "authorizeSettlement", settlementId: `settlement-${Date.now()}-${claim.id}`, claimId: claim.id }
          : { operation: "startClaimReview", claimId: claim.id },
      };
    }),
    recentClaims: newestClaims(assets.claims),
  };
}
