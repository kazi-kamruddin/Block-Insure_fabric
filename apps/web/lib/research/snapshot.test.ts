import { describe, expect, it } from "vitest";
import { buildResearchSnapshot, type ResearchInput } from "./snapshot";

const empty: ResearchInput = { policies: [], claims: [], reviews: [], decisions: [], appeals: [], fraudAssessments: [], evidence: [], evidenceGrants: [], evidenceAccess: [], settlements: [], premiumPayments: [], premiumAdjustments: [], benefitRequests: [], liabilities: [], oracleRequests: [], oracleResults: [] };
const provenance = { channel: "insurance-channel", chaincode: "insurance-contract", ledgerSchemaVersion: 6, checkpoint: null, indexedEvents: 0, retainedEvents: 0, eventCounts: {} };

describe("research snapshot", () => {
  it("is reproducible for the same ledger state across export times", () => {
    const first = buildResearchSnapshot(empty, provenance, "2026-09-06T12:00:00Z");
    const second = buildResearchSnapshot(empty, provenance, "2026-09-06T13:00:00Z");
    expect(first.reproducibilityHash).toBe(second.reproducibilityHash);
    expect(first.fraudDecisionSupport.advisoryOnly).toBe(true);
  });

  it("separates expired and exhausted evidence grants", () => {
    const grant = { assetType: "evidenceGrant", schemaVersion: 5, id: "grant-1", evidenceId: "evidence-1", claimId: "claim-1", ownerId: "policyholder1", granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: "auditor1", purpose: "AUDIT", expiresAt: "2026-09-07T00:00:00Z", maxAccesses: 1, accessCount: 1, status: "ACTIVE", createdAt: "2026-09-06T00:00:00Z", revokedAt: "" } as const;
    const snapshot = buildResearchSnapshot({ ...empty, evidenceGrants: [grant] }, provenance, "2026-09-06T12:00:00Z");
    expect(snapshot.evidenceGovernance.grantState.EXHAUSTED).toBe(1);
  });
});
