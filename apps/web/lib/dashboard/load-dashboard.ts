import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type { Session } from "@/lib/auth/session-token";
import { buildRoleDashboard } from "./build-dashboard";

export async function loadRoleDashboard(session: Session) {
  const [packages, policies, claims, evidence, settlements, evidenceAccess] = await Promise.all([
    ledger.listPolicyPackages(),
    ledger.listPolicies(),
    ledger.listClaims(),
    ledger.listEvidenceReferences(),
    ledger.listSettlements(),
    ledger.listEvidenceAccessRecords(),
  ]);

  return buildRoleDashboard(
    session.role,
    { packages, policies, claims, evidence, settlements, evidenceAccess },
    session.subjectId,
  );
}
