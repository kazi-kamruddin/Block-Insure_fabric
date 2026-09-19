import "server-only";

import type { Contract } from "@hyperledger/fabric-gateway";
import { withFabricContract } from "./gateway";
import type { FabricRole } from "./config";
import type {
  AuditorDecision,
  BankAccountReference,
  BankMandate,
  BankTransfer,
  BeneficiaryDesignation,
  BenefitPlan,
  BenefitRequest,
  Claim,
  ClaimAppeal,
  ClaimReview,
  ClaimHistoryRecord,
  EvidenceReference,
  EvidenceMerkleBatch,
  EvidenceInclusionVerification,
  EvidenceAccessRecord,
  EvidenceAccessGrant,
  HospitalVerification,
  HospitalInvoice,
  FraudAssessment,
  Liability,
  OracleCommitment,
  OracleRegistrySnapshot,
  OracleRequest,
  OracleRequestHistoryRecord,
  OracleResult,
  Policy,
  PolicyPackage,
  PartnerAgreement,
  PremiumCollection,
  PremiumAdjustment,
  PremiumPayment,
  Settlement,
} from "./types";

const decoder = new TextDecoder();

function decodeJson<T>(payload: Uint8Array): T {
  return JSON.parse(decoder.decode(payload)) as T;
}

function stringifyArguments(arguments_: Array<string | number>): string[] {
  return arguments_.map(String);
}

async function evaluate<T>(role: FabricRole, transactionName: string, ...args: string[]) {
  return withFabricContract(role, async (contract) =>
    decodeJson<T>(await contract.evaluateTransaction(transactionName, ...args)),
  );
}

async function submit<T>(
  role: FabricRole,
  transactionName: string,
  ...args: Array<string | number>
) {
  return withFabricContract(role, async (contract) =>
    decodeJson<T>(
      await contract.submitTransaction(transactionName, ...stringifyArguments(args)),
    ),
  );
}

async function submitWithTransient<T>(
  role: FabricRole,
  transactionName: string,
  args: Array<string | number>,
  transientData: Record<string, string | Uint8Array>,
) {
  return withFabricContract(role, async (contract) => decodeJson<T>(
    await contract.submit(transactionName, { arguments: stringifyArguments(args), transientData }),
  ));
}

async function submitAsAuditor<T>(
  auditorUserName: string | undefined,
  transactionName: string,
  ...args: Array<string | number>
) {
  if (!auditorUserName) throw new Error("This auditor account has no server-owned Fabric identity");
  return withFabricContract(
    "auditor",
    async (contract) => decodeJson<T>(
      await contract.submitTransaction(transactionName, ...stringifyArguments(args)),
    ),
    auditorUserName,
  );
}

async function submitAsHospital<T>(
  hospitalUserName: string | undefined,
  transactionName: string,
  ...args: Array<string | number>
) {
  if (!hospitalUserName) throw new Error("This Hospital account has no server-owned Fabric identity");
  return withFabricContract(
    "hospitalOfficer",
    async (contract) => decodeJson<T>(
      await contract.submitTransaction(transactionName, ...stringifyArguments(args)),
    ),
    hospitalUserName,
  );
}

export const ledger = {
  async schemaVersion() {
    return withFabricContract("insurerAdmin", async (contract: Contract) => {
      const payload = await contract.evaluateTransaction("GetSchemaVersion");
      return Number(decoder.decode(payload));
    });
  },

  readPolicyPackage(id: string) {
    return evaluate<PolicyPackage>("insurerAdmin", "ReadPolicyPackage", id);
  },

  listPolicyPackages() {
    return evaluate<PolicyPackage[]>("insurerAdmin", "ListPolicyPackages");
  },

  readPartnerAgreement(id: string) {
    return evaluate<PartnerAgreement>("insurerAdmin", "ReadPartnerAgreement", id);
  },

  listPartnerAgreements() {
    return evaluate<PartnerAgreement[]>("insurerAdmin", "ListPartnerAgreements");
  },

  readHospitalInvoice(id: string) {
    return evaluate<HospitalInvoice>("insurerAdmin", "ReadHospitalInvoice", id);
  },

  listHospitalInvoices() {
    return evaluate<HospitalInvoice[]>("insurerAdmin", "ListHospitalInvoices");
  },

  readPolicy(id: string) {
    return evaluate<Policy>("insurerAdmin", "ReadPolicy", id);
  },

  listPolicies() {
    return evaluate<Policy[]>("insurerAdmin", "ListPolicies");
  },

  readBankAccountReference(id: string) {
    return evaluate<BankAccountReference>("bankOfficer", "ReadBankAccountReference", id);
  },

  listBankAccountReferences() {
    return evaluate<BankAccountReference[]>("bankOfficer", "ListBankAccountReferences");
  },

  readBankTransfer(id: string) {
    return evaluate<BankTransfer>("bankOfficer", "ReadBankTransfer", id);
  },

  listBankTransfers() {
    return evaluate<BankTransfer[]>("bankOfficer", "ListBankTransfers");
  },

  readBankMandate(id: string) {
    return evaluate<BankMandate>("insurerAdmin", "ReadBankMandate", id);
  },

  listBankMandates() {
    return evaluate<BankMandate[]>("insurerAdmin", "ListBankMandates");
  },

  readPremiumPayment(id: string) {
    return evaluate<PremiumPayment>("insurerAdmin", "ReadPremiumPayment", id);
  },

  listPremiumPayments() {
    return evaluate<PremiumPayment[]>("insurerAdmin", "ListPremiumPayments");
  },

  readPremiumAdjustment(id: string) {
    return evaluate<PremiumAdjustment>("insurerAdmin", "ReadPremiumAdjustment", id);
  },

  listPremiumAdjustments() {
    return evaluate<PremiumAdjustment[]>("insurerAdmin", "ListPremiumAdjustments");
  },

  readPremiumCollection(id: string) {
    return evaluate<PremiumCollection>("insurerAdmin", "ReadPremiumCollection", id);
  },

  listPremiumCollections() {
    return evaluate<PremiumCollection[]>("insurerAdmin", "ListPremiumCollections");
  },

  readBenefitPlan(id: string) {
    return evaluate<BenefitPlan>("insurerAdmin", "ReadBenefitPlan", id);
  },

  listBenefitPlans() {
    return evaluate<BenefitPlan[]>("insurerAdmin", "ListBenefitPlans");
  },

  readBeneficiaryDesignation(policyId: string) {
    return evaluate<BeneficiaryDesignation>("insurerAdmin", "ReadBeneficiaryDesignation", policyId);
  },

  listBeneficiaryDesignations() {
    return evaluate<BeneficiaryDesignation[]>("insurerAdmin", "ListBeneficiaryDesignations");
  },

  readBenefitRequest(id: string) {
    return evaluate<BenefitRequest>("insurerAdmin", "ReadBenefitRequest", id);
  },

  listBenefitRequests() {
    return evaluate<BenefitRequest[]>("insurerAdmin", "ListBenefitRequests");
  },

  readLiability(id: string) {
    return evaluate<Liability>("insurerAdmin", "ReadLiability", id);
  },

  listLiabilities() {
    return evaluate<Liability[]>("insurerAdmin", "ListLiabilities");
  },

  readClaim(id: string) {
    return evaluate<Claim>("insurerAdmin", "ReadClaim", id);
  },

  listClaims() {
    return evaluate<Claim[]>("insurerAdmin", "ListClaims");
  },

  readOracleRegistrySnapshot(id: string) {
    return evaluate<OracleRegistrySnapshot>("insurerAdmin", "ReadOracleRegistrySnapshot", id);
  },

  listOracleRegistrySnapshots() {
    return evaluate<OracleRegistrySnapshot[]>("insurerAdmin", "ListOracleRegistrySnapshots");
  },

  readOracleRequest(id: string) {
    return evaluate<OracleRequest>("insurerAdmin", "ReadOracleRequest", id);
  },

  listOracleRequests() {
    return evaluate<OracleRequest[]>("insurerAdmin", "ListOracleRequests");
  },

  readOracleCommitment(id: string) {
    return evaluate<OracleCommitment>("insurerAdmin", "ReadOracleCommitment", id);
  },

  listOracleCommitments() {
    return evaluate<OracleCommitment[]>("insurerAdmin", "ListOracleCommitments");
  },

  readOracleResult(id: string) {
    return evaluate<OracleResult>("insurerAdmin", "ReadOracleResult", id);
  },

  listOracleResults() {
    return evaluate<OracleResult[]>("insurerAdmin", "ListOracleResults");
  },

  oracleRequestHistory(id: string) {
    return evaluate<OracleRequestHistoryRecord[]>("insurerAdmin", "GetOracleRequestHistory", id);
  },

  readEvidenceReference(id: string) {
    return evaluate<EvidenceReference>("insurerAdmin", "ReadEvidenceReference", id);
  },

  listEvidenceReferences() {
    return evaluate<EvidenceReference[]>("insurerAdmin", "ListEvidenceReferences");
  },

  readEvidenceMerkleBatch(id: string) {
    return evaluate<EvidenceMerkleBatch>("insurerAdmin", "ReadEvidenceMerkleBatch", id);
  },

  listEvidenceMerkleBatches() {
    return evaluate<EvidenceMerkleBatch[]>("insurerAdmin", "ListEvidenceMerkleBatches");
  },

  verifyEvidenceInclusion(batchId: string, evidenceId: string, proofJson: string) {
    return evaluate<EvidenceInclusionVerification>("insurerAdmin", "VerifyEvidenceInclusion", batchId, evidenceId, proofJson);
  },

  listEvidenceAccessRecords() {
    return evaluate<EvidenceAccessRecord[]>("insurerAdmin", "ListEvidenceAccessRecords");
  },

  readEvidenceAccessGrant(id: string) {
    return evaluate<EvidenceAccessGrant>("insurerAdmin", "ReadEvidenceAccessGrant", id);
  },

  listEvidenceAccessGrants() {
    return evaluate<EvidenceAccessGrant[]>("insurerAdmin", "ListEvidenceAccessGrants");
  },

  readHospitalVerification(id: string) {
    return evaluate<HospitalVerification>("insurerAdmin", "ReadHospitalVerification", id);
  },

  listHospitalVerifications() {
    return evaluate<HospitalVerification[]>("insurerAdmin", "ListHospitalVerifications");
  },

  async readAuditorDecision(id: string) {
    const decisions = await evaluate<AuditorDecision[]>("insurerAdmin", "ListAuditorDecisions");
    const decision = decisions.find((item) => item.id === id);
    if (!decision) throw new Error(`auditor decision ${id} does not exist`);
    return decision;
  },

  listAuditorDecisions() {
    return evaluate<AuditorDecision[]>("insurerAdmin", "ListAuditorDecisions");
  },

  readClaimReview(id: string) {
    return evaluate<ClaimReview>("insurerAdmin", "ReadClaimReview", id);
  },

  listClaimReviews() {
    return evaluate<ClaimReview[]>("insurerAdmin", "ListClaimReviews");
  },

  readClaimAppeal(id: string) {
    return evaluate<ClaimAppeal>("insurerAdmin", "ReadClaimAppeal", id);
  },

  listClaimAppeals() {
    return evaluate<ClaimAppeal[]>("insurerAdmin", "ListClaimAppeals");
  },

  readFraudAssessment(id: string) {
    return evaluate<FraudAssessment>("insurerAdmin", "ReadFraudAssessment", id);
  },

  listFraudAssessments() {
    return evaluate<FraudAssessment[]>("insurerAdmin", "ListFraudAssessments");
  },

  readSettlement(id: string) {
    return evaluate<Settlement>("insurerAdmin", "ReadSettlement", id);
  },

  listSettlements() {
    return evaluate<Settlement[]>("insurerAdmin", "ListSettlements");
  },

  claimHistory(id: string) {
    return evaluate<ClaimHistoryRecord[]>("insurerAdmin", "GetClaimHistory", id);
  },

  createPolicyPackage(input: {
    id: string;
    name: string;
    description: string;
    premiumMinor: number;
    coverageLimitMinor: number;
    termsHash: string;
  }) {
    return submit<PolicyPackage>(
      "insurerAdmin",
      "CreatePolicyPackage",
      input.id,
      input.name,
      input.description,
      input.premiumMinor,
      input.coverageLimitMinor,
      input.termsHash,
    );
  },

  createPartnerAgreement(input: {
    id: string;
    partnerType: "HOSPITAL" | "BANK";
    partnerId: string;
    name: string;
    location: string;
    tier: string;
    accessScope: string;
    effectiveDate: string;
    expiryDate: string;
  }) {
    return submit<PartnerAgreement>(
      "insurerAdmin", "CreatePartnerAgreement", input.id, input.partnerType, input.partnerId,
      input.name, input.location, input.tier, input.accessScope, input.effectiveDate, input.expiryDate,
    );
  },

  setPartnerAgreementStatus(id: string, status: "ACTIVE" | "SUSPENDED" | "ENDED") {
    return submit<PartnerAgreement>("insurerAdmin", "SetPartnerAgreementStatus", id, status);
  },

  configurePolicyPackagePartners(id: string, hospitalIdsJson: string, bankIdsJson: string) {
    return submit<PolicyPackage>("insurerAdmin", "ConfigurePolicyPackagePartners", id, hospitalIdsJson, bankIdsJson);
  },

  createHospitalInvoice(input: {
    id: string;
    patientReferenceHash: string;
    invoiceReferenceHash: string;
    treatmentHash: string;
    amountMinor: number;
    admissionDate: string;
    dischargeDate: string;
    status: "DRAFT" | "FINALIZED";
  }, hospitalUserName?: string) {
    return submitAsHospital<HospitalInvoice>(
      hospitalUserName, "CreateHospitalInvoice", input.id, input.patientReferenceHash,
      input.invoiceReferenceHash, input.treatmentHash, input.amountMinor,
      input.admissionDate, input.dischargeDate, input.status,
    );
  },

  updateHospitalInvoice(input: {
    id: string;
    patientReferenceHash: string;
    invoiceReferenceHash: string;
    treatmentHash: string;
    amountMinor: number;
    admissionDate: string;
    dischargeDate: string;
    status: "DRAFT" | "FINALIZED" | "VOID";
  }, hospitalUserName?: string) {
    return submitAsHospital<HospitalInvoice>(
      hospitalUserName, "UpdateHospitalInvoice", input.id, input.patientReferenceHash,
      input.invoiceReferenceHash, input.treatmentHash, input.amountMinor,
      input.admissionDate, input.dischargeDate, input.status,
    );
  },

  publishPolicyPackage(id: string) {
    return submit<PolicyPackage>("insurerAdmin", "PublishPolicyPackage", id);
  },

  retirePolicyPackage(id: string) {
    return submit<PolicyPackage>("insurerAdmin", "RetirePolicyPackage", id);
  },

  issuePolicy(input: {
    id: string;
    packageId: string;
    policyholderId: string;
    startDate: string;
    endDate: string;
  }) {
    return submit<Policy>(
      "insurerAdmin",
      "IssuePolicy",
      input.id,
      input.packageId,
      input.policyholderId,
      input.startDate,
      input.endDate,
    );
  },

  acquirePolicy(input: { id: string; packageId: string; startDate: string; endDate: string }) {
    return submit<Policy>(
      "policyholder", "AcquirePolicy", input.id, input.packageId, input.startDate, input.endDate,
    );
  },

  advancePolicyLifecycle(id: string, asOfDate: string) {
    return submit<Policy>("insurerAdmin", "AdvancePolicyLifecycle", id, asOfDate);
  },

  cancelPolicy(id: string, reasonHash: string, role: "policyholder" | "insurerAdmin") {
    return submit<Policy>(role, "CancelPolicy", id, reasonHash);
  },

  renewPolicy(newId: string, existingId: string, newEndDate: string) {
    return submit<Policy>("policyholder", "RenewPolicy", newId, existingId, newEndDate);
  },

  openBankAccount(input: { id: string; bankId: string; ownerId: string; accountType: "CUSTOMER" | "INSURER"; accountLabel: string; maskedAccount: string; accountTokenHash: string; openingBalanceMinor: number }) {
    return submitWithTransient<BankAccountReference>(
      "bankOfficer", "OpenPrivateBankAccount",
      [input.id, input.bankId, input.ownerId, input.accountType, input.accountLabel, input.maskedAccount],
      { bankAccountPrivate: JSON.stringify({ accountTokenHash: input.accountTokenHash, openingBalanceMinor: input.openingBalanceMinor }) },
    );
  },

  publishEvidenceMerkleBatch(id: string, evidenceIdsJson: string, rootHash: string) {
    return submit<EvidenceMerkleBatch>("insurerAdmin", "PublishEvidenceMerkleBatch", id, evidenceIdsJson, rootHash);
  },

  adjustBankAccountBalance(input: { transferId: string; accountId: string; direction: "CREDIT" | "DEBIT"; amountMinor: number; externalReferenceHash: string }) {
    return submit<BankTransfer>(
      "bankOfficer", "AdjustBankAccountBalance", input.transferId, input.accountId,
      input.direction, input.amountMinor, input.externalReferenceHash,
    );
  },

  requestBankMandate(input: { id: string; policyId: string; accountReferenceId: string; expiryDate: string }) {
    return submit<BankMandate>(
      "policyholder", "RequestBankMandate", input.id, input.policyId, input.accountReferenceId, input.expiryDate,
    );
  },

  reviewBankMandate(id: string, outcome: "APPROVE" | "REJECT", decisionHash: string) {
    return submit<BankMandate>("bankOfficer", "ReviewBankMandate", id, outcome, decisionHash);
  },

  cancelBankMandate(id: string) {
    return submit<BankMandate>("policyholder", "CancelBankMandate", id);
  },

  expireBankMandate(id: string, asOfDate: string) {
    return submit<BankMandate>("bankOfficer", "ExpireBankMandate", id, asOfDate);
  },

  executeManualPremiumPayment(input: {
    transferId: string; paymentId: string; policyId: string; sourceAccountId: string; destinationAccountId: string;
    periodStartDate: string; periodEndDate: string; amountMinor: number; externalReferenceHash: string; authorizationHash: string;
  }) {
    return submit<BankTransfer>(
      "bankOfficer", "ExecuteManualPremiumPayment", input.transferId, input.paymentId, input.policyId,
      input.sourceAccountId, input.destinationAccountId, input.periodStartDate, input.periodEndDate,
      input.amountMinor, input.externalReferenceHash, input.authorizationHash,
    );
  },

  recordPremiumAdjustment(input: { id: string; paymentId: string; amountMinor: number; externalReferenceHash: string; reasonHash: string }) {
    return submit<PremiumAdjustment>(
      "bankOfficer", "RecordPremiumAdjustment", input.id, input.paymentId, input.amountMinor, input.externalReferenceHash, input.reasonHash,
    );
  },

  queuePremiumCollection(id: string, mandateId: string, dueDate: string) {
    return submit<PremiumCollection>("insurerAdmin", "QueuePremiumCollection", id, mandateId, dueDate);
  },

  schedulePremiumCollections(asOfDate: string) {
    return submit<PremiumCollection[]>("insurerAdmin", "SchedulePremiumCollections", asOfDate);
  },

  processPremiumCollection(input: { collectionId: string; paymentId: string; transferId: string; destinationAccountId: string; periodEndDate: string; externalReferenceHash: string }) {
    return submit<PremiumCollection>(
      "bankOfficer", "ProcessPremiumCollection", input.collectionId, input.paymentId, input.transferId,
      input.destinationAccountId, input.periodEndDate, input.externalReferenceHash,
    );
  },

  createBenefitPlan(input: {
    id: string; packageId: string; deathBenefitMinor: number;
    surrenderBenefitMinor: number; maturityBenefitMinor: number; rulesHash: string;
  }) {
    return submit<BenefitPlan>(
      "insurerAdmin", "CreateBenefitPlan", input.id, input.packageId, input.deathBenefitMinor,
      input.surrenderBenefitMinor, input.maturityBenefitMinor, input.rulesHash,
    );
  },

  publishBenefitPlan(id: string) {
    return submit<BenefitPlan>("insurerAdmin", "PublishBenefitPlan", id);
  },

  retireBenefitPlan(id: string) {
    return submit<BenefitPlan>("insurerAdmin", "RetireBenefitPlan", id);
  },

  setBeneficiaries(policyId: string, allocationsJson: string) {
    return submit<BeneficiaryDesignation>("policyholder", "SetBeneficiaries", policyId, allocationsJson);
  },

  submitBenefitRequest(input: { id: string; policyId: string; benefitType: "DEATH" | "SURRENDER" | "MATURITY"; eventDate: string; evidenceHash: string }) {
    return submit<BenefitRequest>(
      "policyholder", "SubmitBenefitRequest", input.id, input.policyId, input.benefitType, input.eventDate, input.evidenceHash,
    );
  },

  decideBenefitRequest(id: string, outcome: "APPROVE" | "REJECT", decisionHash: string) {
    return submit<BenefitRequest>("insurerAdmin", "DecideBenefitRequest", id, outcome, decisionHash);
  },

  markBenefitPaymentReady(id: string, fundingReferenceHash: string) {
    return submit<BenefitRequest>("insurerAdmin", "MarkBenefitPaymentReady", id, fundingReferenceHash);
  },

  confirmBenefitPayment(id: string, bankReferenceHash: string) {
    return submit<BenefitRequest>("bankOfficer", "ConfirmBenefitPayment", id, bankReferenceHash);
  },

  submitClaim(input: {
    id: string;
    policyId: string;
    hospitalId: string;
    hospitalInvoiceId: string;
    amountMinor: number;
    incidentDate: string;
    descriptionHash: string;
  }) {
    return submit<Claim>(
      "policyholder",
      "SubmitInvoiceClaim",
      input.id,
      input.policyId,
      input.hospitalId,
      input.hospitalInvoiceId,
      input.amountMinor,
      input.incidentDate,
      input.descriptionHash,
    );
  },

  addEvidenceReference(input: {
    claimId: string;
    evidenceId: string;
    documentType: string;
    contentHash: string;
    storageReferenceHash: string;
  }) {
    return submit<EvidenceReference>(
      "policyholder",
      "AddEvidenceReference",
      input.claimId,
      input.evidenceId,
      input.documentType,
      input.contentHash,
      input.storageReferenceHash,
    );
  },

  recordEvidenceAccess(
    role: FabricRole,
    input: { id: string; evidenceId: string; purpose: "DOWNLOAD" | "VERIFY" | "AUDIT" },
    auditorUserName?: string,
  ) {
    if (role === "auditor") {
      return submitAsAuditor<EvidenceAccessRecord>(auditorUserName, "RecordEvidenceAccess", input.id, input.evidenceId, input.purpose);
    }
    return submit<EvidenceAccessRecord>(
      role,
      "RecordEvidenceAccess",
      input.id,
      input.evidenceId,
      input.purpose,
    );
  },

  recordGrantedEvidenceAccess(
    role: FabricRole,
    input: { id: string; evidenceId: string; grantId: string; purpose: "DOWNLOAD" | "VERIFY" | "AUDIT" },
    auditorUserName?: string,
  ) {
    if (role === "auditor") {
      return submitAsAuditor<EvidenceAccessRecord>(auditorUserName, "RecordGrantedEvidenceAccess", input.id, input.evidenceId, input.grantId, input.purpose);
    }
    return submit<EvidenceAccessRecord>(role, "RecordGrantedEvidenceAccess", input.id, input.evidenceId, input.grantId, input.purpose);
  },

  grantEvidenceAccess(input: {
    id: string; evidenceId: string; granteeMsp: string; granteeRole: string;
    granteeSubject: string; purpose: string; expiresAt: string; maxAccesses: number;
  }) {
    return submit<EvidenceAccessGrant>(
      "policyholder", "GrantEvidenceAccess", input.id, input.evidenceId,
      input.granteeMsp, input.granteeRole, input.granteeSubject, input.purpose,
      input.expiresAt, input.maxAccesses,
    );
  },

  revokeEvidenceAccess(grantId: string) {
    return submit<EvidenceAccessGrant>("policyholder", "RevokeEvidenceAccess", grantId);
  },

  crossCheckClaimInvoice(claimId: string, verificationId: string) {
    return submit<HospitalVerification>("insurerAdmin", "CrossCheckClaimInvoice", claimId, verificationId);
  },

  publishOracleRegistrySnapshot(input: {
    id: string; version: number; rootHash: string; rulesVersion: string;
    rulesHash: string; recordCount: number;
  }) {
    return submit<OracleRegistrySnapshot>(
      "insurerAdmin", "PublishOracleRegistrySnapshot", input.id, input.version,
      input.rootHash, input.rulesVersion, input.rulesHash, input.recordCount,
    );
  },

  requestOracleVerification(input: {
    requestId: string; claimId: string; snapshotId: string; modelVersion: string;
    modelHash: string; assignedOracleIdsJson: string; commitDeadline: string; revealDeadline: string;
  }) {
    return submit<OracleRequest>(
      "insurerAdmin", "RequestOracleVerification", input.requestId, input.claimId,
      input.snapshotId, input.modelVersion, input.modelHash, input.assignedOracleIdsJson,
      input.commitDeadline, input.revealDeadline,
    );
  },

  finalizeOracleTimeout(requestId: string) {
    return submit<OracleRequest>("insurerAdmin", "FinalizeOracleTimeout", requestId);
  },

  routeOracleFailureToReview(input: {
    requestId: string; reviewId: string; assignedAuditorIdsJson: string;
    approvalThreshold: number; rejectionThreshold: number; deadline: string;
  }) {
    return submit<ClaimReview>(
      "insurerAdmin", "RouteOracleFailureToReview", input.requestId, input.reviewId,
      input.assignedAuditorIdsJson, input.approvalThreshold, input.rejectionThreshold, input.deadline,
    );
  },

  openClaimReview(input: {
    claimId: string; reviewId: string; assignedAuditorIdsJson: string;
    approvalThreshold: number; rejectionThreshold: number; deadline: string;
  }) {
    return submit<ClaimReview>(
      "insurerAdmin", "OpenClaimReview", input.claimId, input.reviewId,
      input.assignedAuditorIdsJson, input.approvalThreshold, input.rejectionThreshold, input.deadline,
    );
  },

  submitClaimAppeal(input: {
    appealId: string; claimId: string;
    reasonCategory: "DOCUMENT_ERROR" | "CLINICAL_CORRECTION" | "AMOUNT_CORRECTION" | "OTHER";
    reasonHash: string; descriptionHash: string; evidenceHash: string; proposedHospitalId: string;
    proposedAmountMinor: number; proposedIncidentDate: string;
    proposedDescriptionHash: string; proposedClinicalReferenceHash: string;
  }) {
    return submit<ClaimAppeal>(
      "policyholder", "SubmitClaimAppeal", input.appealId, input.claimId,
      input.reasonCategory, input.reasonHash, input.descriptionHash, input.evidenceHash,
      input.proposedHospitalId, input.proposedAmountMinor, input.proposedIncidentDate,
      input.proposedDescriptionHash, input.proposedClinicalReferenceHash,
    );
  },

  openAppealReview(input: {
    appealId: string; reviewId: string; assignedAuditorIdsJson: string;
    approvalThreshold: number; rejectionThreshold: number; deadline: string;
  }) {
    return submit<ClaimReview>(
      "insurerAdmin", "OpenAppealReview", input.appealId, input.reviewId,
      input.assignedAuditorIdsJson, input.approvalThreshold, input.rejectionThreshold, input.deadline,
    );
  },

  finalizeExpiredReview(reviewId: string) {
    return submit<ClaimReview>("insurerAdmin", "FinalizeExpiredReview", reviewId);
  },

  recordFraudAssessment(input: {
    id: string; claimId: string; engineId: string; engineVersion: string; modelHash: string;
    inputHash: string; scoreBps: number; riskLevel: "LOW" | "MEDIUM" | "HIGH"; signalsJson: string;
  }) {
    return submit<FraudAssessment>(
      "insurerAdmin", "RecordFraudAssessment", input.id, input.claimId, input.engineId,
      input.engineVersion, input.modelHash, input.inputHash, input.scoreBps, input.riskLevel, input.signalsJson,
    );
  },

  recordAuditorDecision(input: {
    reviewId: string;
    decisionId: string;
    outcome: "APPROVE" | "REJECT";
    reasonHash: string;
  }, auditorUserName?: string) {
    return submitAsAuditor<AuditorDecision>(
      auditorUserName,
      "RecordAuditorDecision",
      input.reviewId,
      input.decisionId,
      input.outcome,
      input.reasonHash,
    );
  },

  authorizeSettlement(settlementId: string, claimId: string, sourceAccountId: string, destinationAccountId: string) {
    return submit<Settlement>(
      "insurerAdmin",
      "AuthorizeSettlement",
      settlementId,
      claimId,
      sourceAccountId,
      destinationAccountId,
    );
  },

  confirmSettlement(settlementId: string, transferId: string, bankReferenceHash: string) {
    return submit<Settlement>(
      "bankOfficer",
      "ConfirmSettlement",
      settlementId,
      transferId,
      bankReferenceHash,
    );
  },
};
