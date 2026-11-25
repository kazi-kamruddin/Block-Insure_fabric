import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ledger } from "@/lib/fabric/ledger";
import { loadFabricConfig } from "@/lib/fabric/config";
import { readEventProjection } from "@/lib/events/store";
import { buildResearchSnapshot } from "./snapshot";

const faultTrials = z.array(z.object({
  requestId: z.string().min(1), injectedFault: z.string().min(1), expectedOutcome: z.string().min(1),
  observedOutcome: z.string().min(1), date: z.iso.date(),
}));

async function readFaultTrials() {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    try {
      const text = await fs.readFile(path.join(directory, "benchmarks", "oracle-faults", "trials.json"), "utf8");
      return faultTrials.parse(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return [];
}

export async function loadResearchSnapshot() {
  const [policies, claims, reviews, decisions, appeals, fraudAssessments, evidence, evidenceGrants, evidenceAccess, settlements, premiumPayments, premiumAdjustments, benefitRequests, liabilities, oracleRequests, oracleResults, privacyCredentials, privacyPresentations, ledgerSchemaVersion, projection, oracleFaultTrials] = await Promise.all([
    ledger.listPolicies(), ledger.listClaims(), ledger.listClaimReviews(), ledger.listAuditorDecisions(),
    ledger.listClaimAppeals(), ledger.listFraudAssessments(), ledger.listEvidenceReferences(),
    ledger.listEvidenceAccessGrants(), ledger.listEvidenceAccessRecords(), ledger.listSettlements(),
    ledger.listPremiumPayments(), ledger.listPremiumAdjustments(), ledger.listBenefitRequests(),
    ledger.listLiabilities(), ledger.listOracleRequests(), ledger.listOracleResults(), ledger.listPrivacyCredentials(),
    ledger.listSelectiveDisclosurePresentations(), ledger.schemaVersion(), readEventProjection(), readFaultTrials(),
  ]);
  const config = loadFabricConfig();
  const indexedEvents = Object.values(projection.countsByName).reduce((total, count) => total + count, 0);
  return buildResearchSnapshot(
    { policies, claims, reviews, decisions, appeals, fraudAssessments, evidence, evidenceGrants, evidenceAccess, settlements, premiumPayments, premiumAdjustments, benefitRequests, liabilities, oracleRequests, oracleResults, privacyCredentials, privacyPresentations, oracleFaultTrials },
    { channel: config.channelName, chaincode: config.chaincodeName, ledgerSchemaVersion, checkpoint: projection.checkpoint, indexedEvents, retainedEvents: projection.events.length, eventCounts: projection.countsByName },
  );
}
