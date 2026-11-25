import { createFactVector, tariffBandFor } from "./fact-vector.mjs";
import { diagnosticPolicy } from "./decision.mjs";
import { authorizedFor, independentEvidence } from "./sources.mjs";

const fact = (status, records = [], integrity) => ({ status, evidence: records.map(record => record.recordId),
  ...(integrity && { integrity }) });

function during(serviceDate, payload) {
  return /^\d{4}-\d{2}-\d{2}$/.test(payload.validFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(payload.validUntil) &&
    payload.validFrom <= serviceDate && serviceDate < payload.validUntil;
}

function latest(rows) {
  const ordered = rows.toSorted((left, right) => right.payload.validFrom.localeCompare(left.payload.validFrom, "en"));
  if (ordered.length >= 2 && ordered[0].payload.validFrom === ordered[1].payload.validFrom) return null;
  return ordered[0];
}

// All inputs here come from verified pinned feeds. S-C comparisons are
// allowed to be derived. They never supply independent invoice evidence.
export function factsFromSources({ claim, manifestHash, modelAdvice, records, issuers,
  policy = diagnosticPolicy, sourceStatus = {}, verifiedAbsences = new Set(), privateReceipt }) {
  const rows = [...records.values()];
  const eligible = (name, kind, predicate) => rows.filter(row => row.payload?.kind === kind &&
    authorizedFor(issuers.get(row.issuerId), name) && predicate(row.payload));
  const byClaim = payload => payload.claimId === claim.id && payload.claimVersion === claim.version;
  const byHospital = payload => payload.hospitalId === claim.hospitalId;
  const byService = payload => byHospital(payload) && payload.service === claim.service;
  const byEffectiveDate = payload => during(claim.serviceDate, payload);
  const failUnavailable = name => {
    const source = sourceStatus[name];
    if (source === "INVALID_SIGNATURE") return fact("UNVERIFIABLE", [], "INVALID_SIGNATURE");
    if (verifiedAbsences.has(name)) return fact("INSUFFICIENT");
    return fact("UNVERIFIABLE");
  };
  const invoices = eligible("invoiceIssued", "INVOICE", byClaim);
  const invoice = invoices.length === 1 ? invoices[0] : undefined;
  const goodInvoice = invoice && byService(invoice.payload) && invoice.payload.serviceDate === claim.serviceDate &&
    Number.isSafeInteger(invoice.payload.billMinor) && invoice.payload.billMinor === claim.billMinor &&
    (!policy.requireReceiptNumber || (typeof invoice.payload.invoiceNumber === "string" && invoice.payload.invoiceNumber.length > 0 &&
      invoice.payload.invoiceHash === claim.invoiceHash && invoice.payload.invoiceDate === claim.invoiceDate &&
      invoice.payload.diagnosisCode === claim.diagnosisCode && invoice.payload.admissionDate === claim.admissionDate &&
      invoice.payload.dischargeDate === claim.dischargeDate));
  const facts = {
    invoiceIssued: invoices.length ? fact(goodInvoice ? "PASS" : "CONTRADICTED", invoices) : failUnavailable("invoiceIssued"),
  };
  const independent = (row, name) => goodInvoice && (policy.checkSourceIndependence === false ||
    independentEvidence(invoice, row, { records, issuers }, "invoiceIssued", name));

  function regulator(name, kind, predicate, status, integrity) {
    const candidates = eligible(name, kind, payload => predicate(payload) && byEffectiveDate(payload));
    const row = latest(candidates);
    if (row === undefined) return failUnavailable(name);
    if (row === null) return fact("CONTRADICTED", candidates);
    if (row.payload.status !== status) return fact("CONTRADICTED", [row], integrity);
    return fact(independent(row, name) ? "PASS" : "INSUFFICIENT", [row]);
  }

  facts.licenceActiveOnServiceDate = regulator("licenceActiveOnServiceDate", "LICENCE", byHospital, "ACTIVE", "INACTIVE_LICENCE");
  facts.serviceAccredited = regulator("serviceAccredited", "ACCREDITATION", byService, "ACCREDITED", "UNACCREDITED_SERVICE");
  const tariffs = eligible("tariffBand", "TARIFF", payload => byService(payload) && byEffectiveDate(payload));
  const tariff = latest(tariffs);
  let tariffBand = "FAR_ABOVE";
  if (tariff) {
    try {
      tariffBand = tariffBandFor(claim.billMinor, tariff.payload.bandMinMinor, tariff.payload.bandMaxMinor);
      facts.tariffBand = fact(independent(tariff, "tariffBand") ? "PASS" : "INSUFFICIENT", [tariff]);
    } catch {
      facts.tariffBand = fact("UNVERIFIABLE", [tariff]);
    }
  } else {
    facts.tariffBand = tariff === null ? fact("CONTRADICTED", tariffs) : failUnavailable("tariffBand");
  }

  const receipts = eligible("receiptConsistent", "RECEIPT", byClaim);
  let receiptCheck = receipts.length ? "MISMATCH" : "ABSENT";
  if (receipts.length === 1 && goodInvoice) {
    const [receipt] = receipts;
    const match = byHospital(receipt.payload) && receipt.payload.serviceDate === claim.serviceDate &&
      receipt.payload.billMinor === invoice.payload.billMinor && receipt.payload.invoiceRecordId === invoice.recordId &&
      receipt.derivedFrom.includes(invoice.recordId) && (!policy.requireReceiptNumber ||
        (privateReceipt?.invoiceNumber === invoice.payload.invoiceNumber && receipt.payload.invoiceNumber === invoice.payload.invoiceNumber &&
          privateReceipt?.derivedFrom === invoice.recordId && privateReceipt?.hospitalId === claim.hospitalId &&
          privateReceipt?.serviceDate === claim.serviceDate && privateReceipt?.amountMinor === invoice.payload.billMinor));
    if (match) receiptCheck = "MATCH";
  }
  facts.receiptConsistent = receipts.length
    ? fact(receiptCheck === "MATCH" ? "PASS" : "CONTRADICTED", receipts) : failUnavailable("receiptConsistent");
  if (policy.requiredFacts.includes("paymentOccurred")) {
    const payments = eligible("paymentOccurred", "PAYMENT", byClaim);
    const [payment] = payments;
    const matches = payments.length === 1 && byHospital(payment.payload) &&
      payment.payload.paymentDate >= claim.serviceDate && payment.payload.status === "OCCURRED" && payment.payload.paidMinor === claim.billMinor;
    facts.paymentOccurred = payment ? fact(matches ? independent(payment, "paymentOccurred") ? "PASS" : "INSUFFICIENT" : "CONTRADICTED", payments)
      : failUnavailable("paymentOccurred");
  }
  return createFactVector({ claimId: claim.id, claimVersion: claim.version, manifestHash,
    policyVersion: policy.version, facts, tariffBand, receiptCheck, modelAdvice });
}
