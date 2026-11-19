export type MedicalRules = {
  packageId: string; version: number; service: string; serviceSublimitMinor: number;
  deductibleBps: number; deductibleCapMinor: number; insurerShareBps: number;
  waitingDays: number; filingDays: number; evidenceRequired: boolean; termsHash: string;
};

export type PublishedMedicalOffer = {
  id: string; name: string; premiumMinor: number; coverageLimitMinor: number; rules: MedicalRules;
};

export type MedicalEpisode = {
  id: string; hospitalId: string; revision: number; service: string; serviceDate: string;
  admissionDate: string; dischargeDate: string; billMinor: number;
  associationStatus: "PENDING" | "VERIFIED"; associationVersion: number; patientReferenceHash: string; beneficiaryId: string;
};

export type MedicalQuote = {
  billedMinor: number; eligibleMinor: number; deductibleMinor: number; insurerShareMinor: number;
  remainingCoverMinor: number; payableMinor: number; filingDeadline: string; evidenceRequired: boolean; statementHash: string;
};

export type MedicalPreparation = {
  id: string; preparedAt: string; filingDeadline: string;
};
