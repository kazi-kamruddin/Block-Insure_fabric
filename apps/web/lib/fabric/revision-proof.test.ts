import { expect, it } from "vitest";
import { revisionMatches, type RevisionProof } from "./revision-proof";

const proof: RevisionProof = {
  publicHash: "f0ff06c6969991e21c31de6eafaebd009dc40c4706d1d7e2be485a22aeba24f1",
  id: "episode-1", patientReferenceHash: "a".repeat(64), service: "DIAGNOSTIC",
  serviceDate: "2026-11-24", admissionDate: "2026-11-24", dischargeDate: "2026-11-24",
  billMinor: 8500000, invoiceDate: "2026-11-24", diagnosisCode: "পরীক্ষা",
};

it("checks the exact UTF-8 revision preimage and detects an altered fact", async () => {
  expect(await revisionMatches(proof)).toBe(true);
  expect(await revisionMatches({ ...proof, billMinor: 8500001 })).toBe(false);
});
