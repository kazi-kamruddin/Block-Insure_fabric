import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOracleConfig } from "../src/config.mjs";
import { emptyCursor, loadCursor, persistCursor } from "../src/cursor.mjs";
import { buildCommitmentDigest, buildDeterministicSalt, buildResultDigest, oracleRequestPhase } from "../src/protocol.mjs";
import { privacyLeafHash, privacyParentHash, verifyDisclosure, verifySelectiveDisclosurePresentation } from "../src/privacy.mjs";
import { createHealthState, loadPersistedHealth, persistHealth } from "../src/health.mjs";
import { buildHybridRegistryReplicas, hybridDescriptionHash, hybridRecordToRegistryRecord } from "../src/hybrid-adapter.mjs";
import { enumerateThreeOracleStateSpace, evaluateThreshold } from "../src/threshold-model.mjs";
import { appealCommitmentHash, assessRegistryRecord, loadRegistrySnapshot, validateAppealBinding, validateRegistrySnapshot } from "../src/registry.mjs";
import { withBoundedRetry } from "../src/retry.mjs";

const request = {
  id: "request-vector-1",
  claimId: "claim-vector-1",
  queryHash: "1".repeat(64),
  claimVersion: 2,
  hospitalVerificationId: "verification-vector-1",
  appealId: "appeal-vector-1",
  appealCommitmentHash: "7".repeat(64),
  registrySnapshotId: "registry-demo-v1",
  registryVersion: 1,
  registryRootHash: "2".repeat(64),
  rulesVersion: "rules-v1",
  rulesHash: "3".repeat(64),
  modelVersion: "model-v1",
  modelHash: "4".repeat(64),
};

test("canonical result and commitment digests bind every adjudication version", () => {
  const common = { verified: true, verificationCode: "VERIFIED", recordHash: "5".repeat(64) };
  const resultHash = buildResultDigest(request, common);
  assert.equal(resultHash, "26b3db31914509e7d5935b2726389ef5958b7987f530e96d9afeeeff41570bbe");
  assert.equal(
    buildCommitmentDigest(request, { verified: true, resultHash, salt: "6".repeat(64) }),
    "2228c3f37167b622a585bc56361063a2ab8850b57887e7d998ca2b7f0b3b3133",
  );
  assert.equal(resultHash, buildResultDigest({ ...request }, { ...common }));
  assert.notEqual(resultHash, buildResultDigest({ ...request, claimVersion: 3 }, common));
  assert.notEqual(resultHash, buildResultDigest(request, { ...common, recordHash: "6".repeat(64) }));
  const salt1 = buildDeterministicSalt(Buffer.from("private-key-one"), request.id, "oracle1");
  const salt2 = buildDeterministicSalt(Buffer.from("private-key-two"), request.id, "oracle2");
  assert.notEqual(
    buildCommitmentDigest(request, { verified: true, resultHash, salt: salt1 }),
    buildCommitmentDigest(request, { verified: true, resultHash, salt: salt2 }),
  );
});

test("selective-disclosure Merkle proofs reject altered values and missing private payloads", () => {
  const first = { credentialId: "credential-1", credentialVersion: 1, name: "amountMinor", value: "50000", salt: "a".repeat(64) };
  const second = { credentialId: "credential-1", credentialVersion: 1, name: "status", value: "FINALIZED", salt: "b".repeat(64) };
  const firstHash = privacyLeafHash(first);
  const secondHash = privacyLeafHash(second);
  const root = privacyParentHash(firstHash, secondHash);
  const disclosure = { ...first, leafIndex: 0, proof: [{ hash: secondHash, position: "RIGHT" }] };
  assert.equal(verifyDisclosure(disclosure, root), true);
  assert.equal(verifyDisclosure({ ...disclosure, value: "50001" }, root), false);
  assert.deepEqual(
    verifySelectiveDisclosurePresentation({ request: {}, claim: {}, publicPresentation: null, privatePresentation: null }),
    { valid: true, code: "LEGACY_NO_PRESENTATION" },
  );
  assert.deepEqual(
    verifySelectiveDisclosurePresentation({ request: { privacyPresentationId: "presentation-1" }, claim: {}, publicPresentation: null, privatePresentation: null }),
    { valid: false, code: "PRIVACY_PRESENTATION_MISSING" },
  );
});

test("a revoked credential invalidates an already registered presentation", () => {
  const expiresAt = "2026-09-07T00:00:00Z";
  const publicPresentation = {
    id: "presentation-1", claimId: "claim-1", claimVersion: 1,
    protocolVersion: "block-insure-selective-disclosure-v1", presentationHash: "a".repeat(64),
    invoiceCredentialId: "invoice-credential-1", invoiceRootHash: "b".repeat(64),
    policyCredentialId: "policy-credential-1", policyRootHash: "c".repeat(64), expiresAt,
  };
  const privatePresentation = { presentationId: publicPresentation.id, claimId: "claim-1", claimVersion: 1, expiresAt };
  const invoiceCredential = { id: publicPresentation.invoiceCredentialId, rootHash: publicPresentation.invoiceRootHash, status: "REVOKED", expiresAt };
  const policyCredential = { id: publicPresentation.policyCredentialId, rootHash: publicPresentation.policyRootHash, status: "ACTIVE", expiresAt };
  assert.deepEqual(verifySelectiveDisclosurePresentation({
    request: { privacyPresentationId: publicPresentation.id, privacyPresentationHash: publicPresentation.presentationHash, privacyProtocolVersion: publicPresentation.protocolVersion, claimId: "claim-1", claimVersion: 1 },
    claim: {}, publicPresentation, privatePresentation, invoiceCredential, policyCredential,
    now: Date.parse("2026-09-06T12:00:00Z"),
  }), { valid: false, code: "PRIVACY_CREDENTIAL_INACTIVE" });
});

test("three baseline snapshots have distinct replica sources but identical canonical roots", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const [oracle1, oracle2, oracle3, conflict] = await Promise.all([
    loadRegistrySnapshot(path.join(root, "registry", "oracle1-v1.json")),
    loadRegistrySnapshot(path.join(root, "registry", "oracle2-v1.json")),
    loadRegistrySnapshot(path.join(root, "registry", "oracle3-v1.json")),
    loadRegistrySnapshot(path.join(root, "registry", "oracle2-conflict-v1.json")),
  ]);
  assert.notEqual(oracle1.sourceId, oracle2.sourceId);
  assert.equal(oracle1.rootHash, oracle2.rootHash);
  assert.equal(oracle1.rootHash, oracle3.rootHash);
  assert.notEqual(oracle1.rootHash, conflict.rootHash);

  const oracleRequest = {
    claimVersion: 1,
    registrySnapshotId: oracle1.snapshotId,
    registryVersion: oracle1.version,
    registryRootHash: oracle1.rootHash,
    rulesVersion: oracle1.rulesVersion,
    rulesHash: oracle1.rulesHash,
  };
  const claim = { hospitalId: "hospital-demo", amountMinor: 50_000, incidentDate: "2026-06-01", descriptionHash: "a".repeat(64) };
  const hospitalVerification = { claimVersion: 1, appealId: "", clinicalReferenceHash: "1".repeat(64) };
  assert.deepEqual(
    assessRegistryRecord({ snapshot: oracle1, request: oracleRequest, claim, hospitalVerification }).verificationCode,
    "VERIFIED",
  );
  assert.equal(
    assessRegistryRecord({ snapshot: conflict, request: oracleRequest, claim, hospitalVerification }).verificationCode,
    "REGISTRY_ROOT_MISMATCH",
  );
});

test("Kaggle-derived JSONL creates three provenance-bound replicas and a controlled corrupt profile", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-hybrid-registry-"));
  const inputPath = path.join(directory, "hybrid.jsonl");
  const outputDirectory = path.join(directory, "output");
  const record = {
    recordId: "hybrid-CLM1", hospitalId: "PRV-TEST001", treatmentType: "DIAGNOSTIC", diagnosisCode: "D001",
    sourceProcedureCode: "P001", admissionDate: "2009-01-01T00:00:00.000Z", dischargeDate: "2009-01-02T00:00:00.000Z",
    invoiceHash: `0x${"1".repeat(64)}`, recordStatus: "VALID", invoiceStatus: "VALID", licenseStatus: "ACTIVE",
    sourceClaimAmountUsd: 100, expectedBillMin: "0.0050", expectedBillMax: "0.0150", amountNormalizationDivisor: 10_000,
  };
  try {
    await fs.writeFile(inputPath, `${JSON.stringify(record)}\n`);
    const manifest = await buildHybridRegistryReplicas({ inputPath, outputDirectory, snapshotId: "registry-hybrid-test" });
    assert.equal(manifest.recordCount, 1);
    assert.equal(manifest.rulesVersion, "block-insure-hybrid-oracle-v1");
    assert.match(manifest.rulesHash, /^[a-f0-9]{64}$/);
    assert.equal(new Set(Object.values(manifest.replicaRoots)).size, 1);
    assert.notEqual(manifest.baselineRootHash, manifest.corruptRootHash);
    const [first, second, third] = await Promise.all(["oracle1", "oracle2", "oracle3"].map((id) => loadRegistrySnapshot(path.join(outputDirectory, `${id}-hybrid-v1.json`))));
    assert.deepEqual([first.rootHash, second.rootHash, third.rootHash], [manifest.baselineRootHash, manifest.baselineRootHash, manifest.baselineRootHash]);
    assert.equal(first.provenance.inputSha256, manifest.inputSha256);
    assert.deepEqual(hybridRecordToRegistryRecord(record), {
      lookupHash: "1".repeat(64), hospitalId: "PRV-TEST001", treatmentCode: "DIAGNOSTIC",
      minimumAmountMinor: 5_000, maximumAmountMinor: 15_000, validFrom: "2009-01-01", validThrough: "2009-01-02",
      descriptionHash: hybridDescriptionHash(record), status: "VALID",
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("matching snapshots independently return the same negative record result", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const [oracle1, oracle2] = await Promise.all([
    loadRegistrySnapshot(path.join(root, "registry", "oracle1-v1.json")),
    loadRegistrySnapshot(path.join(root, "registry", "oracle2-v1.json")),
  ]);
  const oracleRequest = {
    claimVersion: 1,
    registrySnapshotId: oracle1.snapshotId,
    registryVersion: oracle1.version,
    registryRootHash: oracle1.rootHash,
    rulesVersion: oracle1.rulesVersion,
    rulesHash: oracle1.rulesHash,
  };
  const input = {
    request: oracleRequest,
    claim: { hospitalId: "hospital-demo", amountMinor: 50_000, incidentDate: "2026-06-01", descriptionHash: "b".repeat(64) },
    hospitalVerification: { claimVersion: 1, appealId: "", clinicalReferenceHash: "2".repeat(64) },
  };
  const first = assessRegistryRecord({ snapshot: oracle1, ...input });
  const second = assessRegistryRecord({ snapshot: oracle2, ...input });
  assert.equal(first.verified, false);
  assert.equal(first.verificationCode, "RECORD_INVALID");
  assert.deepEqual(first, second);
});

test("a request for a different model produces a deterministic negative result", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const snapshot = await loadRegistrySnapshot(path.join(root, "registry", "oracle1-v1.json"));
  const result = assessRegistryRecord({
    snapshot,
    request: { ...request, claimVersion: 1, appealId: "", appealCommitmentHash: "", registrySnapshotId: snapshot.snapshotId, registryVersion: snapshot.version, registryRootHash: snapshot.rootHash, rulesVersion: snapshot.rulesVersion, rulesHash: snapshot.rulesHash },
    claim: { hospitalId: "hospital-demo", amountMinor: 50_000, incidentDate: "2026-06-01", descriptionHash: "a".repeat(64) },
    hospitalVerification: { claimVersion: 1, appealId: "", clinicalReferenceHash: "1".repeat(64) },
    configuredModelVersion: "model-v2",
    configuredModelHash: "9".repeat(64),
  });
  assert.equal(result.verified, false);
  assert.equal(result.verificationCode, "MODEL_VERSION_MISMATCH");
});

test("corrected appeals require an exact commitment, claim, and hospital-version binding", () => {
  const appeal = {
    id: "appeal-1", claimId: "claim-1", claimVersion: 2,
    commitmentVersion: "block-insure-fabric-appeal-v1",
    reasonCategory: "DOCUMENT_ERROR", reasonHash: "a".repeat(64), descriptionHash: "b".repeat(64),
    evidenceHash: "c".repeat(64), originalClaimHash: "d".repeat(64), proposedHospitalId: "hospital-demo", proposedAmountMinor: 50000,
    proposedIncidentDate: "2026-06-01", proposedDescriptionHash: "e".repeat(64),
    proposedClinicalReferenceHash: "1".repeat(64), hospitalVerificationId: "verification-2",
  };
  appeal.commitmentHash = appealCommitmentHash(appeal);
  const binding = {
    request: { claimVersion: 2, appealId: appeal.id, appealCommitmentHash: appeal.commitmentHash },
    claim: { currentAppealId: appeal.id, hospitalId: "hospital-demo", amountMinor: 50000, incidentDate: "2026-06-01", descriptionHash: "e".repeat(64) },
    hospitalVerification: { id: "verification-2", claimVersion: 2, appealId: appeal.id, clinicalReferenceHash: "1".repeat(64) },
    appeal,
  };
  assert.equal(validateAppealBinding(binding), true);
  assert.equal(validateAppealBinding({ ...binding, claim: { ...binding.claim, amountMinor: 50001 } }), false);
  assert.equal(validateAppealBinding({ ...binding, request: { ...binding.request, appealCommitmentHash: "f".repeat(64) } }), false);
});

test("appeal commitment digest matches the Go chaincode protocol vector", () => {
  assert.equal(appealCommitmentHash({
    claimId: "claim-vector", claimVersion: 2, reasonCategory: "DOCUMENT_ERROR",
    reasonHash: "a".repeat(64), descriptionHash: "b".repeat(64), evidenceHash: "c".repeat(64),
    originalClaimHash: "d".repeat(64), proposedHospitalId: "hospital-2", proposedAmountMinor: 50000,
    proposedIncidentDate: "2026-06-15", proposedDescriptionHash: "e".repeat(64),
    proposedClinicalReferenceHash: "f".repeat(64),
  }), "6ce90e23704ce9c29a2a814804546af406c143cc497c632d2220fe025c1e97e8");
});

test("registry validation rejects impossible dates, reversed ranges, and unknown statuses", () => {
  const valid = {
    sourceId: "source-1", snapshotId: "snapshot-1", version: 1, rulesVersion: "rules-v1", rulesHash: "a".repeat(64),
    records: [{ lookupHash: "1".repeat(64), hospitalId: "hospital-1", treatmentCode: "treatment-1", minimumAmountMinor: 1, maximumAmountMinor: 2, validFrom: "2026-01-01", validThrough: "2026-12-31", descriptionHash: "b".repeat(64), status: "VALID" }],
  };
  assert.throws(() => validateRegistrySnapshot({ ...valid, records: [{ ...valid.records[0], validFrom: "2026-02-30" }] }), /valid calendar date/);
  assert.throws(() => validateRegistrySnapshot({ ...valid, records: [{ ...valid.records[0], validFrom: "2026-12-31", validThrough: "2026-01-01" }] }), /date range/);
  assert.throws(() => validateRegistrySnapshot({ ...valid, records: [{ ...valid.records[0], status: "UNKNOWN" }] }), /record status/);
});

test("cursor persistence is identity-bound and restart-idempotent", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-oracle-"));
  const filePath = path.join(directory, "cursor.json");
  try {
    assert.deepEqual(await loadCursor(filePath, "identity-a", 7), emptyCursor(7));
    await persistCursor(filePath, "identity-a", { nextBlock: 42, transactionId: "tx-1" });
    assert.deepEqual(await loadCursor(filePath, "identity-a", 7), { nextBlock: 42, transactionId: "tx-1" });
    assert.deepEqual(await loadCursor(filePath, "identity-a", 50), emptyCursor(50));
    assert.deepEqual(await loadCursor(filePath, "identity-b", 7), emptyCursor(7));
    await persistCursor(filePath, "identity-a", { nextBlock: -1, transactionId: "invalid" });
    assert.deepEqual(await loadCursor(filePath, "identity-a", 7), emptyCursor(7));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bounded retry stops at the configured limit with exponential bounded delay", async () => {
  const delays = [];
  let attempts = 0;
  await assert.rejects(
    withBoundedRetry(async () => {
      attempts += 1;
      throw new Error("transient");
    }, { attempts: 4, baseDelayMs: 10, maximumDelayMs: 15, delay: async (value) => delays.push(value) }),
    /transient/,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [10, 15, 15]);
});

test("oracle process configurations select independent identity and health profiles", () => {
  const common = {
    ORACLE_REGISTRY_PATH: "registry/oracle1-v1.json",
    ORACLE_MODEL_VERSION: "model-v1",
    ORACLE_MODEL_HASH: "c".repeat(64),
  };
  const first = loadOracleConfig({ ...common, ORACLE_ID: "oracle1" });
  const second = loadOracleConfig({ ...common, ORACLE_ID: "oracle2", ORACLE_HEALTH_PORT: "3302" });
  const third = loadOracleConfig({ ...common, ORACLE_ID: "oracle3" });
  assert.equal(first.fabric.mspId, "OracleMSP");
  assert.notEqual(first.oracleId, second.oracleId);
  assert.notEqual(first.healthPort, second.healthPort);
  assert.notEqual(first.fabric.userMspPath, second.fabric.userMspPath);
  assert.equal(third.healthPort, 3303);
  assert.notEqual(second.fabric.userMspPath, third.fabric.userMspPath);
  assert.throws(() => loadOracleConfig({ ...common, ORACLE_ID: "oracle1", ORACLE_MODEL_HASH: "not-a-hash" }), /64-character hexadecimal hash/);
});

test("worker commit/reveal sequencing waits for quorum or the commit deadline", () => {
  const phases = { status: "PENDING", commitmentCount: 1, expectedResponses: 2, commitDeadline: "2026-09-06T12:01:00Z", revealDeadline: "2026-09-06T12:02:00Z" };
  assert.equal(oracleRequestPhase(phases, Date.parse("2026-09-06T12:00:00Z")), "COMMIT");
  assert.equal(oracleRequestPhase({ ...phases, commitmentCount: 2 }, Date.parse("2026-09-06T12:00:00Z")), "REVEAL");
  assert.equal(oracleRequestPhase(phases, Date.parse("2026-09-06T12:01:01Z")), "REVEAL");
  assert.equal(oracleRequestPhase(phases, Date.parse("2026-09-06T12:02:01Z")), "TIMED_OUT");
  assert.equal(oracleRequestPhase({ ...phases, status: "CONSENSUS" }, Date.parse("2026-09-06T12:00:00Z")), "FINALIZED");
});

test("exhaustive 2-of-3 state enumeration preserves safety and tolerates one fault", () => {
  const states = enumerateThreeOracleStateSpace();
  assert.equal(states.length, 64);
  for (const state of states) {
    if (state.outcome.status === "CONSENSUS") {
      assert.ok(state.outcome.matchingResponses >= 2);
      assert.ok(["A", "B", "C"].includes(state.outcome.resultHash));
    }
  }
  assert.equal(evaluateThreshold({ responses: ["A", "A", null], requiredConfirmations: 2, expectedResponses: 3, deadlineExpired: true }).status, "CONSENSUS");
  assert.equal(evaluateThreshold({ responses: ["A", "A", "B"], requiredConfirmations: 2, expectedResponses: 3 }).status, "CONSENSUS");
  assert.equal(evaluateThreshold({ responses: ["A", "B", "C"], requiredConfirmations: 2, expectedResponses: 3 }).status, "CONFLICT");
  assert.equal(evaluateThreshold({ responses: ["A", null, null], requiredConfirmations: 2, expectedResponses: 3, deadlineExpired: true }).status, "TIMEOUT");
  assert.throws(() => evaluateThreshold({ responses: ["A", "A", "B"], requiredConfirmations: 1, expectedResponses: 3 }), /strict majority/);
});

test("health reporting persists identity, provenance, progress, and non-secret counters", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-oracle-health-"));
  const filePath = path.join(directory, "health.json");
  try {
    const state = createHealthState(
      { oracleId: "oracle1", label: "Oracle 1", modelVersion: "model-v1" },
      { sourceId: "independent-source", snapshotId: "registry-demo-v1", version: 1, rootHash: "a".repeat(64) },
    );
    const health = state.update({ status: "ONLINE", lastProcessedBlock: "42", lastProcessedRequestId: "request-1", counts: { requests: 1, commitments: 1, reveals: 1 } });
    await persistHealth(filePath, health);
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.deepEqual(stored.counts, { requests: 1, commitments: 1, reveals: 1, verified: 0, failed: 0 });
    assert.equal(stored.registrySource, "independent-source");
    assert.equal(stored.lastProcessedBlock, "42");
    assert.equal("privateKey" in stored, false);
    const restored = createHealthState(
      { oracleId: "oracle1", label: "Oracle 1", modelVersion: "model-v1" },
      { sourceId: "independent-source", snapshotId: "registry-demo-v1", version: 1, rootHash: "a".repeat(64) },
      await loadPersistedHealth(filePath, "oracle1"),
    ).snapshot();
    assert.deepEqual(restored.counts, stored.counts);
    assert.equal(restored.lastProcessedBlock, "42");
    assert.equal(await loadPersistedHealth(filePath, "oracle2"), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("health checkpoints tolerate concurrent Windows-style replacements", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-health-race-"));
  const filePath = path.join(directory, "health.json");
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => persistHealth(filePath, {
      schemaVersion: 1,
      oracleId: "oracle1",
      status: "ONLINE",
      sequence: index,
    })));
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(stored.oracleId, "oracle1");
    assert.equal(stored.status, "ONLINE");
    assert.ok(Number.isInteger(stored.sequence));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
