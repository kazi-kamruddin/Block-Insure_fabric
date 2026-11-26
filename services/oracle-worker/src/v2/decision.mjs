import { createFactVector } from "./fact-vector.mjs";

export const diagnosticPolicy = Object.freeze({
  version: "diagnostic-v1",
  requiredFacts: Object.freeze(["invoiceIssued", "licenceActiveOnServiceDate", "serviceAccredited", "tariffBand", "receiptConsistent"]),
  allowAbsentReceipt: false,
});

export function decide(input, policy = diagnosticPolicy) {
  const vector = createFactVector(input);
  if (!policy.requiredFacts.length || (policy.version && policy.version !== vector.policyVersion)) {
    throw new TypeError("Fact vector policy does not match the pinned policy");
  }
  if (Object.values(vector.facts).some(fact => fact.integrity)) return "INTEGRITY_FAIL";
  const absentAllowed = vector.receiptCheck === "ABSENT" && policy.allowAbsentReceipt &&
    vector.facts.receiptConsistent?.status === "INSUFFICIENT";
  const requiredFactsPass = policy.requiredFacts.every(name => vector.facts[name]?.status === "PASS");
  return requiredFactsPass && (vector.tariffBand === "BELOW" || vector.tariffBand === "IN") &&
    (vector.receiptCheck === "MATCH" || absentAllowed) && vector.modelAdvice === "AUTO"
    ? "AUTO_APPROVE" : "PANEL_REVIEW";
}
