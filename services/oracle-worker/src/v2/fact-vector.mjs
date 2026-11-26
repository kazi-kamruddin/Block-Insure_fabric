import { canonical, digest } from "./canonical.mjs";

export const factNames = Object.freeze(["invoiceIssued", "licenceActiveOnServiceDate", "serviceAccredited",
  "tariffBand", "receiptConsistent", "paymentOccurred"]);
const statuses = new Set(["PASS", "CONTRADICTED", "INSUFFICIENT", "UNVERIFIABLE"]);
const integrityReasons = {
  INVALID_SIGNATURE: { status: "UNVERIFIABLE", facts: factNames },
  INACTIVE_LICENCE: { status: "CONTRADICTED", facts: ["licenceActiveOnServiceDate"] },
  UNACCREDITED_SERVICE: { status: "CONTRADICTED", facts: ["serviceAccredited"] },
};
const tariffBands = new Set(["BELOW", "IN", "ABOVE", "FAR_ABOVE"]);
const receiptChecks = new Set(["MATCH", "MISMATCH", "ABSENT"]);
const advice = new Set(["AUTO", "REVIEW"]);
export const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const sha256Hex = /^[a-f0-9]{64}$/;

export function tariffBandFor(billMinor, bandMinMinor, bandMaxMinor) {
  if (![billMinor, bandMinMinor, bandMaxMinor].every(value => Number.isSafeInteger(value) && value >= 0) ||
      bandMaxMinor === 0 || bandMinMinor > bandMaxMinor) throw new TypeError("Invalid tariff amounts");
  if (billMinor < bandMinMinor) return "BELOW";
  const scaledBill = BigInt(billMinor) * 100n;
  const maximum = BigInt(bandMaxMinor);
  if (scaledBill <= maximum * 100n) return "IN";
  return scaledBill <= maximum * 115n ? "ABOVE" : "FAR_ABOVE";
}

export function modelAdviceFor(riskScoreUnits, thresholdUnits) {
  if (![riskScoreUnits, thresholdUnits].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError("Model advice requires nonnegative integer scores");
  }
  return riskScoreUnits >= thresholdUnits ? "REVIEW" : "AUTO";
}

export function createFactVector({ claimId, claimVersion, manifestHash, policyVersion, facts, tariffBand, receiptCheck, modelAdvice }) {
  if (![claimId, policyVersion].every(value => typeof value === "string" && identifier.test(value)) ||
      !Number.isSafeInteger(claimVersion) || claimVersion < 1 || typeof manifestHash !== "string" || !sha256Hex.test(manifestHash) ||
      !facts || Array.isArray(facts) || typeof facts !== "object" ||
      !tariffBands.has(tariffBand) || !receiptChecks.has(receiptCheck) || !advice.has(modelAdvice)) {
    throw new TypeError("Invalid fact vector");
  }
  const normalized = Object.fromEntries(Object.entries(facts).map(([name, fact]) => {
    if (!factNames.includes(name) || !fact || !statuses.has(fact.status) || !Array.isArray(fact.evidence) ||
        Array.from(fact.evidence).some(id => typeof id !== "string" || !identifier.test(id)) ||
        (fact.status === "PASS" && fact.evidence.length === 0)) throw new TypeError("Invalid fact evidence");
    const reason = fact.integrity && Object.hasOwn(integrityReasons, fact.integrity) ? integrityReasons[fact.integrity] : null;
    if (fact.integrity !== undefined && (!reason || !reason.facts.includes(name) || reason.status !== fact.status)) {
      throw new TypeError("Invalid fact integrity reason");
    }
    return [name, { status: fact.status, evidence: [...new Set(fact.evidence)].sort(),
      ...(reason && { integrity: fact.integrity }) }];
  }));
  return { schema: "fact-vector-v1", claimId, claimVersion, manifestHash, policyVersion,
    facts: normalized, tariffBand, receiptCheck, modelAdvice };
}

export function factVectorHash(vector) {
  return digest("oracle-v2:fact-vector", createFactVector(vector));
}

export function parseFactVector(encoded) {
  if (typeof encoded !== "string") throw new TypeError("A canonical fact vector must be text");
  const vector = createFactVector(JSON.parse(encoded));
  if (canonical(vector) !== encoded) throw new TypeError("Noncanonical fact vector");
  return vector;
}
