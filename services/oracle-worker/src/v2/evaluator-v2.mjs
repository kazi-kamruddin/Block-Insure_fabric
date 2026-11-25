import { createRequire } from "node:module";
import { adapterContract, prepareObservation } from "../xgboost.mjs";
import { modelAdviceFor, sha256Hex } from "./fact-vector.mjs";

const require = createRequire(import.meta.url);
const { compile } = require("../../frozen/xgboost.cjs");
const { createContextIndex } = require("../../frozen/context.cjs");
const engine = compile(require("../../frozen/bundle.json"));
const DAY = 86_400_000;
const MAX_WINDOW = 10_000;

export class EvaluatorV2Error extends Error {
  constructor(code) {
    super(code);
    this.name = "EvaluatorV2Error";
    this.code = code;
  }
}

function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
}

function subject(msp, subjectId) {
  if (!/^[A-Za-z][A-Za-z0-9]*MSP$/.test(msp) || typeof subjectId !== "string" || !subjectId || subjectId.trim() !== subjectId) {
    throw new EvaluatorV2Error("CONTEXT_INCOMPLETE");
  }
  return JSON.stringify([msp, subjectId]);
}

function providerPrior(source) {
  if (!sha256Hex.test(source.patientReferenceHash ?? "") || !sha256Hex.test(source.invoiceHash ?? "") ||
      !Number.isSafeInteger(source.amountMinor) || source.amountMinor < 0 ||
      typeof source.treatmentType !== "string" || !source.treatmentType || typeof source.diagnosisCode !== "string") {
    throw new EvaluatorV2Error("CONTEXT_INCOMPLETE");
  }
  const hospitalId = subject(source.hospitalMsp, source.hospitalId);
  const unlinked = source.associationStatus === "UNVERIFIED" || source.associationStatus === "PENDING" || !source.patientIssuerMsp;
  // Hospital-local identity protects patient aggregates across hospitals.
  const patientHash = unlinked ? subject("HospitalMSP", JSON.stringify([hospitalId, source.patientReferenceHash])) :
    subject(source.patientIssuerMsp, source.patientReferenceHash);
  return { hospitalId, patientHash, observationDate: source.invoiceDate,
    billAmount: source.amountMinor / adapterContract.amountMinorPerModelUnit,
    treatmentType: source.treatmentType, diagnosisCode: source.diagnosisCode };
}

export function evaluateV2({ records, claim, snapshotTimestamp, incompleteInvoiceIds = [] }) {
  if (!Array.isArray(records) || !claim) throw new EvaluatorV2Error("CONTEXT_INCOMPLETE");
  const current = records.filter(record => record.invoiceId === claim.hospitalInvoiceId && record.hospitalId === claim.hospitalId);
  if (current.length !== 1 || current[0].associationStatus === "UNVERIFIED" || current[0].associationStatus === "PENDING") {
    throw new EvaluatorV2Error("CURRENT_SOURCE_UNAVAILABLE");
  }
  const representedInvoiceIds = new Set(records.map(record => record.invoiceId));
  if (incompleteInvoiceIds.some(invoiceId => !representedInvoiceIds.has(invoiceId))) throw new EvaluatorV2Error("CONTEXT_INCOMPLETE");
  let prepared;
  try {
    prepared = prepareObservation({ records: current, claim, snapshotTimestamp });
  } catch {
    throw new EvaluatorV2Error("CURRENT_SOURCE_UNAVAILABLE");
  }
  if (!prepared.comparison.patientMatches || !prepared.comparison.hospitalId || !prepared.comparison.invoiceHash) {
    throw new EvaluatorV2Error("CURRENT_SOURCE_UNAVAILABLE");
  }
  const cutoff = Date.parse(prepared.cutoff);
  const priors = [];
  const hashes = new Set([current[0].invoiceHash]);
  for (const source of records) {
    if (source === current[0]) continue;
    const invoiceDay = day(source.invoiceDate);
    if (!Number.isFinite(invoiceDay)) {
      const discharged = day(source.dischargeDate);
      if (source.invoiceDate || !Number.isFinite(discharged) || discharged < cutoff) {
        throw new EvaluatorV2Error("CONTEXT_INCOMPLETE");
      }
      continue;
    }
    if (invoiceDay >= cutoff || invoiceDay < cutoff - 90 * DAY) continue;
    if (!Number.isFinite(day(source.dischargeDate)) || invoiceDay < day(source.dischargeDate)) {
      throw new EvaluatorV2Error("CONTEXT_INCOMPLETE");
    }
    if (priors.length + 1 >= MAX_WINDOW) throw new EvaluatorV2Error("CONTEXT_OVERSIZED");
    if (hashes.has(source.invoiceHash)) throw new EvaluatorV2Error("CONTEXT_DUPLICATE");
    hashes.add(source.invoiceHash);
    priors.push(providerPrior(source));
  }
  const index = createContextIndex();
  for (const row of priors) index.add(row);
  index.seal();
  const history = index.query(prepared.record);
  const observation = { ...prepared.observation, providerLags: history.providerLags,
    features: { ...prepared.observation.features, ...history.features } };
  const assessment = engine.score(observation);
  // Mandatory reasons are handled separately by the policy evidence gate.
  return { assessment, modelAdvice: modelAdviceFor(assessment.riskScoreUnits, assessment.policy.thresholdUnits),
    prepared: { ...prepared, observation }, windowedRecords: priors.length + 1 };
}
