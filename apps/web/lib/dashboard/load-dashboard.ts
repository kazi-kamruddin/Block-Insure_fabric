import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type { Session } from "@/lib/auth/session-token";
import { buildRoleDashboard } from "./build-dashboard";

export async function loadRoleDashboard(session: Session) {
  const [packages, policies, claims, evidence, settlements, evidenceAccess, mandates, premiumPayments, premiumCollections, benefitRequests, liabilities] = await Promise.all([
    ledger.listPolicyPackages(),
    ledger.listPolicies(),
    ledger.listClaims(),
    ledger.listEvidenceReferences(),
    ledger.listSettlements(),
    ledger.listEvidenceAccessRecords(),
    ledger.listBankMandates(),
    ledger.listPremiumPayments(),
    ledger.listPremiumCollections(),
    ledger.listBenefitRequests(),
    ledger.listLiabilities(),
  ]);

  return buildRoleDashboard(
    session.role,
    { packages, policies, claims, evidence, settlements, evidenceAccess, mandates, premiumPayments, premiumCollections, benefitRequests, liabilities },
    session.subjectId,
  );
}
