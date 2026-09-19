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

  it("reports 2-of-3 fault tolerance without hiding safety violations", () => {
    const request: ResearchInput["oracleRequests"][number] = {
      assetType: "oracleRequest", schemaVersion: 13, id: "request-1", claimId: "claim-1", claimVersion: 1,
      hospitalVerificationId: "verification-1", appealId: "", appealCommitmentHash: "", queryHash: "a".repeat(64),
      registrySnapshotId: "registry-1", registryVersion: 1, registryRootHash: "b".repeat(64), rulesVersion: "rules-v1", rulesHash: "c".repeat(64),
      modelVersion: "model-v1", modelHash: "d".repeat(64), assignedOracleIds: ["oracle1", "oracle2", "oracle3"], requiredConfirmations: 2,
      expectedResponses: 3, commitmentCount: 2, revealCount: 2, status: "CONSENSUS", verifiedResult: true, resultHash: "e".repeat(64),
      finalizationCode: "EXACT_CONSENSUS", commitDeadline: "2026-09-06T12:01:00Z", revealDeadline: "2026-09-06T12:02:00Z",
      requestedAt: "2026-09-06T12:00:00Z", finalizedAt: "2026-09-06T12:01:10Z",
    };
    const result = (oracleId: string): ResearchInput["oracleResults"][number] => ({
      assetType: "oracleResult", schemaVersion: 13, id: `request-1:${oracleId}`, requestId: "request-1", claimId: "claim-1", claimVersion: 1,
      registryVersion: 1, modelVersion: "model-v1", oracleId, oracleIdentity: oracleId, verified: true, verificationCode: "VERIFIED",
      recordHash: "f".repeat(64), resultHash: "e".repeat(64), createdAt: "2026-09-06T12:01:00Z",
    });
    const snapshot = buildResearchSnapshot({ ...empty, oracleRequests: [request], oracleResults: [result("oracle1"), result("oracle2")] }, provenance);
    expect(snapshot.oracleConsensus).toMatchObject({ meanRevealParticipationBps: 6667, observedFaultTolerantFinalizations: 1, safetyViolations: 0 });
  });
});
