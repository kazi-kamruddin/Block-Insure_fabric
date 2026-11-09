import { createHash } from "node:crypto";

// Fixed synthetic inputs, independent of the implementation under test.
export const unit = 10_000_000;
export const source = {
  invoiceId: "inv-current", invoiceHash: "a".repeat(64), hospitalMsp: "HospitalMSP", hospitalId: "hospital1",
  patientIssuerMsp: "InsurerMSP", patientReferenceHash: createHash("sha256").update("holder1").digest("hex"),
  treatmentType: "SURGERY", diagnosisCode: "D1", treatmentHash: "b".repeat(64),
  admissionDate: "2026-06-10", dischargeDate: "2026-06-11", invoiceDate: "2026-06-12",
  amountMinor: unit, expectedMinMinor: unit / 2, expectedMaxMinor: unit * 2,
  invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE",
};
export const claim = { hospitalInvoiceId: source.invoiceId, hospitalId: "hospital1", hospitalMsp: "HospitalMSP", claimantId: "holder1", claimantMsp: "InsurerMSP",
  amountMinor: unit / 2, invoiceHash: source.invoiceHash, treatmentType: "SURGERY", incidentDate: "2026-06-10", createdAt: "2026-06-15T00:00:00Z" };
export const prior = { ...source, invoiceId: "inv-prior", invoiceHash: "c".repeat(64), admissionDate: "2026-06-01", dischargeDate: "2026-06-02", invoiceDate: "2026-06-03" };
export const context = { records: [source, prior], claim, snapshotTimestamp: "2026-06-15T00:00:00Z" };
export const pairedCases = [
  { name: "baseline", changes: {} },
  { name: "large-amount", changes: { amountMinor: unit * 10 } },
  { name: "suspended-license", changes: { licenseStatus: "SUSPENDED" } },
  { name: "invalid-record", changes: { recordStatus: "INVALID" } },
  { name: "narrow-expected-range", changes: { expectedMaxMinor: unit / 4, expectedMinMinor: unit / 8 } },
].map(({ name, changes }) => ({ name, input: { ...context, records: [{ ...source, ...changes }, prior] } }));
