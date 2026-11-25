import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonical, hash } from "../src/xgboost.mjs";
import { decisionIdentity, pinnedDecision, readAuthenticatedDecision, writeExplanationReceipt } from "../src/decision-store.mjs";

test("receipt canonical vectors match the frozen evaluator", async () => {
  const vectors = JSON.parse(await fs.readFile(new URL("./fixtures/canonical-vectors.json", import.meta.url), "utf8"));
  for (const vector of vectors) {
    assert.equal(canonical(vector.value), vector.canonical);
    assert.equal(hash(vector.value), vector.sha256);
  }
});

test("authenticates legacy decisions and exports only the explanation preimage", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-receipt-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "decisions");
  const key = Buffer.from("test-key");
  const request = { id: "request-201", modelHash: "a".repeat(64) };
  const identity = decisionIdentity({ oracleId: "oracle1", fabric: {} }, "fixture", request);
  const body = { contextHash: "b".repeat(64), evaluatorHash: request.modelHash, assessment: { riskScoreUnits: 20 } };
  const verificationCode = "XGB_AUTO:" + hash(body).toUpperCase();
  const decision = { salt: "private-test-salt", commitmentHash: "test", resultHash: "result-1",
    assessment: { verificationCode, result: { contextHash: body.contextHash, assessment: body.assessment } } };
  await pinnedDecision({ directory, identity, key, create: () => decision });
  const [name] = await fs.readdir(directory);
  const filename = path.join(directory, name);
  const authenticated = await readAuthenticatedDecision(filename, key);
  const receipt = await writeExplanationReceipt(root, request, "oracle1", authenticated, verificationCode);
  assert.deepEqual(receipt, { schema: "explanation-receipt-v1", requestId: request.id, oracleId: "oracle1", ...body });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "receipts", request.id, "oracle1.json"), "utf8")), receipt);
  await assert.rejects(readAuthenticatedDecision(filename, Buffer.from("another-test-key")), /authentication failed/);
  assert.equal(await writeExplanationReceipt(root, request, "oracle2", authenticated, "XGB_AUTO:" + "c".repeat(64)), null);
});
