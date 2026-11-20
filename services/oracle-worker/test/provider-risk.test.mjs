import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { observeProviderShadow, scoreProviderRisk } from "../src/provider-risk.mjs";

export const syntheticLogistic = { features: ["visits", "cost"], scoreScale: 1000000,
  model: { kind: "logistic", weights: [0, 2, 1], means: [10, 100], scales: [2, 10], calibration: [0, 1] } };

test("provider shadow reads only a hash-matched advisory release and explicit local features", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "provider-shadow-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "artifact.json"), catalogPath = path.join(directory, "catalog.json");
  const bytes = JSON.stringify(syntheticLogistic);
  await fs.writeFile(artifactPath, bytes);
  await fs.writeFile(catalogPath, JSON.stringify({ "hospital-test": [11, 100] }));
  const release = { id: "release", intendedTask: "ADVISORY", status: "SHADOW", artifactHash: createHash("sha256").update(bytes).digest("hex") };
  const options = { artifactPath, catalogPath, hospitalId: "hospital-test" };
  const observation = await observeProviderShadow({ ...options, release });
  assert.equal(observation.scoreUnits, scoreProviderRisk(syntheticLogistic, [11, 100]).scoreUnits);
  assert.equal(await observeProviderShadow({ ...options, release: { ...release, status: "PROMOTED" } }), null);
  assert.equal(await observeProviderShadow({ ...options, hospitalId: "other", release }), null);
  await assert.rejects(observeProviderShadow({ ...options, release: { ...release, artifactHash: "a".repeat(64) } }), /does not match/);
});
