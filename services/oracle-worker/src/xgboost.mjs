import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
export const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const root = new URL("../frozen/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("provenance.json", root), "utf8").replace(/^\uFEFF/, ""));
if (provenance.files.find((entry) => entry.file === "bundle.json")?.sha256 !== "e83eab8c8df7c9996471c754d352d9201ffd30246184c72cd1943c612d2ab380") throw new Error("Frozen model bundle identity mismatch");
for (const entry of provenance.files) {
  const actual = createHash("sha256").update(readFileSync(new URL(entry.file, root))).digest("hex");
  if (actual !== entry.sha256) throw new Error(`Frozen inference dependency changed: ${entry.file}`);
}
const { compile } = require("../frozen/xgboost.cjs");
const { createContextIndex } = require("../frozen/context.cjs");
const { continuousFeatures } = require("../frozen/continuous.cjs");
const { extractObservedFeatures } = require("../frozen/observable.cjs");
const bundle = require("../frozen/bundle.json");
const policy = require("../frozen/triage-policy.json");
const engine = compile(bundle);
export const adapterContract = Object.freeze({
  version: "fabric-xgb-synthetic-v1", amountMinorPerModelUnit: 10_000_000,
  amountMeaning: "Synthetic normalization only; not an exchange rate or real-patient validation",
  identity: "MSP-qualified subject; no wallet/address conversion; explicit authorized patient linkage",
  history: "Complete committed archive, maximum 10000 entries, strictly prior UTC days within 90 days",
  dates: "Explicit admission/discharge/invoice dates; no inferred diagnosis, treatment or invoice availability",
  routing: "Mandatory integrity or frozen score >= thresholdUnits; uncertainty remains diagnostic",
});
export const evaluatorVersion = "fabric-xgb-synthetic-v1";
export const evaluatorHash = hash({ contract: adapterContract, sources: provenance.files,
  adapterSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  proofAdapters: Object.fromEntries(["registry.mjs", "protocol.mjs", "privacy.mjs"].map((name) => [name,
    createHash("sha256").update(readFileSync(new URL(name, import.meta.url))).digest("hex")])) });
const DAY = 86_400_000;
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Invalid canonical date");
  return `${value}T00:00:00.000Z`;
}
function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid BDT minor units");
  return value / adapterContract.amountMinorPerModelUnit;
}
function subject(msp, value) {
  if (!/^[A-Za-z][A-Za-z0-9]*MSP$/.test(msp) || typeof value !== "string" || !value || value !== value.trim()) throw new Error("Missing canonical subject");
  return JSON.stringify([msp, value]);
}

// Source facts are explicit. A finalized Fabric invoice lacks diagnosis,
// expected range and invoice date today: do not fabricate these to run a model.
export function normalizeRecord(source) {
  if (!/^[a-f0-9]{64}$/.test(source.invoiceHash) || !source.invoiceId ||
      typeof source.treatmentType !== "string" || !source.treatmentType || typeof source.diagnosisCode !== "string" ||
      !/^[a-f0-9]{64}$/.test(source.patientReferenceHash)) throw new Error("Incomplete model context");
  const record = {
    hospitalId: subject(source.hospitalMsp, source.hospitalId), patientHash: subject(source.patientIssuerMsp, source.patientReferenceHash),
    authorizedClaimants: [subject(source.patientIssuerMsp, source.patientReferenceHash)],
    treatmentType: source.treatmentType, diagnosisCode: source.diagnosisCode,
    admissionDate: date(source.admissionDate), dischargeDate: date(source.dischargeDate), invoiceDate: date(source.invoiceDate),
    billAmount: amount(source.amountMinor), expectedBillMin: amount(source.expectedMinMinor), expectedBillMax: amount(source.expectedMaxMinor),
    invoiceHash: source.invoiceHash, invoiceStatus: source.invoiceStatus, recordStatus: source.recordStatus, licenseStatus: source.licenseStatus,
    observableHistory: {},
  };
  if (record.expectedBillMax <= 0 || record.expectedBillMin > record.expectedBillMax || record.dischargeDate < record.admissionDate || record.invoiceDate < record.dischargeDate ||
      !["VALID", "USED", "CANCELLED"].includes(record.invoiceStatus) || !["VALID", "INVALID", "USED", "CANCELLED"].includes(record.recordStatus) ||
      !["ACTIVE", "SUSPENDED", "BLACKLISTED"].includes(record.licenseStatus)) throw new Error("Invalid model context facts");
  return record;
}

export function prepareObservation({ records, claim, snapshotTimestamp }) {
  if (!Array.isArray(records) || !records.length || records.length > 10000) throw new Error("Context archive unavailable or oversized");
  const normalized = records.map(normalizeRecord);
  if (new Set(normalized.map((r) => r.invoiceHash)).size !== records.length) throw new Error("Duplicate context identity");
  const selected = records.findIndex((r) => r.invoiceId === claim.hospitalInvoiceId && r.hospitalId === claim.hospitalId);
  if (selected < 0) throw new Error("Invoice absent from model context");
  const record = normalized[selected];
  const cutoff = Math.min(Date.parse(record.invoiceDate), Date.parse(snapshotTimestamp), Date.parse(claim.createdAt));
  if (!Number.isFinite(cutoff)) throw new Error("Invalid context cutoff");
  const cutoffDay = Math.floor(cutoff / DAY) * DAY;
  record.observationDate = new Date(cutoffDay).toISOString();
  const index = createContextIndex();
  for (const prior of normalized) {
    if (prior === record) continue;
    const time = Date.parse(prior.invoiceDate);
    if (time < cutoffDay && time >= cutoffDay - 90 * DAY) index.add({ ...prior, observationDate: prior.invoiceDate });
  }
  index.seal();
  const context = index.query(record);
  const comparison = {
    patientMatches: record.authorizedClaimants.includes(subject(claim.claimantMsp, createHash("sha256").update(claim.claimantId).digest("hex"))),
    hospitalId: record.hospitalId === subject(claim.hospitalMsp, claim.hospitalId),
    invoiceHash: record.invoiceHash === claim.invoiceHash,
    billAmount: amount(claim.amountMinor) <= record.billAmount,
    billRange: record.billAmount >= record.expectedBillMin * .85 && record.billAmount <= record.expectedBillMax * 1.15,
    treatmentType: record.treatmentType.toLowerCase() === claim.treatmentType.toLowerCase(),
    dateConsistency: Date.parse(claim.incidentDate) >= Date.parse(record.admissionDate) - 30 * DAY && Date.parse(claim.incidentDate) <= Date.parse(record.invoiceDate) + 30 * DAY,
    recordStatus: record.recordStatus === "VALID", invoiceStatus: record.invoiceStatus === "VALID", licenseStatus: record.licenseStatus === "ACTIVE",
  };
  const binary = extractObservedFeatures({ record, comparison });
  const mandatory = ["patientMatches", "hospitalId", "invoiceHash", "billAmount", "recordStatus", "invoiceStatus", "licenseStatus"].some((key) => !comparison[key]) ||
    [...policy.routing.hardBlockingFeatures, ...policy.routing.manualReviewFeatures].some((key) => binary[key]);
  return { observation: { features: { ...Object.fromEntries(Object.entries(binary).map(([key, value]) => [key, Number(value)])),
    ...continuousFeatures(record), ...context.features }, providerLags: context.providerLags, mandatory,
    group: record.treatmentType, diagnosis: record.diagnosisCode }, record, comparison, cutoff: new Date(cutoffDay).toISOString() };
}

export function inferContext(context) {
  if (context.incompleteInvoiceIds?.length) throw new Error("Required source history is incomplete");
  const prepared = prepareObservation(context);
  const assessment = engine.score(prepared.observation);
  return { prepared, assessment, contextHash: hash(context), explanationHash: hash(assessment.explanation) };
}

export function routeModel({ snapshot, request, claim, assessment }) {
  // Historical registry-only requests retain their validator, not a new model.
  if (request.modelVersion === "model-v1") return assessment;
  if (request.modelVersion !== evaluatorVersion) return { ...assessment, verified: false, verificationCode: "MODEL_VERSION_MISMATCH" };
  if (request.modelHash !== evaluatorHash) {
    return { ...assessment, verified: false, verificationCode: "XGB_EVALUATOR_UNAVAILABLE" };
  }
  if (!assessment.verified) return assessment;
  try {
    if (!snapshot.modelContext || Date.parse(snapshot.modelContext.snapshotTimestamp) > Date.parse(request.requestedAt)) throw new Error("Unpinned context");
    const source = snapshot.modelContext.records.find((r) => r.invoiceId === claim.hospitalInvoiceId && r.hospitalId === claim.hospitalId);
    const registry = snapshot.records.find((r) => r.invoiceId === claim.hospitalInvoiceId && r.hospitalId === claim.hospitalId);
    if (!source || !registry || source.invoiceHash !== registry.lookupHash || source.amountMinor !== registry.maximumAmountMinor ||
        source.admissionDate !== registry.validFrom || source.dischargeDate !== registry.validThrough ||
        source.treatmentHash !== registry.descriptionHash || source.hospitalMsp !== "HospitalMSP" ||
        source.patientReferenceHash !== registry.patientReferenceHash || source.patientIssuerMsp !== "InsurerMSP") throw new Error("Model/source binding mismatch");
    const result = inferContext({ ...snapshot.modelContext, claim: {
      ...claim, claimantMsp: "InsurerMSP", hospitalMsp: "HospitalMSP",
      treatmentType: source.treatmentType, invoiceHash: registry.lookupHash,
    } });
    const verified = result.assessment.recommendation === "NO_ADDITIONAL_MODEL_REVIEW";
    const resultHash = hash({ contextHash: result.contextHash, evaluatorHash, assessment: result.assessment });
    return { ...assessment, verified, verificationCode: `${verified ? "XGB_AUTO" : "XGB_REVIEW"}:${resultHash.toUpperCase()}`,
      model: "XGBoost", authority: "ORACLE_ROUTING", result };
  } catch {
    return { ...assessment, verified: false, verificationCode: "XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE" };
  }
}
