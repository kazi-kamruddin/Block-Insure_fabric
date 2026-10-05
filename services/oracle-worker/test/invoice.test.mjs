import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assessRegistryRecord, validateRegistrySnapshot } from "../src/registry.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const record = { invoiceId: "invoice-test", patientReferenceHash: hash("policyholder1"), lookupHash: hash("invoice-reference"), hospitalId: "hospital-demo", treatmentCode: "HOSPITAL_INVOICE", minimumAmountMinor: 1, maximumAmountMinor: 100000, validFrom: "2026-06-01", validThrough: "2026-06-20", descriptionHash: hash("hospital clinical wording"), status: "VALID" };
const raw = { sourceId: "fabric-hospital-invoice-register", snapshotId: "registry-hospital-v1", version: 1, rulesVersion: "hospital-invoice-rules-v2", rulesHash: hash("rules"), records: [record] };
const snapshot = validateRegistrySnapshot(raw);
const request = { claimVersion: 1, registrySnapshotId: snapshot.snapshotId, registryVersion: snapshot.version, registryRootHash: snapshot.rootHash, rulesVersion: snapshot.rulesVersion, rulesHash: snapshot.rulesHash };
const claim = { claimantId: "policyholder1", hospitalInvoiceId: "invoice-test", hospitalId: "hospital-demo", amountMinor: 25000, incidentDate: "2026-06-10", descriptionHash: hash("my own explanation") };
const binding = { outcome: "SOURCE_BOUND", clinicalReferenceHash: record.lookupHash };
function assess(changes = {}, source = snapshot) { return assessRegistryRecord({ snapshot: source, request: { ...request, registryRootHash: source.rootHash }, claim: { ...claim, ...changes }, hospitalVerification: binding }); }

test("invoice Oracle accepts a partial amount and a claimant's own narrative", () => {
  assert.equal(assess().verificationCode, "VERIFIED");
  assert.equal(assess({ amountMinor: 100001 }).verificationCode, "AMOUNT_OUT_OF_RANGE");
  assert.equal(assess({ amountMinor: 0 }).verificationCode, "AMOUNT_OUT_OF_RANGE");
  assert.equal(assess({ incidentDate: "2026-07-01" }).verificationCode, "INCIDENT_DATE_MISMATCH");
});

test("invoice Oracle binds both patient and invoice identity", () => {
  assert.equal(assess({ claimantId: "policyholder2" }).verificationCode, "PATIENT_MISMATCH");
  assert.equal(assess({ hospitalInvoiceId: "invoice-other" }).verificationCode, "RECORD_NOT_FOUND");
  const other = validateRegistrySnapshot({ ...raw, records: [{ ...record, patientReferenceHash: hash("other") }] });
  assert.notEqual(other.rootHash, snapshot.rootHash);
  assert.throws(() => validateRegistrySnapshot({ ...raw, records: [{ ...record, patientReferenceHash: undefined }] }), /patientReferenceHash/);
});

test("voided invoice gives a negative result and source binding cannot use legacy rules", () => {
  const voided = validateRegistrySnapshot({ ...raw, records: [{ ...record, status: "INVALID" }] });
  assert.equal(assess({}, voided).verificationCode, "RECORD_INVALID");
  const legacy = validateRegistrySnapshot({ ...raw, rulesVersion: "rules-v1" });
  assert.equal(assessRegistryRecord({ snapshot: legacy, request: { ...request, registryRootHash: legacy.rootHash, rulesVersion: legacy.rulesVersion }, claim, hospitalVerification: binding }).verificationCode, "RULES_VERSION_MISMATCH");
});
