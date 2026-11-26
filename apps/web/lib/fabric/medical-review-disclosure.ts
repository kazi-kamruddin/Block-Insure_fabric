import "server-only";
import type { Claim } from "./types";
import type { RevisionProof } from "./revision-proof";
import { ledger } from "./ledger";

export async function medicalRevisionProof(claim: Claim): Promise<RevisionProof | null> {
  if (!claim.hospitalVerificationId || !claim.hospitalInvoiceId) return null;
  const [binding, episodes, sources] = await Promise.all([
    ledger.readHospitalVerification(claim.hospitalVerificationId),
    ledger.listMedicalEpisodes("insurerAdmin"),
    ledger.listMedicalOracleSources(),
  ]);
  const episode = episodes.find(row => row.id === claim.episodeId && row.revision === claim.episodeRevision &&
    row.hospitalId === claim.hospitalId && row.beneficiaryId === claim.claimantId);
  const source = sources.find(row => row.invoice.id === claim.hospitalInvoiceId && row.invoice.hospitalId === claim.hospitalId);
  if (!episode || !source?.complete || !episode.patientReferenceHash || binding.claimId !== claim.id ||
      binding.claimVersion !== claim.version || !/^[a-f0-9]{64}$/i.test(binding.clinicalReferenceHash)) return null;
  return {
    publicHash: binding.clinicalReferenceHash,
    id: episode.id, patientReferenceHash: episode.patientReferenceHash, service: episode.service,
    serviceDate: episode.serviceDate, admissionDate: episode.admissionDate, dischargeDate: episode.dischargeDate,
    billMinor: episode.billMinor, invoiceDate: source.facts.invoiceDate, diagnosisCode: source.facts.diagnosisCode,
  };
}

export async function issuedMedicalTerms(claim: Claim) {
  const policy = await ledger.readPolicy(claim.policyId);
  const rules = await ledger.readMedicalRules(policy.packageId);
  if (rules.version !== policy.medicalRulesVersion) return null;
  return { sublimitMinor: rules.serviceSublimitMinor, insurerShareBps: rules.insurerShareBps };
}

export async function medicalHospitalName(hospitalId: string) {
  const agreements = await ledger.listPartnerAgreements();
  return agreements.find(agreement => agreement.partnerType === "HOSPITAL" && agreement.partnerId === hospitalId)?.name;
}
