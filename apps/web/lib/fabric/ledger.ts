import "server-only";

import { randomBytes } from "node:crypto";
import type { Contract } from "@hyperledger/fabric-gateway";
import { withFabricContract } from "./gateway";
import { submitJournaled } from "@/lib/workflows/operation-journal";
import type { FabricRole } from "./config";
import type { MedicalEpisode, MedicalPreparation, MedicalQuote, MedicalRules } from "./medical";
import type { MedicalClarification, MedicalEvidenceCheck, MedicalReviewCommand, MedicalReviewFacts } from "./medical-review";
import { openMedicalReviewNote, sealMedicalReviewNote } from "./medical-review-note";
import type {
  AuditorDecision,
  BankAccountReference,
  BankAccountLinkRequest,
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
  HospitalModelFacts,
  FraudAssessment,
  Liability,
  MedicalApprovalCertificate,
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
  PrivacyCredential,
  SelectiveDisclosurePresentation,
  Settlement,
} from "./types";

const decoder = new TextDecoder();

function decodeJson<T>(payload: Uint8Array): T {
  return JSON.parse(decoder.decode(payload)) as T;
}

function stringifyArguments(arguments_: Array<string | number>): string[] {
  return arguments_.map(String);
}

function requireWritableLedger() {
  if (process.env.FABRIC_DEMO_READ_ONLY === "true") throw new Error("Ledger submissions are disabled for this verification run");
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
  requireWritableLedger();
  return withFabricContract(role, async (contract, gateway, identity) =>
    decodeJson<T>(
      await submitJournaled(contract, gateway, identity, role, transactionName, stringifyArguments(args)),
    ),
  );
}

async function submitWithTransient<T>(
  role: FabricRole,
  transactionName: string,
  args: Array<string | number>,
  transientData: Record<string, string | Uint8Array>,
  profileUserName?: string,
) {
  requireWritableLedger();
  return withFabricContract(role, async (contract) => decodeJson<T>(
    await contract.submit(transactionName, { arguments: stringifyArguments(args), transientData }),
  ), profileUserName);
}

function randomSalts(names: readonly string[]) {
  return JSON.stringify(Object.fromEntries(names.map((name) => [name, randomBytes(32).toString("hex")])));
}

async function submitAsAuditor<T>(
  auditorUserName: string | undefined,
  transactionName: string,
  ...args: Array<string | number>
) {
  requireWritableLedger();
  if (!auditorUserName) throw new Error("This auditor account has no server-owned Fabric identity");
  return withFabricContract(
    "auditor",
    async (contract, gateway, identity) => decodeJson<T>(
      await submitJournaled(contract, gateway, identity, "auditor", transactionName, stringifyArguments(args), auditorUserName),
    ),
    auditorUserName,
  );
}

async function submitAsHospital<T>(
  hospitalUserName: string | undefined,
  transactionName: string,
  ...args: Array<string | number>
) {
  requireWritableLedger();
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
  activateMedicalApprovals() {
    return submitWithTransient("insurerAdmin", "ActivateMedicalApprovalCertificates", [], { duplicateIndexKey: randomBytes(32) });
  },
  proposeMedicalRegistrySnapshot(input: { id: string; hospitalId: string; version: number; rootHash: string; rulesVersion: string; rulesHash: string; recordCount: number }) {
    return submit<OracleRegistrySnapshot>("insurerAdmin", "ProposeMedicalRegistrySnapshot", input.id, input.hospitalId,
      input.version, input.rootHash, input.rulesVersion, input.rulesHash, input.recordCount);
  },
  attestMedicalRegistrySnapshot(userName: string | undefined, snapshotId: string, rootHash: string) {
    return submitAsHospital<OracleRegistrySnapshot>(userName, "AttestMedicalRegistrySnapshot", snapshotId, rootHash);
  },
  readMedicalReviewFacts(claimId: string) {
    return evaluate<MedicalReviewFacts>("insurerAdmin", "ReadMedicalReviewFacts", claimId);
  },
  async readMedicalClarification(role: "insurerAdmin" | "policyholder", id: string) {
    const note = await evaluate<MedicalClarification>(role, "ReadMedicalClarification", id);
    return { ...note, question: openMedicalReviewNote("question", id, note.question),
      answer: note.answer ? openMedicalReviewNote("answer", id, note.answer) : "" };
  },
  async readMedicalAppealExplanation(role: "insurerAdmin" | "policyholder", id: string) {
    const note = await evaluate<{ text: string; purged?: boolean }>(role, "ReadMedicalAppealExplanation", id);
    if (note.purged) return null;
    return openMedicalReviewNote("appeal", id, note.text);
  },
  listMedicalEvidenceChecks(reviewId: string) {
    return evaluate<MedicalEvidenceCheck[]>("insurerAdmin", "ListMedicalEvidenceChecks", reviewId);
  },
  quoteMedicalAppeal(claimId: string, revision: string) {
    return evaluate<MedicalQuote>("policyholder", "QuoteMedicalAppeal", claimId, revision);
  },
  medicalReviewAction(role: "insurerAdmin" | "policyholder" | "auditor", input: MedicalReviewCommand, userName?: string) {
    const write = (name: string, ...args: Array<string | number>) => role === "auditor" ? submitAsAuditor(userName, name, ...args) : submit(role, name, ...args);
    const message = (name: string, text: string, ...args: Array<string | number>) => submitWithTransient(role, name, args, { medicalMessage: text }, userName);
    switch (input.action) {
      case "prepare": return write("PrepareMedicalReview", input.claimId, input.reviewId, input.prepareBy);
      case "escalate": return write("EscalateStalledMedicalClaim", input.claimId);
      case "release": return write("ReleaseMedicalReservation", input.claimId);
      case "open": return write("OpenMedicalVoting", input.reviewId, input.deadline);
      case "recover": return write("RecoverMedicalReview", input.reviewId, input.newId, input.prepareBy);
      case "expire": return write("FinalizeExpiredReview", input.reviewId);
      case "oracleTimeout": return write("FinalizeOracleTimeout", input.requestId);
      case "recordReceiptSummary": return this.recordPrivateMedicalReceipt(input.claimId, input.summary);
      case "ask": return message("RequestMedicalClarification", sealMedicalReviewNote("question", input.id, input.message), input.reviewId, input.id, input.deadline);
      case "respond": return message("RespondMedicalClarification", input.response === "EXPIRED" ? "" : sealMedicalReviewNote("answer", input.id, input.message), input.id, input.response, input.evidenceHash);
      case "share": return write("ShareMedicalReviewEvidence", input.reviewId, input.expiresAt);
      case "confirm": return write("ConfirmMedicalEvidence", input.reviewId, input.evidenceId, input.accessId, input.contentHash);
      case "vote": return write("RecordMedicalAuditorDecision", input.reviewId, input.decisionId, input.outcome, input.reasonCode, input.reasonHash);
      case "appeal": return message("SubmitMedicalAppeal", sealMedicalReviewNote("appeal", input.id, input.message), input.id, input.claimId, input.decisionId, input.evidenceHash, input.revision, input.acceptedStatementHash);
      case "recordOCR": return write("RecordMedicalOCR", input.id, input.evidenceId, input.engineVersion, input.sourceHash,
        input.suggestionsHash, input.confirmedHash, String(input.lowConfidence), input.accessId);
    }
  },
  listMedicalEpisodes(role: "insurerAdmin" | "policyholder") {
    return evaluate<MedicalEpisode[]>(role, "ListMedicalEpisodes");
  },
  listMedicalOracleSources() {
    return evaluate<Array<{ invoice: HospitalInvoice; facts: HospitalModelFacts; benchmarkHash: string; complete: boolean }>>("insurerAdmin", "ListMedicalOracleSources");
  },
  quoteMedicalClaim(policyId: string, episodeId: string, revision: string) {
    return evaluate<MedicalQuote>("policyholder", "QuoteMedicalClaim", policyId, episodeId, revision);
  },
  quoteMedicalCorrection(claimId: string, revision: string) {
    return evaluate<MedicalQuote>("policyholder", "QuoteMedicalCorrection", claimId, revision);
  },
  prepareMedicalClaim(input: { id: string; policyId: string; episodeId: string; revision: number }) {
    return submit<MedicalPreparation>("policyholder", "PrepareMedicalClaim", input.id, input.policyId, input.episodeId, input.revision);
  },
  submitMedicalClaim(input: { id: string; policyId: string; episodeId: string; revision: number; statementHash: string }) {
    return submit<Claim>("policyholder", "SubmitMedicalClaim", input.id, input.policyId, input.episodeId, input.revision, input.statementHash);
  },
  acceptMedicalCorrection(input: { id: string; revision: number; statementHash: string }) {
    return submit<Claim>("policyholder", "AcceptMedicalCorrection", input.id, input.revision, input.statementHash);
  },
  verifyMedicalAssociation(input: { episodeId: string; revision: number; beneficiaryId: string; decisionBasisHash: string; verified: boolean }) {
    return submit("insurerAdmin", "VerifyMedicalAssociation", input.episodeId, input.revision, input.beneficiaryId, input.decisionBasisHash, String(input.verified));
  },
  registerMedicalOracleBenchmark(input: { hospitalId: string; service: string; minimum: number; maximum: number; licenseStatus: string; sourceHash: string }) {
    return submit("insurerAdmin", "RegisterMedicalOracleBenchmark", input.hospitalId, input.service, input.minimum, input.maximum, input.licenseStatus, input.sourceHash);
  },
  readMedicalRules(packageId: string) {
    return evaluate<MedicalRules>("insurerAdmin", "ReadMedicalRules", packageId);
  },
  saveMedicalEpisode(input: { episodeReferenceHash: string; expectedRevision: number; patientReferenceHash: string;
    service: string; serviceDate: string; admissionDate: string; dischargeDate: string; billMinor: number; invoiceDate: string; diagnosisCode: string }, userName?: string) {
    if (!userName) throw new Error("No Fabric Hospital identity for this account");
    const { episodeReferenceHash, expectedRevision, ...facts } = input;
    return submitWithTransient("hospitalOfficer", "SaveMedicalEpisode", [episodeReferenceHash, expectedRevision], { medicalEpisode: JSON.stringify(facts) }, userName);
  },
  configureMedicalRules(input: { packageId: string; service: string; sublimit: number; deductibleBps: number; deductibleCap: number;
    shareBps: number; waitingDays: number; filingDays: number; evidenceRequired: boolean }) {
    return submit("insurerAdmin", "ConfigureMedicalRules", input.packageId, input.service, input.sublimit, input.deductibleBps,
      input.deductibleCap, input.shareBps, input.waitingDays, input.filingDays, String(input.evidenceRequired));
  },
  acquireMedicalPolicy(input: { id: string; packageId: string; startDate: string; endDate: string; acceptedTermsHash: string }) {
    return submit<Policy>("policyholder", "AcquireMedicalPolicy", input.id, input.packageId, input.startDate, input.endDate, input.acceptedTermsHash);
  },
  readHospitalModelFacts(invoiceId: string) {
    return evaluate<HospitalModelFacts>("insurerAdmin", "ReadHospitalModelFacts", invoiceId);
  },
  recordHospitalModelFacts(facts: HospitalModelFacts, hospitalUserName?: string) {
    return submitWithTransient<HospitalModelFacts>("hospitalOfficer", "RecordHospitalModelFacts", [facts.invoiceId],
      { hospitalModelFacts: JSON.stringify(facts) }, hospitalUserName);
  },
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

  readBankAccountLink(id: string) {
    return evaluate<BankAccountLinkRequest>("insurerAdmin", "ReadBankAccountLink", id);
  },

  listBankAccountLinks() {
    return evaluate<BankAccountLinkRequest[]>("insurerAdmin", "ListBankAccountLinks");
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

  readMedicalApprovalCertificate(claimId: string, version: number) {
    return evaluate<MedicalApprovalCertificate>("insurerAdmin", "ReadMedicalApprovalCertificate", claimId, String(version));
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
    if (!hospitalUserName) throw new Error("This Hospital account has no Fabric identity");
    return submitWithTransient<HospitalInvoice>(
      "hospitalOfficer", "CreateHospitalInvoiceWithCredential", [input.id, input.patientReferenceHash,
      input.invoiceReferenceHash, input.treatmentHash, input.amountMinor,
      input.admissionDate, input.dischargeDate, input.status],
      { credentialSalts: randomSalts(["admissionDate", "amountMinor", "dischargeDate", "hospitalId", "invoiceId", "invoiceReferenceHash", "patientReferenceHash", "status", "treatmentHash"]) }, hospitalUserName,
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
    if (!hospitalUserName) throw new Error("This Hospital account has no Fabric identity");
    return submitWithTransient<HospitalInvoice>(
      "hospitalOfficer", "UpdateHospitalInvoiceWithCredential", [input.id, input.patientReferenceHash,
      input.invoiceReferenceHash, input.treatmentHash, input.amountMinor,
      input.admissionDate, input.dischargeDate, input.status],
      { credentialSalts: randomSalts(["admissionDate", "amountMinor", "dischargeDate", "hospitalId", "invoiceId", "invoiceReferenceHash", "patientReferenceHash", "status", "treatmentHash"]) }, hospitalUserName,
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

  reinstatePolicy(id: string, reasonHash: string) {
    return submit<Policy>("insurerAdmin", "ReinstatePolicy", id, reasonHash);
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

  requestBankAccountLink(input: { id: string; bankId: string; accountLabel: string; maskedAccount: string }) {
    return submit<BankAccountLinkRequest>("policyholder", "RequestBankAccountLink", input.id, input.bankId, input.accountLabel, input.maskedAccount);
  },

  reviewBankAccountLink(input: { id: string; outcome: "APPROVE" | "REJECT"; accountReferenceId: string; decisionHash: string; accountTokenHash: string; openingBalanceMinor: number }) {
    const args = [input.id, input.outcome, input.outcome === "APPROVE" ? input.accountReferenceId : "", input.decisionHash];
    // The account token and balance stay in transient data, as for OpenPrivateBankAccount.
    return input.outcome === "APPROVE"
      ? submitWithTransient<BankAccountLinkRequest>("bankOfficer", "ReviewBankAccountLink", args,
        { bankAccountPrivate: JSON.stringify({ accountTokenHash: input.accountTokenHash, openingBalanceMinor: input.openingBalanceMinor }) })
      : submit<BankAccountLinkRequest>("bankOfficer", "ReviewBankAccountLink", ...args);
  },

  cancelBankAccountLink(id: string) {
    return submit<BankAccountLinkRequest>("policyholder", "CancelBankAccountLink", id);
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

  retryPremiumCollection(collectionId: string) {
    return submit<PremiumCollection>("insurerAdmin", "RetryPremiumCollection", collectionId);
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
    expectedClaimVersion?: number;
  }) {
    return submit<EvidenceReference>(
      "policyholder",
      input.expectedClaimVersion === undefined ? "AddEvidenceReference" : "AddEvidenceReferenceForVersion",
      input.claimId,
      input.evidenceId,
      input.documentType,
      input.contentHash,
      input.storageReferenceHash,
      ...(input.expectedClaimVersion === undefined ? [] : [input.expectedClaimVersion]),
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

  issueInvoicePrivacyCredential(input: { id: string; invoiceId: string; expiresAt: string }, hospitalUserName?: string) {
    return submitWithTransient<PrivacyCredential>(
      "hospitalOfficer", "IssueInvoicePrivacyCredential", [input.id, input.invoiceId, input.expiresAt],
      { credentialSalts: randomSalts(["admissionDate", "amountMinor", "dischargeDate", "hospitalId", "invoiceId", "invoiceReferenceHash", "patientReferenceHash", "status", "treatmentHash"]) },
      hospitalUserName,
    );
  },

  issuePolicyPrivacyCredential(input: { id: string; policyId: string; expiresAt: string }) {
    return submitWithTransient<PrivacyCredential>(
      "insurerAdmin", "IssuePolicyPrivacyCredential", [input.id, input.policyId, input.expiresAt],
      { credentialSalts: randomSalts(["coverageLimitMinor", "endDate", "packageId", "policyId", "policyholderId", "premiumMinor", "startDate", "status", "termsHash"]) },
    );
  },

  revokeInvoicePrivacyCredential(id: string, hospitalUserName?: string) {
    return submitAsHospital<PrivacyCredential>(hospitalUserName, "RevokePrivacyCredential", id);
  },

  revokePolicyPrivacyCredential(id: string) {
    return submit<PrivacyCredential>("insurerAdmin", "RevokePrivacyCredential", id);
  },

  registerClaimPrivacyPresentation(input: { id: string; claimId: string; invoiceCredentialId: string; policyCredentialId: string; challenge: string; expiresAt: string }) {
    return submit<SelectiveDisclosurePresentation>(
      "policyholder", "RegisterClaimPrivacyPresentation", input.id, input.claimId,
      input.invoiceCredentialId, input.policyCredentialId, input.challenge, input.expiresAt,
    );
  },

  readPrivacyCredential(id: string) {
    return evaluate<PrivacyCredential>("insurerAdmin", "ReadPrivacyCredential", id);
  },

  listPrivacyCredentials() {
    return evaluate<PrivacyCredential[]>("insurerAdmin", "ListPrivacyCredentials");
  },

  readSelectiveDisclosurePresentation(id: string) {
    return evaluate<SelectiveDisclosurePresentation>("insurerAdmin", "ReadSelectiveDisclosurePresentation", id);
  },

  listSelectiveDisclosurePresentations() {
    return evaluate<SelectiveDisclosurePresentation[]>("insurerAdmin", "ListSelectiveDisclosurePresentations");
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
    modelHash: string; assignedOracleIdsJson: string; requiredConfirmations: number;
    commitDeadline: string; revealDeadline: string;
  }) {
    return submit<OracleRequest>(
      "insurerAdmin", "RequestOracleVerification", input.requestId, input.claimId,
      input.snapshotId, input.modelVersion, input.modelHash, input.assignedOracleIdsJson,
      input.requiredConfirmations, input.commitDeadline, input.revealDeadline,
    );
  },

  async supportsMedicalOracleV2() {
    if (process.env.FABRIC_CHANNEL_NAME !== "insurance-dev-lite-190") return false;
    try {
      return (await evaluate<{ protocolVersion: string }>("insurerAdmin", "ReadMedicalOracleProtocol")).protocolVersion === "v2";
    } catch {
      return false;
    }
  },

  requestOracleVerificationV2(requestId: string, claimId: string) {
    return submit<OracleRequest>("insurerAdmin", "RequestOracleVerificationV2", requestId, claimId);
  },

  readOracleGovernance<T>(name: "ListSourceIssuers" | "ListSourceFeeds" | "ListOracleRosters" | "ListMedicalModelReleases") {
    return evaluate<T>("insurerAdmin", name);
  },

  readSourceIssuer(id: string, version: string) {
    return evaluate<{ issuerId: string; hospitalId: string; kind: string }>("insurerAdmin", "ReadSourceIssuer", id, version);
  },

  writeOracleGovernance(role: "insurerAdmin" | "auditor" | "hospitalOfficer", name: string, args: string[], user?: string) {
    if (role === "auditor") return submitAsAuditor(user, name, ...args);
    if (role === "hospitalOfficer") return submitAsHospital(user, name, ...args);
    return submit(role, name, ...args);
  },

  recordPrivateMedicalReceipt(claimId: string, summary: unknown) {
    return submitWithTransient("policyholder", "RecordMedicalOCRSummary", [claimId], { medicalOCRSummary: JSON.stringify(summary) });
  },

  finalizeOracleTimeout(requestId: string, role: "insurerAdmin" | "policyholder" | "auditor" = "insurerAdmin", user?: string) {
    return role === "auditor"
      ? submitAsAuditor<OracleRequest>(user, "FinalizeOracleTimeout", requestId)
      : submit<OracleRequest>(role, "FinalizeOracleTimeout", requestId);
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
