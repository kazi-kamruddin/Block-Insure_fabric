import { sha256Hex } from "@/lib/evidence/browser-crypto";
import { canonicalProtocolInput } from "./canonical-protocol";

export type RevisionProof = {
  publicHash: string; id: string; patientReferenceHash: string; service: string;
  serviceDate: string; admissionDate: string; dischargeDate: string; billMinor: number;
  invoiceDate: string; diagnosisCode: string;
};

export async function revisionMatches(proof: RevisionProof) {
  const fields = [proof.id, proof.patientReferenceHash, proof.service, proof.serviceDate, proof.admissionDate,
    proof.dischargeDate, String(proof.billMinor), proof.invoiceDate, proof.diagnosisCode];
  const canonical = canonicalProtocolInput("fabric-medical-intake-v1", ...fields);
  return await sha256Hex(new TextEncoder().encode(canonical)) === proof.publicHash.toLowerCase();
}
