import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import { loadFabricConfig } from "@/lib/fabric/config";
import { readEventProjection } from "@/lib/events/store";
import { buildResearchSnapshot } from "./snapshot";

export async function loadResearchSnapshot() {
  const [policies, claims, reviews, decisions, appeals, fraudAssessments, evidence, evidenceGrants, evidenceAccess, settlements, premiumPayments, premiumAdjustments, benefitRequests, liabilities, ledgerSchemaVersion, projection] = await Promise.all([
    ledger.listPolicies(), ledger.listClaims(), ledger.listClaimReviews(), ledger.listAuditorDecisions(),
    ledger.listClaimAppeals(), ledger.listFraudAssessments(), ledger.listEvidenceReferences(),
    ledger.listEvidenceAccessGrants(), ledger.listEvidenceAccessRecords(), ledger.listSettlements(),
    ledger.listPremiumPayments(), ledger.listPremiumAdjustments(), ledger.listBenefitRequests(),
    ledger.listLiabilities(), ledger.schemaVersion(), readEventProjection(),
  ]);
  const config = loadFabricConfig();
  const indexedEvents = Object.values(projection.countsByName).reduce((total, count) => total + count, 0);
  return buildResearchSnapshot(
    { policies, claims, reviews, decisions, appeals, fraudAssessments, evidence, evidenceGrants, evidenceAccess, settlements, premiumPayments, premiumAdjustments, benefitRequests, liabilities },
    { channel: config.channelName, chaincode: config.chaincodeName, ledgerSchemaVersion, checkpoint: projection.checkpoint, indexedEvents, retainedEvents: projection.events.length, eventCounts: projection.countsByName },
  );
}
