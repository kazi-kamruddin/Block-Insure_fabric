import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonical, digest } from "../src/v2/canonical.mjs";
import { commitmentHash } from "../src/v2/commitment-v2.mjs";
import { decide, diagnosticPolicy } from "../src/v2/decision.mjs";
import { createFactVector, factVectorHash, modelAdviceFor, parseFactVector, tariffBandFor } from "../src/v2/fact-vector.mjs";
import { evaluateV2 } from "../src/v2/evaluator-v2.mjs";
import { inferContext } from "../src/xgboost.mjs";
import { context, pairedCases, prior, source } from "./fixtures/xgboost-inputs.mjs";

const vectors = JSON.parse(await readFile(new URL("./vectors/v2/protocol.json", import.meta.url), "utf8"));

test("portable vectors pin canonical UTF-8, facts and subject-bound commitments", () => {
  assert.equal(canonical(vectors.portable), vectors.encoding);
  assert.equal(digest(vectors.domain, vectors.portable), vectors.digest);
  assert.equal(factVectorHash(vectors.vector), vectors.vectorHash);
  assert.deepEqual(parseFactVector(canonical(vectors.vector)), vectors.vector);
  assert.throws(() => parseFactVector(canonical({ ...vectors.vector, unknown: "forbidden-field" })), /Noncanonical/);
  assert.equal(commitmentHash(vectors.commitmentInput), vectors.commitment);
  for (const field of ["channelId", "requestId", "oracleSubject"]) {
    assert.notEqual(commitmentHash({ ...vectors.commitmentInput, [field]: "another-id" }), vectors.commitment);
  }
  for (const invalid of [Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, null, false, [undefined], "\uDFFF"]) {
    assert.throws(() => canonical(invalid));
  }
});

test("decision, exact tariff fractions and inclusive score threshold match the portable vectors", () => {
  assert.equal(decide(vectors.vector), vectors.commitmentInput.decision);
  for (const [amount, minimum, maximum, expected] of vectors.tariff) assert.equal(tariffBandFor(amount, minimum, maximum), expected);
  for (const [score, threshold, expected] of vectors.threshold) assert.equal(modelAdviceFor(score, threshold), expected);
  for (const { field, status, integrity, expected } of vectors.decisions) {
    const vector = structuredClone(vectors.vector);
    vector.facts[field] = { status, evidence: [], ...(integrity && { integrity }) };
    assert.equal(decide(createFactVector(vector)), expected);
  }
  const vector = { ...vectors.vector, receiptCheck: "ABSENT", facts: { ...vectors.vector.facts, receiptConsistent: { status: "INSUFFICIENT", evidence: [] } } };
  assert.equal(decide(vector), "PANEL_REVIEW");
  assert.equal(decide(vector, { ...diagnosticPolicy, allowAbsentReceipt: true,
    requiredFacts: diagnosticPolicy.requiredFacts.filter(fact => fact !== "receiptConsistent") }), "AUTO_APPROVE");
  assert.equal(decide({ ...vectors.vector, tariffBand: "ABOVE" }), "PANEL_REVIEW");
});

test("complete v2 contexts preserve every paired v1 integer score", () => {
  for (const { name, input } of pairedCases) {
    assert.equal(evaluateV2(input).assessment.riskScoreUnits, inferContext(input).assessment.riskScoreUnits, name);
  }
  const differentlyLinked = { ...prior, patientReferenceHash: "d".repeat(64) };
  const input = { ...context, records: [source, prior, { ...differentlyLinked, invoiceId: "additional", invoiceHash: "e".repeat(64) }] };
  assert.equal(evaluateV2(input).assessment.riskScoreUnits, inferContext(input).assessment.riskScoreUnits);
});

test("a prior unlinked episode without a benchmark contributes only to provider history", () => {
  const unlinked = { ...prior, patientIssuerMsp: undefined, associationStatus: "UNVERIFIED", expectedMinMinor: undefined, expectedMaxMinor: undefined };
  const input = { ...context, records: [source, unlinked], incompleteInvoiceIds: [unlinked.invoiceId] };
  assert.throws(() => inferContext(input), /incomplete/);
  const { assessment, prepared } = evaluateV2(input);
  assert.ok(Number.isSafeInteger(assessment.riskScoreUnits));
  assert.equal(prepared.observation.features.history_patient14, 0);
  assert.ok(prepared.observation.features.history_provider30 > 0);
});

test("caps the scoped window and fails closed on potentially prior missing dates", () => {
  const dense = Array.from({ length: 10_000 }, (_, index) => ({ ...prior,
    invoiceId: `prior-${index}`, invoiceHash: String(index).padStart(64, "0") }));
  assert.throws(() => evaluateV2({ ...context, records: [source, ...dense] }), { code: "CONTEXT_OVERSIZED" });
  const old = dense.map(row => ({ ...row, admissionDate: "2025-01-01", dischargeDate: "2025-01-03", invoiceDate: "2025-01-03" }));
  assert.equal(evaluateV2({ ...context, records: [source, ...old] }).windowedRecords, 1);
  assert.throws(() => evaluateV2({ ...context, records: [source, { ...prior, invoiceDate: "" }] }), { code: "CONTEXT_INCOMPLETE" });
  assert.equal(evaluateV2({ ...context, records: [source, { ...prior, invoiceDate: "", dischargeDate: source.invoiceDate }] }).windowedRecords, 1);
});
