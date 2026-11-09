import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adapterContract, evaluatorHash, evaluatorVersion, normalizeRecord, prepareObservation, inferContext, routeModel } from "../src/xgboost.mjs";
import { validateRegistrySnapshot } from "../src/registry.mjs";
import { unit, source, claim, prior, context, pairedCases } from "./fixtures/xgboost-inputs.mjs";

test("frozen feature and inference parity with source-hashed reference fixtures", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/xgboost-reference.json", import.meta.url), "utf8"));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.reference.modelSha256, "e83eab8c8df7c9996471c754d352d9201ffd30246184c72cd1943c612d2ab380");
  assert.equal(adapterContract.amountMinorPerModelUnit, unit);
  assert.deepEqual(fixture.cases.map(row => ({ name: row.name, input: row.input })), pairedCases);
  for (const row of fixture.cases) {
    const actual = inferContext(row.input);
    assert.deepEqual(row.input.records.map(normalizeRecord), row.normalizedRecords, row.name);
    assert.deepEqual(actual.prepared.observation, row.observation, row.name);
    assert.deepEqual(actual.assessment, row.assessment, row.name);
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
