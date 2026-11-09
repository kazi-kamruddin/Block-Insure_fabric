import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { adapterContract, evaluatorHash, evaluatorVersion, normalizeRecord, prepareObservation, inferContext, routeModel } from "../src/xgboost.mjs";
import { validateRegistrySnapshot } from "../src/registry.mjs";
const require = createRequire(import.meta.url);
const unit = adapterContract.amountMinorPerModelUnit;
const source = {
  invoiceId: "inv-current", invoiceHash: "a".repeat(64), hospitalMsp: "HospitalMSP", hospitalId: "hospital1",
  patientIssuerMsp: "InsurerMSP", patientReferenceHash: createHash("sha256").update("holder1").digest("hex"),
  treatmentType: "SURGERY", diagnosisCode: "D1", treatmentHash: "b".repeat(64),
  admissionDate: "2026-06-10", dischargeDate: "2026-06-11", invoiceDate: "2026-06-12",
  amountMinor: unit, expectedMinMinor: unit / 2, expectedMaxMinor: unit * 2,
  invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE",
};
const claim = { hospitalInvoiceId: source.invoiceId, hospitalId: "hospital1", hospitalMsp: "HospitalMSP", claimantId: "holder1", claimantMsp: "InsurerMSP",
  amountMinor: unit / 2, invoiceHash: source.invoiceHash, treatmentType: "SURGERY", incidentDate: "2026-06-10", createdAt: "2026-06-15T00:00:00Z" };
const prior = { ...source, invoiceId: "inv-prior", invoiceHash: "c".repeat(64), admissionDate: "2026-06-01", dischargeDate: "2026-06-02", invoiceDate: "2026-06-03" };
const context = { records: [source, prior], claim, snapshotTimestamp: "2026-06-15T00:00:00Z" };

test("frozen feature and inference parity with current sibling on paired synthetic cases", () => {
  const { prepareAdvisoryObservation } = require("../../../../Block-Insure/backEnd/services/advisoryContextService.js");
  const referenceEngine = require("../../../../Block-Insure/oracle/xgboostAssessment.js").compile(require("../../../../Block-Insure/backEnd/artifacts/xgboost-advisory-v1.json"));
  for (const changes of [{}, { amountMinor: unit * 10 }, { licenseStatus: "SUSPENDED" }, { recordStatus: "INVALID" }, { expectedMaxMinor: unit / 4, expectedMinMinor: unit / 8 }]) {
    const records = [{ ...source, ...changes }, prior];
    const actual = inferContext({ ...context, records });
    const normalized = records.map(normalizeRecord);
    const reference = prepareAdvisoryObservation({ records: normalized, claim: {
      invoiceHash: source.invoiceHash, hospitalId: normalized[0].hospitalId,
      claimantWallet: normalized[0].authorizedClaimants[0], claimAmountEth: claim.amountMinor / unit,
      incidentDate: Date.parse(claim.incidentDate) / 1000, claimType: claim.treatmentType, submittedAt: Date.parse(claim.createdAt) / 1000,
    }, snapshotTimestamp: Date.parse(context.snapshotTimestamp) / 1000 });
    assert.deepEqual(actual.prepared.observation, reference.observation);
    assert.deepEqual(actual.assessment, referenceEngine.score(reference.observation));
    assert.ok(actual.assessment.explanation.additivityError < 1e-5);
  }
});

test("strict prior cutoff, missing context, canonical identities and amount validation", () => {
  const without = prepareObservation({ ...context, records: [source] });
  const sameDay = { ...prior, invoiceDate: source.invoiceDate };
  assert.deepEqual(prepareObservation({ ...context, records: [source, sameDay] }).observation, without.observation);
  assert.equal(prepareObservation(context).observation.providerLags.length, 1);
  assert.throws(() => prepareObservation({ ...context, records: [] }), /unavailable/);
  assert.throws(() => prepareObservation({ ...context, records: [source, source] }), /Duplicate/);
  assert.throws(() => normalizeRecord({ ...source, amountMinor: Number.MAX_SAFE_INTEGER + 1 }), /minor/);
  assert.throws(() => normalizeRecord({ ...source, invoiceDate: undefined }), /date/);
  const mismatch = inferContext({ ...context, claim: { ...claim, claimantMsp: "OtherMSP" } });
  assert.equal(mismatch.prepared.observation.mandatory, true);
  assert.equal(mismatch.assessment.recommendation, "REVIEW_RECOMMENDED");
});

test("request-pinned routing binds model context into snapshot root and exact result", () => {
  const raw = { sourceId: "hospital-source", snapshotId: "registry-xgb-v1", version: 1, rulesVersion: "hospital-invoice-rules-v2", rulesHash: "d".repeat(64),
    modelContext: { records: context.records, snapshotTimestamp: context.snapshotTimestamp }, records: [{
      invoiceId: source.invoiceId, patientReferenceHash: source.patientReferenceHash, lookupHash: source.invoiceHash, hospitalId: source.hospitalId,
      treatmentCode: "HOSPITAL_INVOICE", minimumAmountMinor: 1, maximumAmountMinor: source.amountMinor,
      validFrom: source.admissionDate, validThrough: source.dischargeDate, descriptionHash: source.treatmentHash, status: "VALID",
    }] };
  const snapshot = validateRegistrySnapshot(raw);
  const request = { modelVersion: evaluatorVersion, modelHash: evaluatorHash, requestedAt: context.snapshotTimestamp };
  const assessment = { verified: true, verificationCode: "VERIFIED", recordHash: "f".repeat(64) };
  const routed = routeModel({ snapshot, request, claim, assessment });
  assert.match(routed.verificationCode, /^XGB_(AUTO|REVIEW):[A-F0-9]{64}$/);
  assert.equal(routed.authority, "ORACLE_ROUTING");
  const changed = validateRegistrySnapshot({ ...raw, modelContext: { ...raw.modelContext, records: [{ ...source, amountMinor: unit * 2 }, prior] } });
  assert.notEqual(snapshot.rootHash, changed.rootHash);
  assert.equal(routeModel({ snapshot: changed, request, claim, assessment }).verificationCode, "XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE");
  assert.equal(routeModel({ snapshot: { ...snapshot, modelContext: undefined }, request, claim, assessment }).verified, false);
  assert.equal(routeModel({ snapshot, request: { ...request, modelHash: "0".repeat(64) }, claim, assessment }).verified, false);
  assert.deepEqual(routeModel({ snapshot, request: { modelVersion: "model-v1" }, claim, assessment }), assessment);
  assert.equal(routeModel({ snapshot, request, claim, assessment: { ...assessment, verified: false, verificationCode: "PATIENT_MISMATCH" } }).verificationCode, "PATIENT_MISMATCH");
});
