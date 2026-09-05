export type LedgerTimestamp = string;

export type PolicyPackage = {
  assetType: "policyPackage";
  schemaVersion: number;
  id: string;
  version: number;
  name: string;
  description: string;
  premiumMinor: number;
  coverageLimitMinor: number;
  termsHash: string;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type Policy = {
  assetType: "policy";
  schemaVersion: number;
  id: string;
  packageId: string;
  packageVersion: number;
  policyholderId: string;
  startDate: string;
  endDate: string;
  premiumMinor: number;
  coverageLimitMinor: number;
  termsHash: string;
  status: "ACTIVE";
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type ClaimStatus =
  | "SUBMITTED"
  | "HOSPITAL_VERIFIED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SETTLEMENT_AUTHORIZED"
  | "SETTLED";

export type Claim = {
  assetType: "claim";
  schemaVersion: number;
  id: string;
  policyId: string;
  claimantId: string;
  amountMinor: number;
  incidentDate: string;
  descriptionHash: string;
  evidenceIds: string[];
  hospitalVerificationId: string;
  auditorDecisionId: string;
  status: ClaimStatus;
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type EvidenceAccessRecord = {
  assetType: "evidenceAccess";
  schemaVersion: number;
  id: string;
  evidenceId: string;
  claimId: string;
  accessorMsp: string;
  accessorRole: string;
  accessorIdentity: string;
  purpose: "DOWNLOAD" | "VERIFY" | "AUDIT";
  createdAt: LedgerTimestamp;
};

export type EvidenceReference = {
  assetType: "evidenceReference";
  schemaVersion: number;
  id: string;
  claimId: string;
  documentType: string;
  contentHash: string;
  storageReferenceHash: string;
  submittedBy: string;
  createdAt: LedgerTimestamp;
};

export type HospitalVerification = {
  assetType: "hospitalVerification";
  schemaVersion: number;
  id: string;
  claimId: string;
  hospitalIdentity: string;
  outcome: "VERIFIED" | "INVALID";
  clinicalReferenceHash: string;
  createdAt: LedgerTimestamp;
};

export type AuditorDecision = {
  assetType: "auditorDecision";
  schemaVersion: number;
  id: string;
  claimId: string;
  auditorIdentity: string;
  outcome: "APPROVE" | "REJECT";
  reasonHash: string;
  createdAt: LedgerTimestamp;
};

export type Settlement = {
  assetType: "settlement";
  schemaVersion: number;
  id: string;
  claimId: string;
  amountMinor: number;
  status: "AUTHORIZED" | "CONFIRMED";
  bankReferenceHash: string;
  authorizedAt: LedgerTimestamp;
  confirmedAt: LedgerTimestamp;
};

export type ClaimHistoryRecord = {
  txId: string;
  timestamp: LedgerTimestamp;
  isDelete: boolean;
  value?: Claim;
};
