import { createPrivateKey, createPublicKey } from "node:crypto";
import { digest } from "../../services/oracle-worker/src/v2/canonical.mjs";

export const scenarios = Object.freeze([
  { id: "altered-insurer-snapshot", label: "Insurer snapshot altered", eligible: false },
  { id: "inflated-hospital-bill", label: "Hospital bill above regulator band", eligible: false },
  { id: "altered-receipt", label: "Claimant receipt changed, including benign transcription mismatches", eligible: false },
  { id: "licence-or-accreditation", label: "Inactive licence or unaccredited service", eligible: false },
  { id: "one-worker-offline", label: "One worker offline", eligible: true },
  { id: "stale-mirror", label: "One worker reads a stale mirror, with compound-fault subsets", eligible: true },
  { id: "copied-commitment", label: "Duplicate commitment offered by one worker", eligible: true },
  { id: "consistent-collusion", label: "Consistent Hospital and claimant reports of a false amount", eligible: false },
  { id: "agreeing-copies", label: "Agreement on a dependent copy of false source evidence", eligible: false },
  { id: "contradictory-payment", label: "Independent payment evidence contradicts the request", eligible: false },
  { id: "clean", label: "Clean claim", eligible: true },
]);
export const phase3Scenarios = Object.freeze([...scenarios, {
  id: "hospital-payment-copy", label: "Hospital confirmation derived from the invoice, with or without a signed Bank event", eligible: false,
}]);

export const issuerMetadata = Object.freeze([
  { issuerId: "s-a", keyVersion: 1, kind: "HOSPITAL_HIS", controlDomain: "hospital",
    authorizedFacts: ["invoiceIssued"] },
  { issuerId: "s-b", keyVersion: 1, kind: "REGULATOR", controlDomain: "regulator",
    authorizedFacts: ["licenceActiveOnServiceDate", "serviceAccredited", "tariffBand"] },
  { issuerId: "s-c", keyVersion: 1, kind: "CLAIMANT_RECEIPT", controlDomain: "claimant",
    authorizedFacts: ["receiptConsistent"] },
  { issuerId: "s-d", keyVersion: 1, kind: "PAYMENT", controlDomain: "simulated-bank",
    authorizedFacts: ["paymentOccurred"] },
]);

export function fixtureKeys(seed) {
  // Deterministic, test-only Ed25519 keys. A public benchmark seed must
  // never be used for a real issuer, source feed or worker credential.
  const ed25519SeedPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return new Map(issuerMetadata.map(issuer => {
    const seedBytes = Buffer.from(digest("oracle-v2-benchmark:synthetic-signing-key", [seed, issuer.issuerId]), "hex");
    const privateKey = createPrivateKey({ key: Buffer.concat([ed25519SeedPrefix, seedBytes]), type: "pkcs8", format: "der" });
    return [issuer.issuerId, { ...issuer, privateKey,
      ed25519PublicKey: createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url"),
      status: "ACTIVE", validFrom: "2026-11-01T00:00:00.000Z", validUntil: "2026-12-01T00:00:00.000Z",
    }];
  }));
}

export function makeCase(scenario, index, seed) {
  const { id, eligible } = scenario;
  const claimId = `${id}-${String(index + 1).padStart(3, "0")}`;
  const entropy = digest("oracle-v2-benchmark:case", [seed, claimId]);
  const random = parseInt(entropy.slice(0, 8), 16);
  const billMinor = id === "inflated-hospital-bill" ? 636_000 + random % 65_000 : 335_000 + random % 140_000;
  const hisInvoiceMinor = id === "altered-insurer-snapshot" ? billMinor - 70_000 : billMinor;
  const groundTruthInvoiceMinor = ["agreeing-copies", "consistent-collusion", "inflated-hospital-bill"].includes(id)
    ? billMinor - 75_000 : hisInvoiceMinor;
  const reportedReceiptMinor = id === "altered-receipt" ? hisInvoiceMinor - 70_000 : hisInvoiceMinor;
  const activeLicence = id !== "licence-or-accreditation" || index % 2 === 1;
  const accredited = id !== "licence-or-accreditation" || index % 2 === 0;
  const hospitalPaymentCopy = id === "hospital-payment-copy";
  const bankEvent = hospitalPaymentCopy && index % 2 === 1;
  const verifyPayment = hospitalPaymentCopy || id === "contradictory-payment" || (id === "clean" && index % 2 === 0);
  const benignMismatch = id === "altered-receipt" && index % 2 === 1;
  const variant = hospitalPaymentCopy ? (bankEvent ? "HOSPITAL_COPY_AND_BANK_CONTRADICTION" : "HOSPITAL_COPY_ONLY") :
    benignMismatch ? "BENIGN_TRANSCRIPTION" :
    id === "altered-receipt" ? "INELIGIBLE_RECEIPT" :
      id === "stale-mirror" && index % 6 === 4 ? "STALE_AND_LATE_REVEAL" :
        id === "stale-mirror" && index % 6 === 5 ? "STALE_AND_THIRD_DISTINCT_RESULT" : "STANDARD";
  const effectiveAt = "2026-11-24T00:00:00.000Z";
  function record(issuerId, name, fields, derivedFrom = []) {
    const recordId = `${claimId}.${name}`;
    return { recordId, issuerId, keyVersion: 1, originId: `${recordId}.origin`, derivedFrom,
      effectiveAt, payload: { claimId, fact: name, ...fields } };
  }
  const invoice = record("s-a", "invoiceIssued", { amountMinor: hisInvoiceMinor, service: "DIAGNOSTIC" });
  const licence = record("s-b", "licenceActiveOnServiceDate", { status: activeLicence ? "ACTIVE" : "SUSPENDED" });
  const accreditation = record("s-b", "serviceAccredited", { status: accredited ? "ACCREDITED" : "UNACCREDITED" },
    id === "agreeing-copies" ? [invoice.recordId] : []);
  const tariff = record("s-b", "tariffBand", { minimumMinor: 215_000, maximumMinor: 500_000 });
  const receipt = record("s-c", "receiptConsistent", { amountMinor: reportedReceiptMinor }, [invoice.recordId]);
  const payment = record("s-d", "paymentOccurred", { amountMinor: id === "contradictory-payment" || bankEvent ? 0 : reportedReceiptMinor });
  const paymentCopy = { ...record("s-a", "paymentOccurred", { amountMinor: reportedReceiptMinor }, [invoice.recordId]),
    recordId: claimId + ".hospital-payment-confirmation" };
  return {
    claimId, claimVersion: 1, billMinor, groundTruthInvoiceMinor, scenario: id, variant,
    eligible: eligible || benignMismatch, verifyPayment, entropy,
    records: [invoice, licence, accreditation, tariff, receipt, ...(verifyPayment && (!hospitalPaymentCopy || bankEvent) ? [payment] : []),
      ...(hospitalPaymentCopy ? [paymentCopy] : [])],
  };
}
