import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluatorHash } from "../src/xgboost.mjs";
import { checkOracleNodeVersion } from "../src/config.mjs";

test("the pre-Phase-1 evaluator hash stays pinned", async () => {
  const identity = JSON.parse(await readFile(new URL("./fixtures/evaluator-identity.json", import.meta.url), "utf8"));
  assert.equal(evaluatorHash, identity.evaluatorHash, identity.source);
});

test("worker startup accepts the pinned Node major or an explicit override", () => {
  assert.doesNotThrow(() => checkOracleNodeVersion({}, "v24.99.0"));
  assert.throws(() => checkOracleNodeVersion({}, "v25.0.0"), /Node v25\.0\.0/);
  assert.doesNotThrow(() => checkOracleNodeVersion({ ORACLE_ALLOW_NODE_MISMATCH: "1" }, "v25.0.0"));
});
