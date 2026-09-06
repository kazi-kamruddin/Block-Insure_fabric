import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOracleConfig } from "../src/config.mjs";
import { emptyCursor, loadCursor, persistCursor } from "../src/cursor.mjs";
import { buildCommitmentDigest, buildDeterministicSalt, buildResultDigest, oracleRequestPhase } from "../src/protocol.mjs";
import { createHealthState, persistHealth } from "../src/health.mjs";
import { assessRegistryRecord, loadRegistrySnapshot } from "../src/registry.mjs";
import { withBoundedRetry } from "../src/retry.mjs";

const request = {
  id: "request-vector-1",
  claimId: "claim-vector-1",
  queryHash: "1".repeat(64),
  claimVersion: 2,
  hospitalVerificationId: "verification-vector-1",
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
  assert.equal(resultHash, "310ba46f898f75725e6c041800559faf9d69f72c40749874e15c1f7b7afd89e2");
  assert.equal(
    buildCommitmentDigest(request, { verified: true, resultHash, salt: "6".repeat(64) }),
    "dc82bc23fc7d06bce5a00726f88b387baf6a82acfa5d70c7e2bfe49524708d89",
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
    registrySnapshotId: oracle1.snapshotId,
    registryVersion: oracle1.version,
    registryRootHash: oracle1.rootHash,
    rulesVersion: oracle1.rulesVersion,
    rulesHash: oracle1.rulesHash,
  };
  const claim = { amountMinor: 50_000, incidentDate: "2026-06-01", descriptionHash: "a".repeat(64) };
  const hospitalVerification = { clinicalReferenceHash: "1".repeat(64) };
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
    registrySnapshotId: oracle1.snapshotId,
    registryVersion: oracle1.version,
    registryRootHash: oracle1.rootHash,
    rulesVersion: oracle1.rulesVersion,
    rulesHash: oracle1.rulesHash,
  };
  const input = {
    request: oracleRequest,
    claim: { amountMinor: 50_000, incidentDate: "2026-06-01", descriptionHash: "b".repeat(64) },
    hospitalVerification: { clinicalReferenceHash: "2".repeat(64) },
  };
  const first = assessRegistryRecord({ snapshot: oracle1, ...input });
  const second = assessRegistryRecord({ snapshot: oracle2, ...input });
  assert.equal(first.verified, false);
  assert.equal(first.verificationCode, "RECORD_INVALID");
  assert.deepEqual(first, second);
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
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
