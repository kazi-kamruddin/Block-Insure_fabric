import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { archiveRegistrySnapshot } from "../apps/web/lib/oracle/registry-archive.mjs";
import { registryRootHash } from "../services/oracle-worker/src/registry.mjs";
import { restoreRegistrySnapshot } from "./restore-registry-snapshot.mjs";

const sample = {
  snapshotId: "registry-hospital-v2", version: 2,
  rulesVersion: "hospital-invoice-rules-v2", rulesHash: "d".repeat(64),
  records: [{ invoiceId: "invoice-fixture", patientReferenceHash: "a".repeat(64), lookupHash: "b".repeat(64),
    hospitalId: "hospital-demo", treatmentCode: "HOSPITAL_INVOICE", minimumAmountMinor: 1,
    maximumAmountMinor: 1000, validFrom: "2026-11-24", validThrough: "2026-11-24",
    descriptionHash: "c".repeat(64), status: "VALID" }],
  modelContext: { records: [], incompleteInvoiceIds: [], snapshotTimestamp: "2026-11-24T05:00:00Z" },
};
sample.rootHash = registryRootHash(sample);

test("restores exact bytes and original timestamp from a write-once registry archive", async t => {
  const tempRoot = tmpdir();
  const temp = await mkdtemp(path.join(tempRoot, "fabric-registry-restore-"));
  t.after(async () => {
    if (path.dirname(temp) === tempRoot && path.basename(temp).startsWith("fabric-registry-restore-")) {
      await rm(temp, { recursive: true, force: true });
    }
  });
  const archive = path.join(temp, "archive");
  const registry = path.join(temp, "registry");
  const archiveFile = path.join(archive, sample.rootHash + ".json");
  const bytes = await archiveRegistrySnapshot(archive, sample);
  const archived = await readFile(archiveFile, "utf8");
  assert.equal(JSON.parse(archived).inputHashes.rulesHash, sample.rulesHash);
  assert.match(JSON.parse(archived).inputHashes.modelContextSha256, /^[0-9a-f]{64}$/);
  assert.equal(await archiveRegistrySnapshot(archive, sample), bytes);
  assert.equal(await readFile(archiveFile, "utf8"), archived);
  await assert.rejects(archiveRegistrySnapshot(archive, { ...sample, records: [] }), /different snapshot/);
  assert.equal(await readFile(archiveFile, "utf8"), archived);

  const working = await restoreRegistrySnapshot({ rootHash: sample.rootHash, archive, registry });
  await unlink(working);
  await restoreRegistrySnapshot({ rootHash: sample.rootHash, archive, registry });
  const restored = await readFile(working, "utf8");
  assert.equal(restored, bytes);
  assert.equal(registryRootHash(JSON.parse(restored)), sample.rootHash);
  await writeFile(working, "{}");
  await assert.rejects(restoreRegistrySnapshot({ rootHash: sample.rootHash, archive, registry }), /different snapshot/);
  assert.equal(await readFile(working, "utf8"), "{}");
});
