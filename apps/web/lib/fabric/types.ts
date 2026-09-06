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
  status: "PENDING_PAYMENT" | "ACTIVE" | "GRACE" | "LAPSED" | "CANCELLED" | "EXPIRED";
  premiumIntervalDays?: number;
  gracePeriodDays?: number;
  paidThroughDate?: string;
  nextPremiumDueDate?: string;
  renewedFromPolicyId?: string;
  cancellationReasonHash?: string;
  benefitPlanId?: string;
  benefitPlanVersion?: number;
  deathBenefitMinor?: number;
  surrenderBenefitMinor?: number;
  maturityBenefitMinor?: number;
  benefitRulesHash?: string;
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type BankAccountReference = {
  assetType: "bankAccountReference";
  schemaVersion: number;
  id: string;
  ownerId: string;
  accountTokenHash: string;
  status: "VERIFIED" | "DISABLED";
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type BankMandate = {
  assetType: "bankMandate";
  schemaVersion: number;
  id: string;
  policyId: string;
  accountReferenceId: string;
  ownerId: string;
  amountMinor: number;
  intervalDays: number;
  nextDebitDate: string;
  expiryDate: string;
  status: "PENDING" | "ACTIVE" | "REJECTED" | "CANCELLED" | "EXPIRED";
  decisionHash: string;
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type PremiumPayment = {
  assetType: "premiumPayment";
  schemaVersion: number;
  id: string;
  policyId: string;
  mandateId: string;
  periodStartDate: string;
  periodEndDate: string;
  amountMinor: number;
  externalReferenceHash: string;
  method: "OTP" | "AUTODEBIT";
  recordedAt: LedgerTimestamp;
};

export type PremiumAdjustment = {
  assetType: "premiumAdjustment";
  schemaVersion: number;
  id: string;
  paymentId: string;
  policyId: string;
  amountMinor: number;
  externalReferenceHash: string;
  reasonHash: string;
  type: "REVERSAL";
  recordedAt: LedgerTimestamp;
};

export type PremiumCollection = {
  assetType: "premiumCollection";
  schemaVersion: number;
  id: string;
  policyId: string;
  mandateId: string;
  dueDate: string;
  amountMinor: number;
  status: "DUE" | "RETRY" | "COMPLETED" | "FAILED";
  paymentId: string;
  failureHash: string;
  attemptCount: number;
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type BeneficiaryAllocation = { beneficiaryId: string; shareBps: number };

export type BenefitPlan = {
  assetType: "benefitPlan";
  schemaVersion: number;
  id: string;
  packageId: string;
  version: number;
  deathBenefitMinor: number;
  surrenderBenefitMinor: number;
  maturityBenefitMinor: number;
  rulesHash: string;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type BeneficiaryDesignation = {
  assetType: "beneficiaryDesignation";
  schemaVersion: number;
  policyId: string;
  ownerId: string;
  revision: number;
  allocations: BeneficiaryAllocation[];
  updatedAt: LedgerTimestamp;
};

export type BenefitRequest = {
  assetType: "benefitRequest";
  schemaVersion: number;
  id: string;
  policyId: string;
  requesterId: string;
  benefitType: "DEATH" | "SURRENDER" | "MATURITY";
  benefitPlanId: string;
  benefitPlanVersion: number;
  benefitRulesHash: string;
  eventDate: string;
  amountMinor: number;
  evidenceHash: string;
  decisionHash: string;
  fundingReferenceHash: string;
  bankReferenceHash: string;
  status: "SUBMITTED" | "REJECTED" | "FUNDING_REQUIRED" | "PAYMENT_READY" | "PAID";
  allocations: BeneficiaryAllocation[];
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type Liability = {
  assetType: "liability";
  schemaVersion: number;
  id: string;
  sourceType: "CLAIM" | "BENEFIT";
  sourceId: string;
  policyId: string;
  amountMinor: number;
  status: "FUNDING_REQUIRED" | "PAYMENT_READY" | "PAID";
  fundingReferenceHash: string;
  bankReferenceHash: string;
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type ClaimStatus =
  | "SUBMITTED"
  | "HOSPITAL_VERIFIED"
  | "ORACLE_PENDING"
  | "ORACLE_FAILED"
  | "UNDER_REVIEW"
  | "APPEAL_SUBMITTED"
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
  currentReviewId: string;
  currentAppealId: string;
  currentOracleRequestId: string;
  oracleOutcome: string;
  oracleResultHash: string;
  version: number;
  reviewRound: number;
  appealCount: number;
  status: ClaimStatus;
  createdAt: LedgerTimestamp;
  updatedAt: LedgerTimestamp;
};

export type OracleRegistrySnapshot = {
  assetType: "oracleRegistrySnapshot";
  schemaVersion: number;
  id: string;
  version: number;
  rootHash: string;
  rulesVersion: string;
  rulesHash: string;
  recordCount: number;
  publishedBy: string;
  createdAt: LedgerTimestamp;
};

export type OracleRequest = {
  assetType: "oracleRequest";
  schemaVersion: number;
  id: string;
  claimId: string;
  claimVersion: number;
  hospitalVerificationId: string;
  queryHash: string;
  registrySnapshotId: string;
  registryVersion: number;
  registryRootHash: string;
  rulesVersion: string;
  rulesHash: string;
  modelVersion: string;
  modelHash: string;
  assignedOracleIds: string[];
  requiredConfirmations: number;
  expectedResponses: number;
  commitmentCount: number;
  revealCount: number;
  status: "PENDING" | "CONSENSUS" | "FAILED";
  verifiedResult: boolean;
  resultHash: string;
  finalizationCode: "" | "EXACT_CONSENSUS" | "NEGATIVE_RESULT" | "CONFLICT" | "TIMEOUT";
  commitDeadline: LedgerTimestamp;
  revealDeadline: LedgerTimestamp;
  requestedAt: LedgerTimestamp;
  finalizedAt: LedgerTimestamp;
};

export type OracleCommitment = {
  assetType: "oracleCommitment";
  schemaVersion: number;
  id: string;
  requestId: string;
  claimId: string;
  claimVersion: number;
  oracleId: string;
  oracleIdentity: string;
  commitmentHash: string;
  createdAt: LedgerTimestamp;
};

export type OracleResult = {
  assetType: "oracleResult";
  schemaVersion: number;
  id: string;
  requestId: string;
  claimId: string;
  claimVersion: number;
  registryVersion: number;
  modelVersion: string;
  oracleId: string;
  oracleIdentity: string;
  verified: boolean;
  verificationCode: string;
  recordHash: string;
  resultHash: string;
  createdAt: LedgerTimestamp;
};

export type OracleRequestHistoryRecord = {
  txId: string;
  timestamp: LedgerTimestamp;
  isDelete: boolean;
  value?: OracleRequest;
};

export type EvidenceAccessRecord = {
  assetType: "evidenceAccess";
  schemaVersion: number;
  id: string;
  evidenceId: string;
  claimId: string;
  grantId: string;
  accessorMsp: string;
  accessorRole: string;
  accessorIdentity: string;
  purpose: "DOWNLOAD" | "VERIFY" | "AUDIT";
  createdAt: LedgerTimestamp;
};

export type EvidenceAccessGrant = {
  assetType: "evidenceGrant";
  schemaVersion: number;
  id: string;
  evidenceId: string;
  claimId: string;
  ownerId: string;
  granteeMsp: "InsurerMSP" | "HospitalMSP" | "AuditorMSP";
  granteeRole: "insurerAdmin" | "hospitalOfficer" | "auditor";
  granteeSubject: string;
  purpose: "DOWNLOAD" | "VERIFY" | "AUDIT";
  expiresAt: LedgerTimestamp;
  maxAccesses: number;
  accessCount: number;
  status: "ACTIVE" | "REVOKED";
  createdAt: LedgerTimestamp;
  revokedAt: LedgerTimestamp;
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
  reviewId: string;
  reviewRound: number;
  auditorId: string;
  auditorIdentity: string;
  outcome: "APPROVE" | "REJECT";
  reasonHash: string;
  createdAt: LedgerTimestamp;
};

export type ClaimReview = {
  assetType: "claimReview";
  schemaVersion: number;
  id: string;
  claimId: string;
  appealId: string;
  round: number;
  kind: "INITIAL" | "APPEAL";
  assignedAuditorIds: string[];
  approvalThreshold: number;
  rejectionThreshold: number;
  approvals: number;
  rejections: number;
  votesCast: number;
  status: "OPEN" | "APPROVED" | "REJECTED" | "TIMED_OUT";
  deadline: LedgerTimestamp;
  openedAt: LedgerTimestamp;
  closedAt: LedgerTimestamp;
};

export type ClaimAppeal = {
  assetType: "claimAppeal";
  schemaVersion: number;
  id: string;
  claimId: string;
  claimantId: string;
  round: number;
  reasonHash: string;
  evidenceHash: string;
  reviewId: string;
  status: "SUBMITTED" | "UNDER_REVIEW" | "UPHELD" | "OVERTURNED";
  createdAt: LedgerTimestamp;
  resolvedAt: LedgerTimestamp;
};

export type FraudAssessment = {
  assetType: "fraudAssessment";
  schemaVersion: number;
  id: string;
  claimId: string;
  engineId: string;
  engineVersion: string;
  modelHash: string;
  inputHash: string;
  scoreBps: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  signals: string[];
  advisory: true;
  recordedBy: string;
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
