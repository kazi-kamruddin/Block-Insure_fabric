import type { FabricRole } from "@/lib/fabric/config";
import {
  workflowCommandSchema,
  type WorkflowCommand,
  type WorkflowOperation,
} from "./commands";

export type WorkflowFormField = {
  name: string;
  label: string;
  kind?: "text" | "date" | "money" | "textarea" | "select";
  placeholder?: string;
  help?: string;
  options?: readonly string[];
};

export type WorkflowFormDefinition = {
  label: string;
  description: string;
  fields: readonly WorkflowFormField[];
};

export type WorkflowFormValues = Record<string, string>;
export type HashText = (value: string) => Promise<string>;

export const operationsByRole = {
  insurerAdmin: ["createPolicyPackage", "publishPolicyPackage", "retirePolicyPackage", "createBenefitPlan", "publishBenefitPlan", "retireBenefitPlan", "issuePolicy", "advancePolicyLifecycle", "cancelPolicyAsInsurer", "queuePremiumCollection", "decideBenefitRequest", "markBenefitPaymentReady", "assessClaimFraud", "publishOracleRegistrySnapshot", "requestOracleVerification", "finalizeOracleTimeout", "routeOracleFailureToReview", "openClaimReview", "finalizeExpiredReview", "authorizeSettlement"],
  policyholder: ["acquirePolicy", "requestBankMandate", "cancelBankMandate", "setBeneficiaries", "submitBenefitRequest", "renewPolicy", "cancelPolicy", "submitClaim", "submitClaimAppeal", "grantEvidenceAccess", "revokeEvidenceAccess"],
  hospitalOfficer: ["verifyClaim"],
  auditor: ["recordAuditorDecision"],
  bankOfficer: ["registerBankAccountReference", "reviewBankMandate", "recordPremiumPayment", "recordPremiumAdjustment", "completePremiumCollection", "failPremiumCollection", "expireBankMandate", "confirmBenefitPayment", "confirmSettlement"],
} as const satisfies Record<FabricRole, readonly WorkflowOperation[]>;

export const workflowFormDefinitions: Record<WorkflowOperation, WorkflowFormDefinition> = {
  createPolicyPackage: {
    label: "Create policy package",
    description: "Define a draft insurance product. Financial values are entered in BDT and converted to integer poisha before submission.",
    fields: [
      { name: "id", label: "Package ID", placeholder: "package-essential" },
      { name: "name", label: "Package name", placeholder: "Essential Health" },
      { name: "description", label: "Public description", kind: "textarea", placeholder: "Coverage summary visible to channel members" },
      { name: "premiumBdt", label: "Premium (BDT)", kind: "money", placeholder: "100.00" },
      { name: "coverageLimitBdt", label: "Coverage limit (BDT)", kind: "money", placeholder: "10000.00" },
      { name: "termsText", label: "Terms reference", kind: "textarea", placeholder: "Document identifier, version, or terms summary", help: "Hashed in this browser; only the SHA-256 digest is sent." },
    ],
  },
  publishPolicyPackage: {
    label: "Publish policy package",
    description: "Make an existing draft package available for policy issuance.",
    fields: [{ name: "id", label: "Package ID", placeholder: "package-essential" }],
  },
  retirePolicyPackage: {
    label: "Retire policy package",
    description: "Stop future issuance from a published package without altering policies already issued from it.",
    fields: [{ name: "id", label: "Package ID", placeholder: "package-essential" }],
  },
  createBenefitPlan: {
    label: "Create benefit plan",
    description: "Attach versioned death, surrender, and maturity amounts to a policy package.",
    fields: [
      { name: "id", label: "Benefit plan ID", placeholder: "benefit-plan-essential" },
      { name: "packageId", label: "Package ID", placeholder: "package-essential" },
      { name: "deathBenefitBdt", label: "Death benefit (BDT)", kind: "money" },
      { name: "surrenderBenefitBdt", label: "Surrender benefit (BDT)", kind: "money" },
      { name: "maturityBenefitBdt", label: "Maturity benefit (BDT)", kind: "money" },
      { name: "rulesText", label: "Benefit rules reference", kind: "textarea", help: "Hashed locally; the rules document is not placed on-chain." },
    ],
  },
  publishBenefitPlan: {
    label: "Publish benefit plan",
    description: "Freeze a draft benefit configuration for new requests.",
    fields: [{ name: "id", label: "Benefit plan ID", placeholder: "benefit-plan-essential" }],
  },
  retireBenefitPlan: {
    label: "Retire benefit plan",
    description: "Retire the current package rules before publishing a new version; existing policies keep their snapshot.",
    fields: [{ name: "id", label: "Benefit plan ID", placeholder: "benefit-plan-essential" }],
  },
  issuePolicy: {
    label: "Issue policy",
    description: "Issue a published package to a known policyholder identity.",
    fields: [
      { name: "id", label: "Policy ID", placeholder: "policy-1001" },
      { name: "packageId", label: "Package ID", placeholder: "package-essential" },
      { name: "policyholderId", label: "Policyholder subject ID", placeholder: "policyholder1" },
      { name: "startDate", label: "Coverage starts", kind: "date" },
      { name: "endDate", label: "Coverage ends", kind: "date" },
    ],
  },
  acquirePolicy: {
    label: "Acquire policy",
    description: "Accept the published package snapshot and create coverage pending its first premium.",
    fields: [
      { name: "id", label: "Policy ID", placeholder: "policy-1001" },
      { name: "packageId", label: "Published package ID", placeholder: "package-essential" },
      { name: "startDate", label: "Coverage starts", kind: "date" },
      { name: "endDate", label: "Coverage ends", kind: "date" },
    ],
  },
  advancePolicyLifecycle: {
    label: "Advance policy lifecycle",
    description: "Apply a due-date transition to grace, lapse, or expiry using an explicit business date.",
    fields: [{ name: "id", label: "Policy ID" }, { name: "asOfDate", label: "Business date", kind: "date" }],
  },
  cancelPolicy: {
    label: "Cancel my policy",
    description: "Cancel owned coverage and retain only a hash of the private reason.",
    fields: [{ name: "id", label: "Policy ID" }, { name: "reasonText", label: "Cancellation reason reference", kind: "textarea" }],
  },
  cancelPolicyAsInsurer: {
    label: "Cancel policy as insurer",
    description: "Apply a governed insurer cancellation and hash the supporting reason.",
    fields: [{ name: "id", label: "Policy ID" }, { name: "reasonText", label: "Cancellation reason reference", kind: "textarea" }],
  },
  renewPolicy: {
    label: "Renew policy",
    description: "Create a renewal from the latest published package terms; payment is still required.",
    fields: [{ name: "newId", label: "New policy ID" }, { name: "existingId", label: "Existing policy ID" }, { name: "newEndDate", label: "New coverage end", kind: "date" }],
  },
  registerBankAccountReference: {
    label: "Register bank account token",
    description: "Register a verified, irreversible account token. Never enter an account number here.",
    fields: [{ name: "id", label: "Account reference ID" }, { name: "ownerId", label: "Policyholder subject ID" }, { name: "accountTokenText", label: "Bank-vault token", help: "Hashed locally before Fabric submission." }],
  },
  requestBankMandate: {
    label: "Request debit mandate",
    description: "Ask BankMSP to approve recurring premium collection from a verified account token.",
    fields: [{ name: "id", label: "Mandate ID" }, { name: "policyId", label: "Policy ID" }, { name: "accountReferenceId", label: "Account reference ID" }, { name: "expiryDate", label: "Mandate expiry", kind: "date" }],
  },
  reviewBankMandate: {
    label: "Review debit mandate",
    description: "Approve or reject a pending mandate using a hashed bank decision reference.",
    fields: [{ name: "id", label: "Mandate ID" }, { name: "outcome", label: "Outcome", kind: "select", options: ["APPROVE", "REJECT"] }, { name: "decisionText", label: "Decision reference" }],
  },
  cancelBankMandate: {
    label: "Cancel debit mandate",
    description: "Stop future collections from an owned pending or active mandate.",
    fields: [{ name: "id", label: "Mandate ID" }],
  },
  expireBankMandate: {
    label: "Expire debit mandate",
    description: "Close an active mandate after its recorded expiry date.",
    fields: [{ name: "id", label: "Mandate ID" }, { name: "asOfDate", label: "Business date", kind: "date" }],
  },
  recordPremiumPayment: {
    label: "Record premium receipt",
    description: "Anchor a bank-confirmed external receipt and activate or reinstate eligible coverage.",
    fields: [{ name: "id", label: "Payment ID" }, { name: "policyId", label: "Policy ID" }, { name: "mandateId", label: "Mandate ID" }, { name: "periodStartDate", label: "Period starts", kind: "date" }, { name: "periodEndDate", label: "Period ends", kind: "date" }, { name: "amountBdt", label: "Premium (BDT)", kind: "money" }, { name: "externalReferenceText", label: "External receipt reference", help: "Hashed locally for replay protection." }, { name: "method", label: "Collection method", kind: "select", options: ["OTP", "AUTODEBIT"] }],
  },
  recordPremiumAdjustment: {
    label: "Record premium reversal",
    description: "Append a compensating external reversal without deleting or rewriting the original receipt.",
    fields: [{ name: "id", label: "Adjustment ID" }, { name: "paymentId", label: "Original payment ID" }, { name: "amountBdt", label: "Reversed amount (BDT)", kind: "money" }, { name: "externalReferenceText", label: "External reversal reference" }, { name: "reasonText", label: "Reversal reason reference" }],
  },
  queuePremiumCollection: {
    label: "Queue scheduled collection",
    description: "Create a durable on-ledger work item for a due active mandate.",
    fields: [{ name: "id", label: "Collection ID" }, { name: "mandateId", label: "Mandate ID" }, { name: "dueDate", label: "Due date", kind: "date" }],
  },
  completePremiumCollection: {
    label: "Complete scheduled collection",
    description: "Reconcile a due collection to its external bank receipt.",
    fields: [{ name: "collectionId", label: "Collection ID" }, { name: "paymentId", label: "Payment ID" }, { name: "periodEndDate", label: "Period ends", kind: "date" }, { name: "externalReferenceText", label: "External receipt reference" }],
  },
  failPremiumCollection: {
    label: "Record collection failure",
    description: "Increment the durable retry counter without exposing the bank's raw failure detail.",
    fields: [{ name: "collectionId", label: "Collection ID" }, { name: "failureText", label: "Failure reference" }],
  },
  setBeneficiaries: {
    label: "Set beneficiaries",
    description: "Replace the owned policy's designation. Shares are basis points and must total 10000.",
    fields: [{ name: "policyId", label: "Policy ID" }, { name: "allocationsJson", label: "Allocations JSON", kind: "textarea", placeholder: '[{"beneficiaryId":"person-1","shareBps":10000}]' }],
  },
  submitBenefitRequest: {
    label: "Request policy benefit",
    description: "Request a configured death, surrender, or maturity benefit and snapshot beneficiary allocations.",
    fields: [{ name: "id", label: "Benefit request ID" }, { name: "policyId", label: "Policy ID" }, { name: "benefitType", label: "Benefit", kind: "select", options: ["DEATH", "SURRENDER", "MATURITY"] }, { name: "eventDate", label: "Covered event date", kind: "date" }, { name: "evidenceText", label: "Evidence reference", kind: "textarea" }],
  },
  decideBenefitRequest: {
    label: "Decide benefit request",
    description: "Approve into funding-required state or reject with a hashed decision reference.",
    fields: [{ name: "id", label: "Benefit request ID" }, { name: "outcome", label: "Outcome", kind: "select", options: ["APPROVE", "REJECT"] }, { name: "decisionText", label: "Decision reference" }],
  },
  markBenefitPaymentReady: {
    label: "Mark benefit funded",
    description: "Record the external funding authorization that makes an approved benefit payable.",
    fields: [{ name: "id", label: "Benefit request ID" }, { name: "fundingReferenceText", label: "Funding reference" }],
  },
  confirmBenefitPayment: {
    label: "Confirm benefit payout",
    description: "Close the benefit liability against a hashed external transfer reference.",
    fields: [{ name: "id", label: "Benefit request ID" }, { name: "bankReferenceText", label: "Bank transfer reference" }],
  },
  submitClaim: {
    label: "Submit claim",
    description: "Open a claim against one of your active policies.",
    fields: [
      { name: "id", label: "Claim ID", placeholder: "claim-1001" },
      { name: "policyId", label: "Policy ID", placeholder: "policy-1001" },
      { name: "hospitalId", label: "Assigned hospital", kind: "select", options: ["hospital-demo", "hospital-2", "hospital-3", "hospital-4", "hospital-5"], help: "Only the matching certificate-bound Hospital identity can attest this claim." },
      { name: "amountBdt", label: "Claim amount (BDT)", kind: "money", placeholder: "2500.00" },
      { name: "incidentDate", label: "Incident date", kind: "date" },
      { name: "descriptionText", label: "Claim description reference", kind: "textarea", placeholder: "Private case reference or concise incident summary", help: "Hashed in this browser; only the SHA-256 digest is sent." },
    ],
  },
  verifyClaim: {
    label: "Verify claim",
    description: "Record the hospital's clinical attestation for a submitted claim.",
    fields: [
      { name: "claimId", label: "Claim ID", placeholder: "claim-1001" },
      { name: "verificationId", label: "Verification ID", placeholder: "verification-1001" },
      { name: "outcome", label: "Clinical outcome", kind: "select", options: ["VERIFIED", "INVALID"] },
      { name: "clinicalReferenceText", label: "Clinical reference", kind: "textarea", placeholder: "Hospital record identifier or attestation summary", help: "Hashed locally; no clinical document text is written to Fabric." },
    ],
  },
  assessClaimFraud: {
    label: "Generate fraud triage assessment",
    description: "Run the transparent server-side rules engine and anchor its advisory result without changing claim status.",
    fields: [{ name: "assessmentId", label: "Assessment ID", placeholder: "fraud-1001" }, { name: "claimId", label: "Claim ID", placeholder: "claim-1001" }],
  },
  openClaimReview: {
    label: "Open distributed review",
    description: "Snapshot assigned auditor subjects and quorum rules for a hospital-verified claim.",
    fields: [
      { name: "claimId", label: "Claim ID", placeholder: "claim-1001" },
      { name: "reviewId", label: "Review ID", placeholder: "review-1001" },
      { name: "assignedAuditorIdsJson", label: "Assigned auditor IDs", kind: "textarea", help: "Immutable JSON array of Fabric certificate subject IDs." },
      { name: "approvalThreshold", label: "Approval threshold" },
      { name: "rejectionThreshold", label: "Rejection threshold" },
      { name: "deadline", label: "Review deadline (RFC3339)", placeholder: "2026-09-09T12:00:00Z" },
    ],
  },
  publishOracleRegistrySnapshot: {
    label: "Publish Oracle registry snapshot",
    description: "Anchor the versioned registry root independently loaded by both Oracle services.",
    fields: [
      { name: "id", label: "Snapshot ID", placeholder: "registry-demo-v1" },
      { name: "version", label: "Snapshot version", placeholder: "1" },
      { name: "rootHash", label: "Canonical registry root", help: "Must equal the independently computed worker snapshot root." },
      { name: "rulesVersion", label: "Rules version", placeholder: "rules-v1" },
      { name: "rulesHash", label: "Rules commitment" },
      { name: "recordCount", label: "Registry record count", placeholder: "3" },
    ],
  },
  requestOracleVerification: {
    label: "Request two-Oracle verification",
    description: "Snapshot the claim, registry, model, two certificate subjects, and commit/reveal deadlines.",
    fields: [
      { name: "requestId", label: "Oracle request ID", placeholder: "oracle-request-1001" },
      { name: "claimId", label: "Hospital-verified claim ID", placeholder: "claim-1001" },
      { name: "snapshotId", label: "Registry snapshot ID", placeholder: "registry-demo-v1" },
      { name: "modelVersion", label: "Model version", placeholder: "model-v1" },
      { name: "modelHash", label: "Model commitment" },
      { name: "assignedOracleIdsJson", label: "Assigned Oracle certificate subjects", kind: "textarea", placeholder: '["oracle1","oracle2"]' },
      { name: "commitDeadline", label: "Commit deadline (RFC3339)" },
      { name: "revealDeadline", label: "Reveal deadline (RFC3339)" },
    ],
  },
  finalizeOracleTimeout: {
    label: "Finalize Oracle timeout",
    description: "After the reveal deadline, close an incomplete request and make governed auditor fallback available.",
    fields: [{ name: "requestId", label: "Oracle request ID" }],
  },
  routeOracleFailureToReview: {
    label: "Route Oracle failure to auditors",
    description: "Open the existing fixed-quorum four-auditor review after negative, conflicting, or timed-out Oracle verification.",
    fields: [
      { name: "requestId", label: "Failed Oracle request ID" },
      { name: "reviewId", label: "Review ID" },
      { name: "assignedAuditorIdsJson", label: "Assigned auditor IDs", kind: "textarea" },
      { name: "approvalThreshold", label: "Approval threshold" },
      { name: "rejectionThreshold", label: "Rejection threshold" },
      { name: "deadline", label: "Review deadline (RFC3339)" },
    ],
  },
  submitClaimAppeal: {
    label: "Appeal rejected claim",
    description: "Commit corrected facts for the single appeal. A fresh Hospital attestation is required before a new Oracle cycle.",
    fields: [
      { name: "appealId", label: "Appeal ID", placeholder: "appeal-1001" },
      { name: "claimId", label: "Claim ID", placeholder: "claim-1001" },
      { name: "reasonCategory", label: "Appeal category", kind: "select", options: ["DOCUMENT_ERROR", "CLINICAL_CORRECTION", "AMOUNT_CORRECTION", "OTHER"] },
      { name: "reasonText", label: "Appeal reason", kind: "textarea", help: "Hashed locally before submission." },
      { name: "descriptionText", label: "Appeal description", kind: "textarea", help: "A separate hash binds the complete explanation." },
      { name: "evidenceText", label: "Optional appeal evidence reference", kind: "textarea", help: "If supplied, only its hash is committed." },
      { name: "proposedHospitalId", label: "Corrected hospital (blank keeps current)", kind: "select", options: ["", "hospital-demo", "hospital-2", "hospital-3", "hospital-4", "hospital-5"], help: "Changing this transfers the fresh attestation to that certificate-bound hospital identity." },
      { name: "proposedAmountMinor", label: "Corrected amount (minor BDT; 0 keeps current)", placeholder: "0" },
      { name: "proposedIncidentDate", label: "Corrected incident date (blank keeps current)", placeholder: "2026-06-15" },
      { name: "proposedDescriptionText", label: "Corrected treatment description (blank keeps current)", kind: "textarea" },
      { name: "proposedClinicalReferenceHash", label: "Correct registry lookup hash", placeholder: "64 hexadecimal characters", help: "The fresh Hospital attestation must use this exact registry reference." },
    ],
  },
  grantEvidenceAccess: {
    label: "Share encrypted evidence",
    description: "Create a revocable, expiring, use-limited grant scoped to one Fabric organization, role, identity, and purpose.",
    fields: [
      { name: "id", label: "Grant ID", placeholder: "grant-1001" },
      { name: "evidenceId", label: "Evidence ID", placeholder: "evidence-1001" },
      { name: "granteeMsp", label: "Grantee organization", kind: "select", options: ["HospitalMSP", "AuditorMSP", "InsurerMSP"] },
      { name: "granteeRole", label: "Grantee role", kind: "select", options: ["hospitalOfficer", "auditor", "insurerAdmin"] },
      { name: "granteeSubject", label: "Grantee certificate subject", placeholder: "auditor1", help: "Use * only when every identity in the selected organization role should qualify." },
      { name: "purpose", label: "Permitted purpose", kind: "select", options: ["VERIFY", "AUDIT", "DOWNLOAD"] },
      { name: "expiresAt", label: "Expiry (RFC3339)", placeholder: "2026-09-09T12:00:00Z" },
      { name: "maxAccesses", label: "Maximum retrievals", placeholder: "3" },
    ],
  },
  revokeEvidenceAccess: {
    label: "Revoke evidence grant",
    description: "Immediately prevent any unused access allowed by an owned grant while preserving its ledger history.",
    fields: [{ name: "grantId", label: "Grant ID", placeholder: "grant-1001" }],
  },
  openAppealReview: {
    label: "Open appeal review",
    description: "Create a new immutable review round for a submitted appeal.",
    fields: [
      { name: "appealId", label: "Appeal ID", placeholder: "appeal-1001" },
      { name: "reviewId", label: "Review ID", placeholder: "review-appeal-1001" },
      { name: "assignedAuditorIdsJson", label: "Assigned auditor IDs", kind: "textarea" },
      { name: "approvalThreshold", label: "Approval threshold" },
      { name: "rejectionThreshold", label: "Rejection threshold" },
      { name: "deadline", label: "Review deadline (RFC3339)" },
    ],
  },
  finalizeExpiredReview: {
    label: "Finalize expired review",
    description: "Close an open review after its deadline; timeout rejects the claim and upholds an appeal.",
    fields: [{ name: "reviewId", label: "Review ID" }],
  },
  recordAuditorDecision: {
    label: "Record auditor decision",
    description: "Commit one independent approve or reject decision for a claim under review.",
    fields: [
      { name: "reviewId", label: "Review ID", placeholder: "review-1001" },
      { name: "decisionId", label: "Decision ID", placeholder: "decision-1001" },
      { name: "outcome", label: "Audit outcome", kind: "select", options: ["APPROVE", "REJECT"] },
      { name: "reasonText", label: "Decision reason reference", kind: "textarea", placeholder: "Audit file identifier or concise rationale", help: "Hashed locally before submission." },
    ],
  },
  authorizeSettlement: {
    label: "Authorize settlement",
    description: "Create the settlement instruction for an approved claim.",
    fields: [
      { name: "settlementId", label: "Settlement ID", placeholder: "settlement-1001" },
      { name: "claimId", label: "Claim ID", placeholder: "claim-1001" },
    ],
  },
  confirmSettlement: {
    label: "Confirm settlement",
    description: "Confirm that the authorized payment completed outside Fabric.",
    fields: [
      { name: "settlementId", label: "Settlement ID", placeholder: "settlement-1001" },
      { name: "bankReferenceText", label: "Bank transfer reference", placeholder: "EFT or transaction reference", help: "Hashed locally; the external bank reference is not exposed on-chain." },
    ],
  },
};

function dateOffset(years: number) {
  const value = new Date();
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
}

function generatedId(prefix: string, idFactory: () => string) {
  return `${prefix}-${idFactory().replaceAll("-", "").slice(0, 12)}`;
}

function deadlineOffset(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function createWorkflowFormValues(
  operation: WorkflowOperation,
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
): WorkflowFormValues {
  const today = dateOffset(0);
  const defaults: Record<WorkflowOperation, WorkflowFormValues> = {
    createPolicyPackage: { id: generatedId("package", idFactory), name: "", description: "", premiumBdt: "", coverageLimitBdt: "", termsText: "" },
    publishPolicyPackage: { id: "" },
    retirePolicyPackage: { id: "" },
    createBenefitPlan: { id: generatedId("benefit-plan", idFactory), packageId: "", deathBenefitBdt: "", surrenderBenefitBdt: "", maturityBenefitBdt: "", rulesText: "" },
    publishBenefitPlan: { id: "" },
    retireBenefitPlan: { id: "" },
    issuePolicy: { id: generatedId("policy", idFactory), packageId: "", policyholderId: "policyholder1", startDate: today, endDate: dateOffset(1) },
    acquirePolicy: { id: generatedId("policy", idFactory), packageId: "", startDate: today, endDate: dateOffset(1) },
    advancePolicyLifecycle: { id: "", asOfDate: today },
    cancelPolicy: { id: "", reasonText: "" },
    cancelPolicyAsInsurer: { id: "", reasonText: "" },
    renewPolicy: { newId: generatedId("policy-renewal", idFactory), existingId: "", newEndDate: dateOffset(2) },
    registerBankAccountReference: { id: generatedId("account-ref", idFactory), ownerId: "policyholder1", accountTokenText: "" },
    requestBankMandate: { id: generatedId("mandate", idFactory), policyId: "", accountReferenceId: "", expiryDate: dateOffset(1) },
    reviewBankMandate: { id: "", outcome: "APPROVE", decisionText: "" },
    cancelBankMandate: { id: "" },
    expireBankMandate: { id: "", asOfDate: today },
    recordPremiumPayment: { id: generatedId("payment", idFactory), policyId: "", mandateId: "", periodStartDate: today, periodEndDate: today, amountBdt: "", externalReferenceText: "", method: "OTP" },
    recordPremiumAdjustment: { id: generatedId("adjustment", idFactory), paymentId: "", amountBdt: "", externalReferenceText: "", reasonText: "" },
    queuePremiumCollection: { id: generatedId("collection", idFactory), mandateId: "", dueDate: today },
    completePremiumCollection: { collectionId: "", paymentId: generatedId("payment", idFactory), periodEndDate: today, externalReferenceText: "" },
    failPremiumCollection: { collectionId: "", failureText: "" },
    setBeneficiaries: { policyId: "", allocationsJson: '[{"beneficiaryId":"beneficiary-1","shareBps":10000}]' },
    submitBenefitRequest: { id: generatedId("benefit-request", idFactory), policyId: "", benefitType: "DEATH", eventDate: today, evidenceText: "" },
    decideBenefitRequest: { id: "", outcome: "APPROVE", decisionText: "" },
    markBenefitPaymentReady: { id: "", fundingReferenceText: "" },
    confirmBenefitPayment: { id: "", bankReferenceText: "" },
    submitClaim: { id: generatedId("claim", idFactory), policyId: "", hospitalId: "hospital-demo", amountBdt: "", incidentDate: today, descriptionText: "" },
    verifyClaim: { claimId: "", verificationId: generatedId("verification", idFactory), outcome: "VERIFIED", clinicalReferenceText: "" },
    assessClaimFraud: { assessmentId: generatedId("fraud", idFactory), claimId: "" },
    openClaimReview: { claimId: "", reviewId: generatedId("review", idFactory), assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2", deadline: deadlineOffset(3) },
    publishOracleRegistrySnapshot: { id: "registry-demo-v1", version: "1", rootHash: "c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd", rulesVersion: "rules-v1", rulesHash: "a".repeat(64), recordCount: "3" },
    requestOracleVerification: { requestId: generatedId("oracle-request", idFactory), claimId: "", snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: "c".repeat(64), assignedOracleIdsJson: '["oracle1","oracle2"]', commitDeadline: new Date(Date.now() + 10 * 60_000).toISOString(), revealDeadline: new Date(Date.now() + 20 * 60_000).toISOString() },
    finalizeOracleTimeout: { requestId: "" },
    routeOracleFailureToReview: { requestId: "", reviewId: generatedId("review-oracle", idFactory), assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2", deadline: deadlineOffset(3) },
    submitClaimAppeal: { appealId: generatedId("appeal", idFactory), claimId: "", reasonCategory: "DOCUMENT_ERROR", reasonText: "", descriptionText: "", evidenceText: "", proposedHospitalId: "", proposedAmountMinor: "0", proposedIncidentDate: "", proposedDescriptionText: "", proposedClinicalReferenceHash: "" },
    grantEvidenceAccess: { id: generatedId("grant", idFactory), evidenceId: "", granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: "auditor1", purpose: "AUDIT", expiresAt: deadlineOffset(7), maxAccesses: "3" },
    revokeEvidenceAccess: { grantId: "" },
    openAppealReview: { appealId: "", reviewId: generatedId("review-appeal", idFactory), assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2", deadline: deadlineOffset(3) },
    finalizeExpiredReview: { reviewId: "" },
    recordAuditorDecision: { reviewId: "", decisionId: generatedId("decision", idFactory), outcome: "APPROVE", reasonText: "" },
    authorizeSettlement: { settlementId: generatedId("settlement", idFactory), claimId: "" },
    confirmSettlement: { settlementId: "", bankReferenceText: "" },
  };
  return defaults[operation];
}

export function bdtToMinor(value: string) {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Enter a positive BDT amount with at most two decimal places.");
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The BDT amount must be positive and within the supported range.");
  }
  return Number(minor);
}

export function applyCommandPreset(
  operation: WorkflowOperation,
  current: WorkflowFormValues,
  command: Record<string, unknown>,
) {
  const next = { ...current };
  for (const field of workflowFormDefinitions[operation].fields) {
    const value = command[field.name];
    if (typeof value === "string" || typeof value === "number") next[field.name] = String(value);
  }
  if (operation === "submitClaim" && command.amountMinor !== undefined) {
    next.amountBdt = (Number(command.amountMinor) / 100).toFixed(2);
  }
  if (operation === "createPolicyPackage") {
    if (command.premiumMinor !== undefined) next.premiumBdt = (Number(command.premiumMinor) / 100).toFixed(2);
    if (command.coverageLimitMinor !== undefined) next.coverageLimitBdt = (Number(command.coverageLimitMinor) / 100).toFixed(2);
  }
  return next;
}

function required(values: WorkflowFormValues, name: string, label: string) {
  const value = values[name]?.trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function positiveInteger(values: WorkflowFormValues, name: string, label: string) {
  const value = Number(required(values, name, label));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(values: WorkflowFormValues, name: string, label: string) {
  const value = Number(required(values, name, label));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

export async function buildWorkflowCommand(
  operation: WorkflowOperation,
  values: WorkflowFormValues,
  hashText: HashText,
): Promise<WorkflowCommand> {
  const digest = async (name: string, label: string) => hashText(required(values, name, label));
  let command: unknown;

  switch (operation) {
    case "createPolicyPackage":
      command = {
        operation,
        id: required(values, "id", "Package ID"),
        name: required(values, "name", "Package name"),
        description: values.description?.trim() ?? "",
        premiumMinor: bdtToMinor(required(values, "premiumBdt", "Premium")),
        coverageLimitMinor: bdtToMinor(required(values, "coverageLimitBdt", "Coverage limit")),
        termsHash: await digest("termsText", "Terms reference"),
      };
      break;
    case "publishPolicyPackage":
      command = { operation, id: required(values, "id", "Package ID") };
      break;
    case "retirePolicyPackage":
      command = { operation, id: required(values, "id", "Package ID") };
      break;
    case "createBenefitPlan":
      command = {
        operation,
        id: required(values, "id", "Benefit plan ID"),
        packageId: required(values, "packageId", "Package ID"),
        deathBenefitMinor: bdtToMinor(required(values, "deathBenefitBdt", "Death benefit")),
        surrenderBenefitMinor: bdtToMinor(required(values, "surrenderBenefitBdt", "Surrender benefit")),
        maturityBenefitMinor: bdtToMinor(required(values, "maturityBenefitBdt", "Maturity benefit")),
        rulesHash: await digest("rulesText", "Benefit rules reference"),
      };
      break;
    case "publishBenefitPlan":
      command = { operation, id: required(values, "id", "Benefit plan ID") };
      break;
    case "retireBenefitPlan":
      command = { operation, id: required(values, "id", "Benefit plan ID") };
      break;
    case "issuePolicy":
      command = {
        operation,
        id: required(values, "id", "Policy ID"),
        packageId: required(values, "packageId", "Package ID"),
        policyholderId: required(values, "policyholderId", "Policyholder subject ID"),
        startDate: required(values, "startDate", "Coverage start date"),
        endDate: required(values, "endDate", "Coverage end date"),
      };
      break;
    case "acquirePolicy":
      command = { operation, id: required(values, "id", "Policy ID"), packageId: required(values, "packageId", "Package ID"), startDate: required(values, "startDate", "Coverage start date"), endDate: required(values, "endDate", "Coverage end date") };
      break;
    case "advancePolicyLifecycle":
      command = { operation, id: required(values, "id", "Policy ID"), asOfDate: required(values, "asOfDate", "Business date") };
      break;
    case "cancelPolicy":
    case "cancelPolicyAsInsurer":
      command = { operation, id: required(values, "id", "Policy ID"), reasonHash: await digest("reasonText", "Cancellation reason") };
      break;
    case "renewPolicy":
      command = { operation, newId: required(values, "newId", "New policy ID"), existingId: required(values, "existingId", "Existing policy ID"), newEndDate: required(values, "newEndDate", "New coverage end") };
      break;
    case "registerBankAccountReference":
      command = { operation, id: required(values, "id", "Account reference ID"), ownerId: required(values, "ownerId", "Policyholder subject ID"), accountTokenHash: await digest("accountTokenText", "Bank-vault token") };
      break;
    case "requestBankMandate":
      command = { operation, id: required(values, "id", "Mandate ID"), policyId: required(values, "policyId", "Policy ID"), accountReferenceId: required(values, "accountReferenceId", "Account reference ID"), expiryDate: required(values, "expiryDate", "Mandate expiry") };
      break;
    case "reviewBankMandate":
      command = { operation, id: required(values, "id", "Mandate ID"), outcome: required(values, "outcome", "Outcome"), decisionHash: await digest("decisionText", "Decision reference") };
      break;
    case "cancelBankMandate":
      command = { operation, id: required(values, "id", "Mandate ID") };
      break;
    case "expireBankMandate":
      command = { operation, id: required(values, "id", "Mandate ID"), asOfDate: required(values, "asOfDate", "Business date") };
      break;
    case "recordPremiumPayment":
      command = { operation, id: required(values, "id", "Payment ID"), policyId: required(values, "policyId", "Policy ID"), mandateId: required(values, "mandateId", "Mandate ID"), periodStartDate: required(values, "periodStartDate", "Period start"), periodEndDate: required(values, "periodEndDate", "Period end"), amountMinor: bdtToMinor(required(values, "amountBdt", "Premium")), externalReferenceHash: await digest("externalReferenceText", "External receipt reference"), method: required(values, "method", "Collection method") };
      break;
    case "recordPremiumAdjustment":
      command = { operation, id: required(values, "id", "Adjustment ID"), paymentId: required(values, "paymentId", "Original payment ID"), amountMinor: bdtToMinor(required(values, "amountBdt", "Reversed amount")), externalReferenceHash: await digest("externalReferenceText", "External reversal reference"), reasonHash: await digest("reasonText", "Reversal reason reference") };
      break;
    case "queuePremiumCollection":
      command = { operation, id: required(values, "id", "Collection ID"), mandateId: required(values, "mandateId", "Mandate ID"), dueDate: required(values, "dueDate", "Due date") };
      break;
    case "completePremiumCollection":
      command = { operation, collectionId: required(values, "collectionId", "Collection ID"), paymentId: required(values, "paymentId", "Payment ID"), periodEndDate: required(values, "periodEndDate", "Period end"), externalReferenceHash: await digest("externalReferenceText", "External receipt reference") };
      break;
    case "failPremiumCollection":
      command = { operation, collectionId: required(values, "collectionId", "Collection ID"), failureHash: await digest("failureText", "Failure reference") };
      break;
    case "setBeneficiaries":
      command = { operation, policyId: required(values, "policyId", "Policy ID"), allocationsJson: required(values, "allocationsJson", "Allocations JSON") };
      break;
    case "submitBenefitRequest":
      command = { operation, id: required(values, "id", "Benefit request ID"), policyId: required(values, "policyId", "Policy ID"), benefitType: required(values, "benefitType", "Benefit type"), eventDate: required(values, "eventDate", "Event date"), evidenceHash: await digest("evidenceText", "Evidence reference") };
      break;
    case "decideBenefitRequest":
      command = { operation, id: required(values, "id", "Benefit request ID"), outcome: required(values, "outcome", "Outcome"), decisionHash: await digest("decisionText", "Decision reference") };
      break;
    case "markBenefitPaymentReady":
      command = { operation, id: required(values, "id", "Benefit request ID"), fundingReferenceHash: await digest("fundingReferenceText", "Funding reference") };
      break;
    case "confirmBenefitPayment":
      command = { operation, id: required(values, "id", "Benefit request ID"), bankReferenceHash: await digest("bankReferenceText", "Bank transfer reference") };
      break;
    case "submitClaim":
      command = {
        operation,
        id: required(values, "id", "Claim ID"),
        policyId: required(values, "policyId", "Policy ID"),
        hospitalId: required(values, "hospitalId", "Assigned hospital"),
        amountMinor: bdtToMinor(required(values, "amountBdt", "Claim amount")),
        incidentDate: required(values, "incidentDate", "Incident date"),
        descriptionHash: await digest("descriptionText", "Claim description reference"),
      };
      break;
    case "verifyClaim":
      command = {
        operation,
        claimId: required(values, "claimId", "Claim ID"),
        verificationId: required(values, "verificationId", "Verification ID"),
        outcome: required(values, "outcome", "Clinical outcome"),
        clinicalReferenceHash: await digest("clinicalReferenceText", "Clinical reference"),
      };
      break;
    case "assessClaimFraud":
      command = { operation, assessmentId: required(values, "assessmentId", "Assessment ID"), claimId: required(values, "claimId", "Claim ID") };
      break;
    case "openClaimReview":
      command = { operation, claimId: required(values, "claimId", "Claim ID"), reviewId: required(values, "reviewId", "Review ID"), assignedAuditorIdsJson: required(values, "assignedAuditorIdsJson", "Assigned auditor IDs"), approvalThreshold: positiveInteger(values, "approvalThreshold", "Approval threshold"), rejectionThreshold: positiveInteger(values, "rejectionThreshold", "Rejection threshold"), deadline: required(values, "deadline", "Review deadline") };
      break;
    case "publishOracleRegistrySnapshot":
      command = { operation, id: required(values, "id", "Snapshot ID"), version: positiveInteger(values, "version", "Snapshot version"), rootHash: required(values, "rootHash", "Canonical registry root"), rulesVersion: required(values, "rulesVersion", "Rules version"), rulesHash: required(values, "rulesHash", "Rules commitment"), recordCount: positiveInteger(values, "recordCount", "Registry record count") };
      break;
    case "requestOracleVerification":
      command = { operation, requestId: required(values, "requestId", "Oracle request ID"), claimId: required(values, "claimId", "Claim ID"), snapshotId: required(values, "snapshotId", "Snapshot ID"), modelVersion: required(values, "modelVersion", "Model version"), modelHash: required(values, "modelHash", "Model commitment"), assignedOracleIdsJson: required(values, "assignedOracleIdsJson", "Assigned Oracle IDs"), commitDeadline: required(values, "commitDeadline", "Commit deadline"), revealDeadline: required(values, "revealDeadline", "Reveal deadline") };
      break;
    case "finalizeOracleTimeout":
      command = { operation, requestId: required(values, "requestId", "Oracle request ID") };
      break;
    case "routeOracleFailureToReview":
      command = { operation, requestId: required(values, "requestId", "Oracle request ID"), reviewId: required(values, "reviewId", "Review ID"), assignedAuditorIdsJson: required(values, "assignedAuditorIdsJson", "Assigned auditor IDs"), approvalThreshold: positiveInteger(values, "approvalThreshold", "Approval threshold"), rejectionThreshold: positiveInteger(values, "rejectionThreshold", "Rejection threshold"), deadline: required(values, "deadline", "Review deadline") };
      break;
    case "submitClaimAppeal":
      command = {
        operation,
        appealId: required(values, "appealId", "Appeal ID"),
        claimId: required(values, "claimId", "Claim ID"),
        reasonCategory: required(values, "reasonCategory", "Appeal category"),
        reasonHash: await digest("reasonText", "Appeal reason"),
        descriptionHash: await digest("descriptionText", "Appeal description"),
        evidenceHash: values.evidenceText?.trim() ? await hashText(values.evidenceText.trim()) : "",
        proposedHospitalId: values.proposedHospitalId?.trim() ?? "",
        proposedAmountMinor: nonNegativeInteger(values, "proposedAmountMinor", "Corrected amount"),
        proposedIncidentDate: values.proposedIncidentDate?.trim() ?? "",
        proposedDescriptionHash: values.proposedDescriptionText?.trim() ? await hashText(values.proposedDescriptionText.trim()) : "",
        proposedClinicalReferenceHash: required(values, "proposedClinicalReferenceHash", "Correct registry lookup hash"),
      };
      break;
    case "grantEvidenceAccess":
      command = {
        operation,
        id: required(values, "id", "Grant ID"),
        evidenceId: required(values, "evidenceId", "Evidence ID"),
        granteeMsp: required(values, "granteeMsp", "Grantee organization"),
        granteeRole: required(values, "granteeRole", "Grantee role"),
        granteeSubject: required(values, "granteeSubject", "Grantee certificate subject"),
        purpose: required(values, "purpose", "Permitted purpose"),
        expiresAt: required(values, "expiresAt", "Expiry"),
        maxAccesses: positiveInteger(values, "maxAccesses", "Maximum retrievals"),
      };
      break;
    case "revokeEvidenceAccess":
      command = { operation, grantId: required(values, "grantId", "Grant ID") };
      break;
    case "openAppealReview":
      command = { operation, appealId: required(values, "appealId", "Appeal ID"), reviewId: required(values, "reviewId", "Review ID"), assignedAuditorIdsJson: required(values, "assignedAuditorIdsJson", "Assigned auditor IDs"), approvalThreshold: positiveInteger(values, "approvalThreshold", "Approval threshold"), rejectionThreshold: positiveInteger(values, "rejectionThreshold", "Rejection threshold"), deadline: required(values, "deadline", "Review deadline") };
      break;
    case "finalizeExpiredReview":
      command = { operation, reviewId: required(values, "reviewId", "Review ID") };
      break;
    case "recordAuditorDecision":
      command = {
        operation,
        reviewId: required(values, "reviewId", "Review ID"),
        decisionId: required(values, "decisionId", "Decision ID"),
        outcome: required(values, "outcome", "Audit outcome"),
        reasonHash: await digest("reasonText", "Decision reason reference"),
      };
      break;
    case "authorizeSettlement":
      command = {
        operation,
        settlementId: required(values, "settlementId", "Settlement ID"),
        claimId: required(values, "claimId", "Claim ID"),
      };
      break;
    case "confirmSettlement":
      command = {
        operation,
        settlementId: required(values, "settlementId", "Settlement ID"),
        bankReferenceHash: await digest("bankReferenceText", "Bank transfer reference"),
      };
      break;
  }

  return workflowCommandSchema.parse(command);
}
