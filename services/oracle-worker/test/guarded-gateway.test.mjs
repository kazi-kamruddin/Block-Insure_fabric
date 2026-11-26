import assert from "node:assert/strict";
import test from "node:test";
import { submitGuardedOracleTransaction } from "../src/gateway.mjs";

test("R2 submission guards before both endorsement and submission", async () => {
  const reports = [];
  let submitted = false;
  const contract = { newProposal: () => ({ endorse: async () => ({
    submit: async () => { submitted = true; },
  }) }) };
  const memory = [720, 699];
  await assert.rejects(submitGuardedOracleTransaction(contract, "Commit", [], row => reports.push(row),
    () => memory.shift() * 1024 * 1024), { code: "ORACLE_MEMORY_FLOOR" });
  assert.equal(submitted, false);
  assert.deepEqual(reports.map(row => row.refusal), ["MEMORY_GUARD"]);
});

test("R2 submission reports committed validation status without arguments", async () => {
  const reports = [];
  const status = { transactionId: "tx", blockNumber: 235n, code: 11, successful: false };
  const contract = { newProposal: () => ({ endorse: async () => ({
    submit: async () => ({ getStatus: async () => status }),
  }) }) };
  await assert.rejects(submitGuardedOracleTransaction(contract, "Reveal", ["private"], row => reports.push(row),
    () => 700 * 1024 * 1024), { name: "CommitError", code: 11 });
  assert.deepEqual(reports.map(({ elapsedMs, ...row }) => row),
    [{ method: "Reveal", code: 11, transactionId: "tx", blockNumber: "235" }]);
});
