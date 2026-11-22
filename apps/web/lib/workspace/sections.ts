import type { FabricRole } from "@/lib/fabric/config";
import type { WorkflowOperation } from "@/lib/workflows/commands";

// Each workspace is split into sub-pages reached from its sidebar. A sub-page
// owns the cards it shows and the ledger operations its transaction form offers.

export type WorkspaceIcon =
  | "home" | "claims" | "customers" | "products" | "partners" | "premiums" | "verification"
  | "evidence" | "activity" | "reports" | "tools" | "policies" | "payments" | "documents"
  | "profile" | "intake" | "registry" | "records" | "accounts" | "collections" | "payouts"
  | "notifications" | "reviews";

export type WorkspaceSection = {
  /** URL segment; "overview" is served at the workspace root. */
  id: string;
  label: string;
  title: string;
  description: string;
  icon: WorkspaceIcon;
  /** Operations offered by this page's transaction form. */
  operations?: readonly WorkflowOperation[];
  /** Heading of this page's transaction form. */
  formTitle?: string;
  /** Shown only on the medical channel. */
  medicalOnly?: boolean;
  /** Shown only when customer onboarding is enabled. */
  onboardingOnly?: boolean;
};

export const overviewSection = "overview";

export const workspaceSections: Record<FabricRole, readonly WorkspaceSection[]> = {
  insurerAdmin: [
    { id: overviewSection, label: "Overview", title: "Overview", icon: "home",
      description: "Portfolio position and the items waiting for the Insurer." },
    { id: "claims", label: "Claims", title: "Claims", icon: "claims",
      description: "Process claims, run governed reviews and authorise settlement.",
      formTitle: "Claim actions",
      operations: ["startClaimProcessing", "openClaimReview", "finalizeExpiredReview", "authorizeSettlement", "assessClaimFraud", "decideBenefitRequest", "markBenefitPaymentReady"] },
    { id: "customers", label: "Customers", title: "Customers", icon: "customers",
      description: "Approve new customers, match hospital stays to members and issue policies.",
      formTitle: "Customer actions",
      operations: ["verifyMedicalAssociation", "issuePolicy", "issuePolicyPrivacyCredential", "revokePolicyPrivacyCredential"] },
    { id: "products", label: "Products", title: "Products", icon: "products",
      description: "Design, publish and retire coverage packages and benefit plans.",
      formTitle: "Product actions",
      operations: ["createPolicyPackage", "configureMedicalRules", "configurePolicyPackagePartners", "publishPolicyPackage", "retirePolicyPackage", "createBenefitPlan", "publishBenefitPlan", "retireBenefitPlan"] },
    { id: "partners", label: "Partners", title: "Partners", icon: "partners",
      description: "Hospital and bank agreements, registry approvals and reference charges.",
      formTitle: "Partner actions",
      operations: ["createPartnerAgreement", "setPartnerAgreementStatus", "registerMedicalOracleBenchmark"] },
    { id: "premiums", label: "Premiums", title: "Premiums", icon: "premiums",
      description: "Premium collections, overdue policies, lapses and reinstatement.",
      formTitle: "Policy and premium actions",
      operations: ["queuePremiumCollection", "schedulePremiumCollections", "retryPremiumCollection", "advancePolicyLifecycle", "reinstatePolicy", "cancelPolicyAsInsurer"] },
    { id: "verification", label: "Verification", title: "Verification", icon: "verification",
      description: "Oracle workers, registry snapshots and verification outcomes.",
      formTitle: "Verification actions",
      operations: ["publishOracleRegistrySnapshot", "requestOracleVerification", "finalizeOracleTimeout", "routeOracleFailureToReview"] },
    { id: "evidence", label: "Evidence", title: "Evidence", icon: "evidence",
      description: "Retrieve claim documents and verify their integrity.",
      formTitle: "Evidence actions",
      operations: ["publishEvidenceMerkleBatch"] },
    { id: "activity", label: "Activity", title: "Activity", icon: "activity",
      description: "Recent ledger events for this organisation." },
    { id: "reports", label: "Reports", title: "Reports", icon: "reports",
      description: "Portfolio, adjudication and verification metrics." },
    { id: "tools", label: "Ledger tools", title: "Ledger tools", icon: "tools",
      description: "Look up ledger records and connection details." },
  ],
  policyholder: [
    { id: overviewSection, label: "Overview", title: "Overview", icon: "home",
      description: "Your cover, insurance card and recent claims." },
    { id: "policies", label: "Policies", title: "Policies", icon: "policies",
      description: "Buy, renew or cancel cover and download statements.",
      formTitle: "Policy actions",
      operations: ["acquireMedicalPolicy", "acquirePolicy", "renewPolicy", "cancelPolicy", "setBeneficiaries", "submitBenefitRequest"] },
    { id: "payments", label: "Payments", title: "Payments", icon: "payments",
      description: "Bank accounts, automatic debits and premium payments.",
      formTitle: "Bank and payment actions",
      operations: ["requestBankAccountLink", "cancelBankAccountLink", "requestBankMandate", "cancelBankMandate"] },
    { id: "claims", label: "Claims", title: "Claims", icon: "claims",
      description: "Hospital stays, claims, reviews and appeals.",
      formTitle: "Claim actions",
      operations: ["submitClaim", "registerClaimPrivacyPresentation", "submitClaimAppeal"] },
    { id: "documents", label: "Documents", title: "Documents", icon: "documents",
      description: "Upload, share and retrieve your encrypted documents.",
      formTitle: "Document sharing",
      operations: ["grantEvidenceAccess", "revokeEvidenceAccess"] },
    { id: "activity", label: "Activity", title: "Activity", icon: "activity",
      description: "Recent updates to your policies and claims." },
    { id: "profile", label: "Profile", title: "Profile", icon: "profile", onboardingOnly: true,
      description: "Your contact details and email address." },
  ],
  hospitalOfficer: [
    { id: overviewSection, label: "Overview", title: "Overview", icon: "home",
      description: "Billing register status and items waiting for the Hospital." },
    { id: "intake", label: "Patient billing", title: "Patient billing", icon: "intake",
      description: "Register patient stays and maintain the billing record.",
      formTitle: "Billing record",
      operations: ["saveMedicalEpisode", "createHospitalInvoice", "updateHospitalInvoice", "recordHospitalModelFacts", "issueInvoicePrivacyCredential", "revokeInvoicePrivacyCredential"] },
    { id: "registry", label: "Registry", title: "Registry", icon: "registry", medicalOnly: true,
      description: "Hospital registry proposals and approved snapshots." },
    { id: "activity", label: "Activity", title: "Activity", icon: "activity",
      description: "Recent ledger events for this Hospital." },
    { id: "records", label: "Records", title: "Records", icon: "records",
      description: "Look up invoices, agreements and connected packages." },
  ],
  bankOfficer: [
    { id: overviewSection, label: "Overview", title: "Overview", icon: "home",
      description: "Balances and the Bank's work queue." },
    { id: "accounts", label: "Accounts", title: "Accounts", icon: "accounts",
      description: "Customer accounts, link requests and balance adjustments.",
      formTitle: "Account instruction",
      operations: ["openBankAccount", "reviewBankAccountLink", "adjustBankAccountBalance"] },
    { id: "collections", label: "Mandates & collections", title: "Mandates and collections", icon: "collections",
      description: "EFT mandates, premium collections and reversals.",
      formTitle: "Collection instruction",
      operations: ["reviewBankMandate", "processPremiumCollection", "expireBankMandate", "recordPremiumAdjustment"] },
    { id: "payouts", label: "Payouts", title: "Payouts", icon: "payouts",
      description: "Authorised claim payouts and benefit payments.",
      formTitle: "Payout instruction",
      operations: ["confirmSettlement", "confirmBenefitPayment"] },
    { id: "notifications", label: "Notifications", title: "Notifications", icon: "notifications",
      description: "Customer email deliveries and recent ledger events." },
    { id: "records", label: "Records", title: "Records", icon: "records",
      description: "Look up accounts, mandates, transfers and payouts." },
  ],
  auditor: [
    { id: overviewSection, label: "Overview", title: "Overview", icon: "home",
      description: "Reviews assigned to you and recent claims." },
    { id: "reviews", label: "Reviews", title: "Reviews", icon: "reviews",
      description: "Open case files, record your decision and export dossiers.",
      formTitle: "Record a decision",
      operations: ["recordAuditorDecision"] },
    { id: "evidence", label: "Evidence", title: "Evidence", icon: "evidence",
      description: "Retrieve claim documents and verify their integrity." },
    { id: "verification", label: "Verification", title: "Verification", icon: "verification",
      description: "Oracle workers and verification outcomes." },
    { id: "activity", label: "Activity", title: "Activity", icon: "activity",
      description: "Recent ledger events visible to auditors." },
    { id: "reports", label: "Reports", title: "Reports", icon: "reports",
      description: "Portfolio, adjudication and verification metrics." },
    { id: "tools", label: "Ledger tools", title: "Ledger tools", icon: "tools",
      description: "Look up ledger records and connection details." },
  ],
};

export function sectionsFor(role: FabricRole, options: { medical: boolean; onboarding: boolean }) {
  return workspaceSections[role].filter((section) =>
    (!section.medicalOnly || options.medical) && (!section.onboardingOnly || options.onboarding));
}

export function findSection(role: FabricRole, id: string | null | undefined, options: { medical: boolean; onboarding: boolean }) {
  return sectionsFor(role, options).find((section) => section.id === (id || overviewSection));
}

/** The sub-page whose form offers this operation, if any. */
export function sectionForOperation(role: FabricRole, operation: string) {
  return workspaceSections[role].find((section) => section.operations?.includes(operation as WorkflowOperation));
}

export function sectionHref(workspace: string, id: string) {
  return id === overviewSection ? `/workspace/${workspace}` : `/workspace/${workspace}/${id}`;
}
