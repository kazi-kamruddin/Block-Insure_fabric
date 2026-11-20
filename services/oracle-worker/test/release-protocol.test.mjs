import test from "node:test";
import assert from "node:assert/strict";
import { evaluatorHash } from "../src/xgboost.mjs";
import { buildResultDigest } from "../src/protocol.mjs";
import { buildReleaseResultDigest } from "../src/release-protocol.mjs";

test("release result encoding keeps the frozen evaluator and legacy digest stable", () => {
  assert.equal(evaluatorHash, "4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4");
  const request = { id: "request", claimId: "claim", queryHash: "a".repeat(64), claimVersion: 1, hospitalVerificationId: "verification",
    registrySnapshotId: "snapshot", registryVersion: 1, registryRootHash: "b".repeat(64), rulesVersion: "rules", rulesHash: "c".repeat(64),
    modelVersion: "fabric-xgb-synthetic-v1", modelHash: evaluatorHash };
  const assessment = { verified: false, verificationCode: "XGB_EVALUATOR_UNAVAILABLE", recordHash: "0".repeat(64) };
  const legacy = buildResultDigest(request, assessment);
  assert.equal(buildReleaseResultDigest(request, assessment), legacy);
  const pinned = buildReleaseResultDigest({ ...request, modelReleaseId: "frozen-medical-v1" }, assessment);
  assert.notEqual(pinned, legacy);
  assert.notEqual(pinned, buildReleaseResultDigest({ ...request, modelReleaseId: "other-release" }, assessment));
});
