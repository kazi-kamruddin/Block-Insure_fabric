import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pinnedDecision, decisionIdentity } from "../src/decision-store.mjs";

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
