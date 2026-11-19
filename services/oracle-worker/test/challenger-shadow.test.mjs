import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { challengerFeatures, protocol } from "../../../benchmarks/ml-challengers/cohort.mjs";
import { scoreChallenger } from "../../../benchmarks/ml-challengers/models.mjs";
import { loadChallengerShadow, shadowChallengerScores } from "../src/challenger-shadow.mjs";
import { evaluatorHash, evaluatorVersion, hash, prepareObservation } from "../src/xgboost.mjs";
import { context, source } from "./fixtures/xgboost-inputs.mjs";

test("pinned shadow artifacts produce the research integer scores and skip mandatory cases", async () => {
  const root = await mkdtemp(join(tmpdir(), "fabric-shadow-"));
  const channel = "insurance-medical-reimbursement";
  const artifact = {
    protocol: protocol.version, incumbent: { evaluatorHash, evaluatorVersion }, peers: { cutoff: "2026-05-01", cuts: {}, pooled: source.amountMinor },
    models: ["additive-stumps", "monotonic-ranker"].map(id => ({ id, features: ["peerExcess"], base: 0,
      trees: [{ leaf: 0.1 }], calibration: { slope: 1, intercept: 0 } })),
  };
  try {
    const file = join(root, "model.json");
    await writeFile(file, JSON.stringify(artifact));
    await assert.rejects(loadChallengerShadow(channel, file, "0".repeat(64)), /identity mismatch/);
    await assert.rejects(loadChallengerShadow("insurance-channel", file, hash(artifact)), /isolated medical channel/);
    const shadow = await loadChallengerShadow(channel, file, hash(artifact));
    const prepared = prepareObservation(context);
    const packet = { source, records: context.records, prepared };
    const features = challengerFeatures(source, context.records, prepared, artifact.peers);
    const expected = Object.fromEntries(artifact.models.map(model => [model.id, scoreChallenger(model, features).scoreUnits]));
    assert.deepEqual(shadowChallengerScores(shadow, packet), { artifactHash: hash(artifact), inputHash: hash(features), scores: expected });
    assert.equal(shadowChallengerScores(shadow, { ...packet, prepared: { ...prepared, observation: { ...prepared.observation, mandatory: true } } }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
