import "server-only";

import type { Contract } from "@hyperledger/fabric-gateway";
import { withFabricContract } from "./gateway";
import type { FabricRole } from "./config";
import type {
  AuditorDecision,
  BankAccountReference,
  BankMandate,
  BeneficiaryDesignation,
  BenefitPlan,
  BenefitRequest,
  Claim,
  ClaimHistoryRecord,
  EvidenceReference,
  EvidenceAccessRecord,
  HospitalVerification,
  Liability,
  Policy,
  PolicyPackage,
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

  readEvidenceReference(id: string) {
    return evaluate<EvidenceReference>("insurerAdmin", "ReadEvidenceReference", id);
  },

  listEvidenceReferences() {
    return evaluate<EvidenceReference[]>("insurerAdmin", "ListEvidenceReferences");
  },

  listEvidenceAccessRecords() {
    return evaluate<EvidenceAccessRecord[]>("insurerAdmin", "ListEvidenceAccessRecords");
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

  registerBankAccountReference(input: { id: string; ownerId: string; accountTokenHash: string }) {
    return submit<BankAccountReference>(
      "bankOfficer", "RegisterBankAccountReference", input.id, input.ownerId, input.accountTokenHash,
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

  recordPremiumPayment(input: {
    id: string; policyId: string; mandateId: string; periodStartDate: string;
    periodEndDate: string; amountMinor: number; externalReferenceHash: string; method: "OTP" | "AUTODEBIT";
  }) {
    return submit<PremiumPayment>(
      "bankOfficer", "RecordPremiumPayment", input.id, input.policyId, input.mandateId,
      input.periodStartDate, input.periodEndDate, input.amountMinor, input.externalReferenceHash, input.method,
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

  completePremiumCollection(collectionId: string, paymentId: string, periodEndDate: string, externalReferenceHash: string) {
    return submit<PremiumCollection>(
      "bankOfficer", "CompletePremiumCollection", collectionId, paymentId, periodEndDate, externalReferenceHash,
    );
  },

  failPremiumCollection(collectionId: string, failureHash: string) {
    return submit<PremiumCollection>("bankOfficer", "FailPremiumCollection", collectionId, failureHash);
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
    amountMinor: number;
    incidentDate: string;
    descriptionHash: string;
  }) {
    return submit<Claim>(
      "policyholder",
      "SubmitClaim",
      input.id,
      input.policyId,
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
  ) {
    return submit<EvidenceAccessRecord>(
      role,
      "RecordEvidenceAccess",
      input.id,
      input.evidenceId,
      input.purpose,
    );
  },

  verifyClaim(input: {
    claimId: string;
    verificationId: string;
    outcome: "VERIFIED" | "INVALID";
    clinicalReferenceHash: string;
  }) {
    return submit<HospitalVerification>(
      "hospitalOfficer",
      "VerifyClaim",
      input.claimId,
      input.verificationId,
      input.outcome,
      input.clinicalReferenceHash,
    );
  },

  startClaimReview(claimId: string) {
    return submit<Claim>("insurerAdmin", "StartClaimReview", claimId);
  },

  recordAuditorDecision(input: {
    claimId: string;
    decisionId: string;
    outcome: "APPROVE" | "REJECT";
    reasonHash: string;
  }) {
    return submit<AuditorDecision>(
      "auditor",
      "RecordAuditorDecision",
      input.claimId,
      input.decisionId,
      input.outcome,
      input.reasonHash,
    );
  },

  authorizeSettlement(settlementId: string, claimId: string) {
    return submit<Settlement>(
      "insurerAdmin",
      "AuthorizeSettlement",
      settlementId,
      claimId,
    );
  },

  confirmSettlement(settlementId: string, bankReferenceHash: string) {
    return submit<Settlement>(
      "bankOfficer",
      "ConfirmSettlement",
      settlementId,
      bankReferenceHash,
    );
  },
};
