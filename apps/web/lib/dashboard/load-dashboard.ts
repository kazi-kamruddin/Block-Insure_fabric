import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type { Session } from "@/lib/auth/session-token";
import { buildRoleDashboard } from "./build-dashboard";

export async function loadRoleDashboard(session: Session) {
  const [packages, policies, claims, evidence, settlements, evidenceAccess, mandates, bankAccounts, bankTransfers, premiumPayments, premiumCollections, benefitRequests, liabilities, reviews, appeals, decisions, fraudAssessments, oracleRequests, oracleSnapshots, partnerAgreements, hospitalInvoices] = await Promise.all([
    ledger.listPolicyPackages(),
    ledger.listPolicies(),
    ledger.listClaims(),
    ledger.listEvidenceReferences(),
    ledger.listSettlements(),
    ledger.listEvidenceAccessRecords(),
    ledger.listBankMandates(),
    ledger.listBankAccountReferences(),
    ledger.listBankTransfers(),
    ledger.listPremiumPayments(),
    ledger.listPremiumCollections(),
    ledger.listBenefitRequests(),
    ledger.listLiabilities(),
    ledger.listClaimReviews(),
    ledger.listClaimAppeals(),
    ledger.listAuditorDecisions(),
    ledger.listFraudAssessments(),
    ledger.listOracleRequests(),
    ledger.listOracleRegistrySnapshots(),
    ledger.listPartnerAgreements(),
    ledger.listHospitalInvoices(),
  ]);

  return buildRoleDashboard(
    session.role,
    { packages, policies, claims, evidence, settlements, evidenceAccess, mandates, bankAccounts, bankTransfers, premiumPayments, premiumCollections, benefitRequests, liabilities, reviews, appeals, decisions, fraudAssessments, oracleRequests, oracleSnapshots, partnerAgreements, hospitalInvoices },
    session.subjectId,
  );
}
