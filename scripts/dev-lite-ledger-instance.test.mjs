import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { selectLedgerInstance } from "./ledger-instance-state.mjs";

test("uses block 1 and isolates a rebuilt channel while retaining the first ledger's directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-ledger-instance-"));
  try {
    const channel = "same-channel";
    const oldBytes = Buffer.from("first ledger block 1");
    const newBytes = Buffer.from("second ledger block 1");
    const hash = bytes => createHash("sha256").update(bytes).digest("hex");
    const legacyFile = path.join(root, "customer-state-fixture");
    await fs.writeFile(legacyFile, "original state");
    const initial = await selectLedgerInstance(root, channel, oldBytes);
    assert.equal(initial.provisioningId, hash(oldBytes));
    assert.equal(initial.appStateRoot, root);
    const rebuilt = await selectLedgerInstance(root, channel, newBytes);
    assert.equal(rebuilt.provisioningId, hash(newBytes));
    assert.notEqual(rebuilt.appStateRoot, root);
    assert.deepEqual(await selectLedgerInstance(root, channel, newBytes), rebuilt);
    const marker = "a".repeat(64);
    assert.deepEqual(await selectLedgerInstance(root, channel, newBytes, marker), {
      ...rebuilt, provisioningId: marker,
    });
    assert.deepEqual(await selectLedgerInstance(root, channel, oldBytes), initial);
    assert.equal(await fs.readFile(legacyFile, "utf8"), "original state");
    const record = JSON.parse(await fs.readFile(path.join(root, `ledger-${channel}.json`), "utf8"));
    assert.deepEqual(record, initial);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("does not select a cached instance without block-1 bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-ledger-instance-"));
  try {
    await selectLedgerInstance(root, "same-channel", Buffer.from("first block"));
    await assert.rejects(selectLedgerInstance(root, "same-channel", Buffer.alloc(0)), /Block 1/);
    await assert.rejects(selectLedgerInstance(root, "same-channel", undefined), /Block 1/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
