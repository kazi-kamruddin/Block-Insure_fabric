import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateThreeOracleStateSpace, evaluateThreshold } from "../../services/oracle-worker/src/threshold-model.mjs";
import { loadRegistrySnapshot, assessRegistryRecord } from "../../services/oracle-worker/src/registry.mjs";
import { buildResultDigest } from "../../services/oracle-worker/src/protocol.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv.find((item) => item.startsWith("--output="))?.slice(9) ?? path.join(here, "reports"));
const cases = [
  { id: "honest", responses: ["correct", "correct", "correct"], truth: "correct" },
  { id: "one-divergent", responses: ["correct", "incorrect", "correct"], truth: "correct" },
  { id: "first-divergent", responses: ["incorrect", "correct", "correct"], truth: "correct" },
  { id: "one-unavailable", responses: ["correct", null, "correct"], truth: "correct" },
  { id: "two-divergent", responses: ["incorrect", "incorrect", "correct"], truth: "correct" },
  { id: "two-unavailable", responses: ["correct", null, null], truth: "correct" },
  { id: "three-way-conflict", responses: ["correct", "incorrect", "other"], truth: "correct" },
  { id: "common-source-error", responses: ["incorrect", "incorrect", "incorrect"], truth: "correct" },
];
const configurations = [
  { id: "1-of-1", count: 1, required: 1 },
  { id: "2-of-2", count: 2, required: 2 },
  { id: "2-of-3", count: 3, required: 2 },
];
const results = cases.flatMap((scenario) => configurations.map((configuration) => {
  const responses = scenario.responses.slice(0, configuration.count);
  const outcome = evaluateThreshold({ responses, requiredConfirmations: configuration.required, expectedResponses: configuration.count, deadlineExpired: true });
  return {
    scenario: scenario.id,
    configuration: configuration.id,
    responses,
    groundTruth: scenario.truth,
    outcome,
    classification: outcome.status === "CONSENSUS" ? (outcome.resultHash === scenario.truth ? "CORRECT_AUTOMATIC" : "UNSAFE_AUTOMATIC") : "NO_AUTOMATIC_DECISION",
  };
}));
const expected = new Map([
  ["one-divergent|1-of-1", "CORRECT_AUTOMATIC"],
  ["one-divergent|2-of-2", "NO_AUTOMATIC_DECISION"],
  ["one-divergent|2-of-3", "CORRECT_AUTOMATIC"],
  ["first-divergent|1-of-1", "UNSAFE_AUTOMATIC"],
  ["first-divergent|2-of-2", "NO_AUTOMATIC_DECISION"],
  ["first-divergent|2-of-3", "CORRECT_AUTOMATIC"],
  ["one-unavailable|1-of-1", "CORRECT_AUTOMATIC"],
  ["one-unavailable|2-of-2", "NO_AUTOMATIC_DECISION"],
  ["one-unavailable|2-of-3", "CORRECT_AUTOMATIC"],
  ["two-divergent|2-of-3", "UNSAFE_AUTOMATIC"],
  ["two-unavailable|2-of-3", "NO_AUTOMATIC_DECISION"],
  ["common-source-error|2-of-3", "UNSAFE_AUTOMATIC"],
]);
for (const result of results) {
  const wanted = expected.get(`${result.scenario}|${result.configuration}`);
  if (wanted) assert.equal(result.classification, wanted, `${result.scenario} ${result.configuration}`);
}
const stateSpace = enumerateThreeOracleStateSpace();
assert.equal(stateSpace.length, 64);
for (const state of stateSpace) {
  if (state.outcome.status === "CONSENSUS") {
    assert.ok(state.responses.filter((response) => response === state.outcome.resultHash).length >= 2);
  }
}
const snapshot = await loadRegistrySnapshot(path.resolve(here, "../../services/oracle-worker/registry/oracle1-v1.json"));
const record = snapshot.records[0];
const request = {
  id: "common-source-request", claimId: "common-source-claim", queryHash: "1".repeat(64),
  claimVersion: 1, hospitalVerificationId: "common-source-verification", appealId: "", appealCommitmentHash: "",
  registrySnapshotId: snapshot.snapshotId, registryVersion: snapshot.version, registryRootHash: snapshot.rootHash,
  rulesVersion: snapshot.rulesVersion, rulesHash: snapshot.rulesHash, modelVersion: "model-v1", modelHash: "c".repeat(64),
};
const claim = {
  id: request.claimId, version: 1, hospitalId: record.hospitalId, amountMinor: record.minimumAmountMinor,
  incidentDate: record.validFrom, descriptionHash: record.descriptionHash,
};
const hospitalVerification = { id: request.hospitalVerificationId, claimVersion: 1, appealId: "", clinicalReferenceHash: record.lookupHash };
const commonAssessments = Array.from({ length: 3 }, () => assessRegistryRecord({
  snapshot, request, claim, hospitalVerification, appeal: null,
  configuredModelVersion: "model-v1", configuredModelHash: "c".repeat(64),
}));
assert.ok(commonAssessments.every((assessment) => assessment.verified && assessment.verificationCode === "VERIFIED"));
const commonDigests = commonAssessments.map((assessment) => buildResultDigest(request, assessment));
const commonOutcome = evaluateThreshold({ responses: commonDigests, requiredConfirmations: 2, expectedResponses: 3 });
assert.equal(commonOutcome.status, "CONSENSUS");
const commonSourceAssessment = {
  externallyDesignatedGroundTruthVerified: false,
  replicaSource: "same anchored fixture used by all three modeled workers",
  registryRootHash: snapshot.rootHash,
  workerAssessmentCodes: commonAssessments.map((assessment) => assessment.verificationCode),
  consensus: commonOutcome,
  classification: "UNSAFE_AUTOMATIC_UNDER_SYNTHETIC_SOURCE_ERROR",
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method: "Deterministic protocol model; ground truth is an external test label, not verified by the quorum",
  stateSpace: { total: stateSpace.length, counts: Object.fromEntries(["CONSENSUS", "CONFLICT", "TIMEOUT", "PENDING"].map((status) => [status, stateSpace.filter((item) => item.outcome.status === status).length])) },
  results,
  commonSourceAssessment,
  exhaustiveStates: stateSpace,
};
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "protocol-matrix.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, stateSpace: report.stateSpace, results: results.map(({ scenario, configuration, classification }) => ({ scenario, configuration, classification })) }, null, 2)}\n`);
