import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pinnedDecision, decisionIdentity, historicalDecisionAliases } from "../src/decision-store.mjs";

test("restart reuses authenticated decision without fetching changed or unavailable inputs", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-decision-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { directory, identity: { channel: "isolated", request: "r1" }, key: Buffer.from("test-only-key") };
  const decision = { assessment: { verified: true }, resultHash: "result", commitmentHash: "commit", salt: "test-salt" };
  await pinnedDecision({ ...options, create: async () => decision });
  assert.deepEqual(await pinnedDecision({ ...options, existingCommitment: { commitmentHash: "commit" },
    create: async () => { throw new Error("source unavailable"); } }), decision);
  await assert.rejects(pinnedDecision({ ...options, existingCommitment: { commitmentHash: "other" } }), /differs/);
  const filename = path.join(directory, (await fs.readdir(directory))[0]);
  const stored = JSON.parse(await fs.readFile(filename, "utf8"));
  stored.body.decision.assessment.verified = false;
  await fs.writeFile(filename, JSON.stringify(stored));
  await assert.rejects(pinnedDecision(options), /authentication failed/);
});

test("missing persisted committed decision fails closed; deployment and evaluator identities isolate state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-decision-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { directory, identity: { channel: "a" }, key: Buffer.from("test-only-key") };
  await assert.rejects(pinnedDecision({ ...options, existingCommitment: { commitmentHash: "x" } }), /missing/);
  const config = { fabric: { channelName: "a", chaincodeName: "cc" }, oracleId: "oracle1" };
  const request = { id: "r", modelHash: "model-a" };
  const identity = decisionIdentity(config, "certificate", request);
  assert.notDeepEqual(identity, decisionIdentity({ ...config, fabric: { ...config.fabric, channelName: "b" } }, "certificate", request));
  assert.notDeepEqual(identity, decisionIdentity(config, "certificate", { ...request, modelHash: "model-b" }));
  assert.deepEqual(identity, decisionIdentity(config, "certificate", { ...request, commitmentCount: 2, status: "PENDING" }));
});

test("legacy upgrade adopts only an exactly reproduced existing commitment", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-decision-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { directory, identity: { legacy: "r" }, key: Buffer.from("test-only-key"), allowLegacyAdoption: true,
    existingCommitment: { commitmentHash: "original" } };
  await assert.rejects(pinnedDecision({ ...options, create: async () => ({ commitmentHash: "changed" }) }), /cannot reproduce/);
  assert.deepEqual(await pinnedDecision({ ...options, create: async () => ({ commitmentHash: "original" }) }), { commitmentHash: "original" });
});

test("pre-registry and release-qualified decisions resume side by side", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-decision-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { directory, key: Buffer.from("test-only-key") };
  const config = { fabric: { channelName: "insurance-dev-lite-190", chaincodeName: "cc" }, oracleId: "oracle1" };
  const oldRequest = { id: "old-request", modelVersion: "fabric-xgb-synthetic-v1" };
  const oldIdentity = decisionIdentity(config, "synthetic", oldRequest);
  assert.ok(!Object.hasOwn(oldIdentity.request, "modelReleaseId"));
  const newIdentity = decisionIdentity(config, "synthetic", { ...oldRequest, id: "new-request", modelReleaseId: "frozen-medical-v1" });
  const legacyAliases = historicalDecisionAliases(config, "synthetic", oldRequest);
  for (const [identity, commitmentHash] of [[oldIdentity, "pre-upgrade"], [newIdentity, "new"], [legacyAliases[0], "alias"]]) {
    await pinnedDecision({ ...options, identity, create: async () => ({ commitmentHash }) });
  }
  const noSource = async () => { throw new Error("no source required"); };
  for (const [identity, commitmentHash] of [[oldIdentity, "pre-upgrade"], [newIdentity, "new"]]) {
    assert.deepEqual(await pinnedDecision({ ...options, identity, existingCommitment: { commitmentHash }, create: noSource }), { commitmentHash });
  }
  const files = await fs.readdir(directory);
  const oldFile = (await Promise.all(files.map(async (name) => {
    const data = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
    return data.body.decision.commitmentHash === "pre-upgrade" ? name : null;
  }))).find(Boolean);
  assert.ok(oldFile);
  await fs.unlink(path.join(directory, oldFile));
  assert.deepEqual(await pinnedDecision({ ...options, identity: oldIdentity, fallbackIdentities: legacyAliases,
    existingCommitment: { commitmentHash: "alias" }, create: noSource }), { commitmentHash: "alias" });
});
