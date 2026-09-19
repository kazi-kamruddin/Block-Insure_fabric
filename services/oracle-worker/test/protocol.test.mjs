import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOracleConfig } from "../src/config.mjs";
import { emptyCursor, loadCursor, persistCursor } from "../src/cursor.mjs";
import { buildCommitmentDigest, buildDeterministicSalt, buildResultDigest, oracleRequestPhase } from "../src/protocol.mjs";
import { createHealthState, loadPersistedHealth, persistHealth } from "../src/health.mjs";
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
  assert.equal(resultHash, "82f423a623598cfdcbff6239a447f9ac774eec08175ba8c2f76ae7485e131eb7");
  assert.equal(
    buildCommitmentDigest(request, { verified: true, resultHash, salt: "6".repeat(64) }),
    "d72e0d6dc8003404d09d75d6db5d5e7eba6f48437c536784b97c6f1afcc0a942",
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

test("independent baseline snapshots have distinct sources but identical canonical roots", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const [oracle1, oracle2, conflict] = await Promise.all([
    loadRegistrySnapshot(path.join(root, "registry", "oracle1-v1.json")),
    loadRegistrySnapshot(path.join(root, "registry", "oracle2-v1.json")),
    loadRegistrySnapshot(path.join(root, "registry", "oracle2-conflict-v1.json")),
  ]);
  assert.notEqual(oracle1.sourceId, oracle2.sourceId);
  assert.equal(oracle1.rootHash, oracle2.rootHash);
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
    assert.deepEqual(await loadCursor(filePath, "identity-b", 7), emptyCursor(7));
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
  assert.equal(first.fabric.mspId, "OracleMSP");
  assert.notEqual(first.oracleId, second.oracleId);
  assert.notEqual(first.healthPort, second.healthPort);
  assert.notEqual(first.fabric.userMspPath, second.fabric.userMspPath);
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
