import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrivacyFixture } from "../lib/privacy-fixture.mjs";
import { buildResultDigest, oracleRequestPhase } from "../../services/oracle-worker/src/protocol.mjs";
import { verifySelectiveDisclosurePresentation } from "../../services/oracle-worker/src/privacy.mjs";
import { appealCommitmentHash, assessRegistryRecord, loadRegistrySnapshot, validateAppealBinding } from "../../services/oracle-worker/src/registry.mjs";
import { evaluateThreshold } from "../../services/oracle-worker/src/threshold-model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(here, "../../services/oracle-worker");

export const securityCases = {
  async singleMaliciousOracle() {
    const result = evaluateThreshold({ responses: ["good", "bad", "good"], requiredConfirmations: 2, expectedResponses: 3 });
    assert.deepEqual(result, { status: "CONSENSUS", resultHash: "good", matchingResponses: 2, revealedResponses: 3 });
    const collusion = evaluateThreshold({ responses: ["bad", "bad", "good"], requiredConfirmations: 2, expectedResponses: 3 });
    assert.equal(collusion.resultHash, "bad");
    return { observed: "one conflicting vote contained", trustBoundaryConfirmed: "two colluding votes can form quorum" };
  },

  async unavailableOracle() {
    const result = evaluateThreshold({ responses: ["good", "good", null], requiredConfirmations: 2, expectedResponses: 3, deadlineExpired: true });
    assert.equal(result.status, "CONSENSUS");
    assert.equal(result.matchingResponses, 2);
    return { observed: "consensus with one unavailable worker" };
  },

  async conflictingRegistry() {
    const [baseline, corrupt] = await Promise.all([
      loadRegistrySnapshot(path.join(workerRoot, "registry/oracle1-v1.json")),
      loadRegistrySnapshot(path.join(workerRoot, "registry/oracle2-conflict-v1.json")),
    ]);
    const record = baseline.records[0];
    const request = {
      claimVersion: 1,
      appealId: "",
      appealCommitmentHash: "",
      registrySnapshotId: baseline.snapshotId,
      registryVersion: baseline.version,
      registryRootHash: baseline.rootHash,
      rulesVersion: baseline.rulesVersion,
      rulesHash: baseline.rulesHash,
      modelVersion: "model-v1",
      modelHash: "c".repeat(64),
    };
    const input = {
      request,
      claim: { hospitalId: record.hospitalId, amountMinor: record.minimumAmountMinor, incidentDate: record.validFrom, descriptionHash: record.descriptionHash },
      hospitalVerification: { claimVersion: 1, appealId: "", clinicalReferenceHash: record.lookupHash },
      appeal: null,
    };
    assert.equal(assessRegistryRecord({ snapshot: baseline, ...input }).verificationCode, "VERIFIED");
    assert.equal(assessRegistryRecord({ snapshot: corrupt, ...input }).verificationCode, "REGISTRY_ROOT_MISMATCH");
    return { observed: "corrupt replica rejected by root binding" };
  },

  async replayAndStaleResult() {
    const request = {
      id: "request-1", claimId: "claim-1", queryHash: "1".repeat(64), claimVersion: 1,
      hospitalVerificationId: "verification-1", appealId: "", appealCommitmentHash: "",
      registrySnapshotId: "registry-1", registryVersion: 1, registryRootHash: "2".repeat(64),
      rulesVersion: "rules-v1", rulesHash: "3".repeat(64), modelVersion: "model-v1", modelHash: "4".repeat(64),
    };
    const assessment = { verified: true, verificationCode: "VERIFIED", recordHash: "5".repeat(64) };
    const digest = buildResultDigest(request, assessment);
    assert.notEqual(digest, buildResultDigest({ ...request, id: "request-2" }, assessment));
    assert.notEqual(digest, buildResultDigest({ ...request, claimVersion: 2 }, assessment));
    assert.notEqual(digest, buildResultDigest({ ...request, registryVersion: 2 }, assessment));
    assert.notEqual(digest, buildResultDigest({ ...request, modelVersion: "model-v2" }, assessment));
    return { observed: "request, claim, registry, and model replay bindings changed the digest" };
  },

  async alteredPrivacyProof() {
    const fixture = buildPrivacyFixture();
    const valid = verifySelectiveDisclosurePresentation({
      request: fixture.requestBinding, claim: fixture.claim,
      publicPresentation: fixture.publicPresentation, privatePresentation: fixture.privatePresentation,
      now: Date.parse("2026-09-19T00:00:00Z"),
    });
    assert.equal(valid.valid, true);
    const altered = structuredClone(fixture.privatePresentation);
    altered.disclosures.find((item) => item.name === "amountMinor").value = "1";
    const rejected = verifySelectiveDisclosurePresentation({
      request: fixture.requestBinding, claim: fixture.claim,
      publicPresentation: fixture.publicPresentation, privatePresentation: altered,
      now: Date.parse("2026-09-19T00:00:00Z"),
    });
    assert.deepEqual(rejected, { valid: false, code: "PRIVACY_PROOF_INVALID" });
    return { observed: "altered disclosure rejected" };
  },

  async lateReveal() {
    const request = { status: "PENDING", commitmentCount: 1, expectedResponses: 3, commitDeadline: "2026-09-19T00:01:00Z", revealDeadline: "2026-09-19T00:02:00Z" };
    assert.equal(oracleRequestPhase(request, Date.parse("2026-09-19T00:02:01Z")), "TIMED_OUT");
    return { observed: "expired request entered terminal timeout phase" };
  },

  async appealSubstitution() {
    const appeal = {
      id: "appeal-1", claimId: "claim-1", claimVersion: 2,
      commitmentVersion: "block-insure-fabric-appeal-v1", reasonCategory: "DOCUMENT_ERROR",
      reasonHash: "a".repeat(64), descriptionHash: "b".repeat(64), evidenceHash: "c".repeat(64), originalClaimHash: "d".repeat(64),
      proposedHospitalId: "hospital-demo", proposedAmountMinor: 50_000, proposedIncidentDate: "2026-06-15",
      proposedDescriptionHash: "e".repeat(64), proposedClinicalReferenceHash: "f".repeat(64), hospitalVerificationId: "verification-2",
    };
    appeal.commitmentHash = appealCommitmentHash(appeal);
    const binding = {
      request: { claimVersion: 2, appealId: appeal.id, appealCommitmentHash: appeal.commitmentHash },
      claim: { currentAppealId: appeal.id, hospitalId: appeal.proposedHospitalId, amountMinor: appeal.proposedAmountMinor, incidentDate: appeal.proposedIncidentDate, descriptionHash: appeal.proposedDescriptionHash },
      hospitalVerification: { id: appeal.hospitalVerificationId, claimVersion: 2, appealId: appeal.id, clinicalReferenceHash: appeal.proposedClinicalReferenceHash },
      appeal,
    };
    assert.equal(validateAppealBinding(binding), true);
    assert.equal(validateAppealBinding({ ...binding, claim: { ...binding.claim, amountMinor: 50_001 } }), false);
    assert.equal(validateAppealBinding({ ...binding, request: { ...binding.request, claimVersion: 1 } }), false);
    return { observed: "altered amount and stale version rejected" };
  },
};
