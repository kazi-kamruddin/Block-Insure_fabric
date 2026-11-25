import assert from "node:assert/strict";
import { test } from "node:test";
import { scanDuplicateCommitments } from "./scan-duplicate-commitments.mjs";

test("reports duplicate hashes only across distinct subjects of the same request", () => {
  const hash = "a".repeat(64);
  const row = (requestId, oracleId, commitmentHash = hash) => ({ requestId, oracleId, commitmentHash });
  const rows = [
    row("request-one", "oracle1"), row("request-one", "oracle1"),
    row("request-one", "oracle2", hash.toUpperCase()), row("request-one", "oracle3", "b".repeat(64)),
    row("request-two", "oracle1"), row("request-three", "oracle2"),
  ];
  assert.deepEqual(scanDuplicateCommitments(rows), [{ requestId: "request-one", commitmentHash: hash, oracleIds: ["oracle1", "oracle2"] }]);
  assert.throws(() => scanDuplicateCommitments([row("request-one", "", hash)]), /Invalid commitment/);
});
