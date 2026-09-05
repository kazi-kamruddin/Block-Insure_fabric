import "server-only";

import type { Contract } from "@hyperledger/fabric-gateway";
import { withFabricContract } from "./gateway";
import type { FabricRole } from "./config";
import type {
  AuditorDecision,
  Claim,
  ClaimHistoryRecord,
  EvidenceReference,
  HospitalVerification,
  Policy,
  PolicyPackage,
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
