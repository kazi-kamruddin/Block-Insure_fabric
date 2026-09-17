import { describe, expect, it } from "vitest";
import type { DashboardAssets } from "./build-dashboard";
import { buildRoleDashboard } from "./build-dashboard";

const timestamp = "2026-09-05T12:00:00Z";
const assets: DashboardAssets = {
  packages: [{ assetType: "policyPackage", schemaVersion: 1, id: "package-1", version: 1, name: "Health", description: "", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: "a".repeat(64), status: "PUBLISHED", createdAt: timestamp, updatedAt: timestamp }],
  policies: [
    { assetType: "policy", schemaVersion: 1, id: "policy-mine", packageId: "package-1", packageVersion: 1, policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: "a".repeat(64), status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp },
    { assetType: "policy", schemaVersion: 1, id: "policy-other", packageId: "package-1", packageVersion: 1, policyholderId: "other", startDate: "2026-01-01", endDate: "2026-12-31", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: "a".repeat(64), status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp },
  ],
  claims: [
    { assetType: "claim", schemaVersion: 7, id: "claim-submitted", policyId: "policy-mine", hospitalId: "hospital-demo", claimantId: "policyholder1", amountMinor: 10000, incidentDate: "2026-06-01", descriptionHash: "a".repeat(64), evidenceIds: [], hospitalVerificationId: "", auditorDecisionId: "", currentReviewId: "", currentAppealId: "", currentOracleRequestId: "", oracleOutcome: "", oracleResultHash: "", version: 1, reviewRound: 0, appealCount: 0, status: "SUBMITTED", createdAt: timestamp, updatedAt: timestamp },
    { assetType: "claim", schemaVersion: 7, id: "claim-review", policyId: "policy-other", hospitalId: "hospital-2", claimantId: "other", amountMinor: 20000, incidentDate: "2026-06-02", descriptionHash: "a".repeat(64), evidenceIds: ["evidence-1"], hospitalVerificationId: "verification-1", auditorDecisionId: "", currentReviewId: "review-1", currentAppealId: "", currentOracleRequestId: "", oracleOutcome: "", oracleResultHash: "", version: 1, reviewRound: 1, appealCount: 0, status: "UNDER_REVIEW", createdAt: timestamp, updatedAt: timestamp },
  ],
  evidence: [],
  settlements: [{ assetType: "settlement", schemaVersion: 1, id: "settlement-1", claimId: "claim-review", amountMinor: 20000, status: "AUTHORIZED", bankReferenceHash: "", authorizedAt: timestamp, confirmedAt: "" }],
  evidenceAccess: [],
  partnerAgreements: [{ assetType: "partnerAgreement", schemaVersion: 8, id: "agreement-hospital-demo", partnerType: "HOSPITAL", partnerId: "hospital-demo", name: "Dhaka Central Medical Hospital", location: "Dhaka", tier: "Preferred", accessScope: "Read-only invoices", effectiveDate: "2026-01-01", expiryDate: "2028-12-31", status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp }],
  hospitalInvoices: [{ assetType: "hospitalInvoice", schemaVersion: 8, id: "invoice-draft", hospitalId: "hospital-demo", patientReferenceHash: "a".repeat(64), invoiceReferenceHash: "b".repeat(64), treatmentHash: "c".repeat(64), amountMinor: 10000, admissionDate: "2026-06-01", dischargeDate: "2026-06-02", status: "DRAFT", createdAt: timestamp, updatedAt: timestamp }],
  reviews: [{ assetType: "claimReview", schemaVersion: 4, id: "review-1", claimId: "claim-review", appealId: "", round: 1, kind: "INITIAL", assignedAuditorIds: ["auditor1", "auditor2", "auditor3", "auditor4"], approvalThreshold: 3, rejectionThreshold: 2, approvals: 0, rejections: 0, votesCast: 0, status: "OPEN", deadline: "2026-09-08T12:00:00Z", openedAt: timestamp, closedAt: "" }],
  decisions: [],
};

describe("role dashboards", () => {
  it("filters policyholder assets by ledger subject", () => {
    const dashboard = buildRoleDashboard("policyholder", assets, "policyholder1");
    expect(dashboard.queue.map((item) => item.id)).toEqual(["policy-mine"]);
    expect(dashboard.recentClaims.map((claim) => claim.id)).toEqual(["claim-submitted"]);
  });

  it("builds organization-specific work queues", () => {
    expect(buildRoleDashboard("hospitalOfficer", assets, "hospital-demo").queue[0]?.id).toBe("invoice-draft");
    expect(buildRoleDashboard("hospitalOfficer", assets, "hospital-2").queue).toEqual([]);
    expect(buildRoleDashboard("auditor", assets, "auditor1").queue[0]?.id).toBe("review-1");
    expect(buildRoleDashboard("bankOfficer", assets).queue[0]?.id).toBe("settlement-1");
  });
});
