import { expect, it } from "vitest";
import { buildRegistryManifest, verifyRegistryManifest, type HospitalRegistrySnapshotFile } from "./registry-manifest";

const record = {
  invoiceId: "invoice-fixture", patientReferenceHash: "a".repeat(64), lookupHash: "b".repeat(64),
  hospitalId: "hospital-demo", treatmentCode: "HOSPITAL_INVOICE", minimumAmountMinor: 1, maximumAmountMinor: 1000,
  validFrom: "2026-11-24", validThrough: "2026-11-24", descriptionHash: "c".repeat(64), status: "VALID" as const,
};
// Expected hashes computed using the unchanged worker's registryRootHash.
const root = "c043670d51320bc6b8adb0b6a776951b78ff1d69186e840b523bc07d2fd9aa72";
const snapshot: HospitalRegistrySnapshotFile = {
  sourceId: "fabric-hospital-invoice-register", snapshotId: "registry-hospital-v2",
  version: 2, rulesVersion: "hospital-invoice-rules-v2", rulesHash: "d".repeat(64), rootHash: root, records: [record],
};

it("matches the unchanged worker on both legacy and private-model-context roots", async () => {
  const legacy = buildRegistryManifest("hospital-demo", snapshot, null);
  expect(await verifyRegistryManifest(legacy, root)).toEqual({ root, canAttest: true });
  const modelContext = { records: [{ invoiceId: record.invoiceId, hospitalId: record.hospitalId, treatmentType: "DIAGNOSTIC" }],
    incompleteInvoiceIds: [], snapshotTimestamp: "2026-11-24T05:00:00Z" };
  const medicalRoot = "6d069d8d33ad02797501d4df3ad4a5f5b5e13a61d16aa0afb0fb784d25d19705";
  const medical = buildRegistryManifest("hospital-demo", { ...snapshot, modelContext }, null);
  expect(await verifyRegistryManifest(medical, medicalRoot)).toEqual({ root: medicalRoot, canAttest: true });
});

it("lists an altered record and disables attestation even if the file repeats the proposed hash", async () => {
  const altered = { ...snapshot, records: [{ ...record, maximumAmountMinor: 1_005 }] };
  const manifest = buildRegistryManifest("hospital-demo", altered, { ...snapshot, snapshotId: "registry-hospital-v1", version: 1 });
  expect(manifest.diff.changed).toEqual([{ before: "invoice-fixture", after: "invoice-fixture" }]);
  expect((await verifyRegistryManifest(manifest, root)).canAttest).toBe(false);
});

it("tracks corrected revisions by episode and rejects mixed-hospital records", () => {
  const corrected = { ...record, invoiceId: "invoice-new", lookupHash: "e".repeat(64) };
  const manifest = buildRegistryManifest("hospital-demo", { ...snapshot, records: [corrected] }, snapshot,
    new Map([["invoice-fixture", "episode-one"], ["invoice-new", "episode-one"]]));
  expect(manifest.diff.changed).toEqual([{ before: "invoice-fixture", after: "invoice-new" }]);
  expect(() => buildRegistryManifest("hospital-2", snapshot, null)).toThrow("outside the hospital scope");
});
