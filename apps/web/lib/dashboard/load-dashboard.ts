import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type { Session } from "@/lib/auth/session-token";
import type { FabricRole } from "@/lib/fabric/config";
import { buildRoleDashboard, type DashboardAssets } from "./build-dashboard";

const loaders = {
  packages: ledger.listPolicyPackages,
  policies: ledger.listPolicies,
  claims: ledger.listClaims,
  evidence: ledger.listEvidenceReferences,
  settlements: ledger.listSettlements,
  evidenceAccess: ledger.listEvidenceAccessRecords,
  mandates: ledger.listBankMandates,
  bankAccounts: ledger.listBankAccountReferences,
  bankTransfers: ledger.listBankTransfers,
  premiumPayments: ledger.listPremiumPayments,
  premiumCollections: ledger.listPremiumCollections,
  benefitRequests: ledger.listBenefitRequests,
  liabilities: ledger.listLiabilities,
  reviews: ledger.listClaimReviews,
  appeals: ledger.listClaimAppeals,
  decisions: ledger.listAuditorDecisions,
  fraudAssessments: ledger.listFraudAssessments,
  oracleRequests: ledger.listOracleRequests,
  oracleSnapshots: ledger.listOracleRegistrySnapshots,
  partnerAgreements: ledger.listPartnerAgreements,
  hospitalInvoices: ledger.listHospitalInvoices,
} satisfies { [K in keyof DashboardAssets]-?: () => Promise<NonNullable<DashboardAssets[K]>> };

const assetsByRole = {
  insurerAdmin: ["packages", "policies", "claims", "benefitRequests", "oracleRequests", "partnerAgreements", "fraudAssessments"],
  policyholder: ["policies", "claims", "mandates", "bankAccounts", "premiumPayments", "benefitRequests", "appeals"],
  hospitalOfficer: ["partnerAgreements", "hospitalInvoices"],
  auditor: ["claims", "evidenceAccess", "reviews", "decisions"],
  bankOfficer: ["settlements", "mandates", "bankAccounts", "bankTransfers", "premiumCollections", "benefitRequests"],
} as const satisfies Record<FabricRole, readonly (keyof DashboardAssets)[]>;

export async function loadRoleDashboard(session: Session) {
  const assets: DashboardAssets = {
    packages: [], policies: [], claims: [], evidence: [], settlements: [], evidenceAccess: [],
  };
  await Promise.all(assetsByRole[session.role].map(async (key) => {
    Object.assign(assets, { [key]: await loaders[key]() });
  }));
  return buildRoleDashboard(session.role, assets, session.subjectId);
}
