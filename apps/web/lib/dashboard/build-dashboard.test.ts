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
    { assetType: "claim", schemaVersion: 1, id: "claim-submitted", policyId: "policy-mine", claimantId: "policyholder1", amountMinor: 10000, incidentDate: "2026-06-01", descriptionHash: "a".repeat(64), evidenceIds: [], hospitalVerificationId: "", auditorDecisionId: "", status: "SUBMITTED", createdAt: timestamp, updatedAt: timestamp },
    { assetType: "claim", schemaVersion: 1, id: "claim-review", policyId: "policy-other", claimantId: "other", amountMinor: 20000, incidentDate: "2026-06-02", descriptionHash: "a".repeat(64), evidenceIds: ["evidence-1"], hospitalVerificationId: "verification-1", auditorDecisionId: "", status: "UNDER_REVIEW", createdAt: timestamp, updatedAt: timestamp },
  ],
  evidence: [],
  settlements: [{ assetType: "settlement", schemaVersion: 1, id: "settlement-1", claimId: "claim-review", amountMinor: 20000, status: "AUTHORIZED", bankReferenceHash: "", authorizedAt: timestamp, confirmedAt: "" }],
  evidenceAccess: [],
};

describe("role dashboards", () => {
  it("filters policyholder assets by ledger subject", () => {
    const dashboard = buildRoleDashboard("policyholder", assets, "policyholder1");
    expect(dashboard.queue.map((item) => item.id)).toEqual(["policy-mine"]);
    expect(dashboard.recentClaims.map((claim) => claim.id)).toEqual(["claim-submitted"]);
  });

  it("builds organization-specific work queues", () => {
    expect(buildRoleDashboard("hospitalOfficer", assets).queue[0]?.id).toBe("claim-submitted");
    expect(buildRoleDashboard("auditor", assets).queue[0]?.id).toBe("claim-review");
    expect(buildRoleDashboard("bankOfficer", assets).queue[0]?.id).toBe("settlement-1");
  });
});
