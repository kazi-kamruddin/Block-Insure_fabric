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
  insurerAdmin: ["createPolicyPackage", "publishPolicyPackage", "retirePolicyPackage", "issuePolicy", "startClaimReview", "authorizeSettlement"],
  policyholder: ["submitClaim"],
  hospitalOfficer: ["verifyClaim"],
  auditor: ["recordAuditorDecision"],
  bankOfficer: ["confirmSettlement"],
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
  submitClaim: {
    label: "Submit claim",
    description: "Open a claim against one of your active policies.",
    fields: [
      { name: "id", label: "Claim ID", placeholder: "claim-1001" },
      { name: "policyId", label: "Policy ID", placeholder: "policy-1001" },
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
  startClaimReview: {
    label: "Start independent review",
    description: "Move a hospital-verified claim into the auditor's decision queue.",
    fields: [{ name: "claimId", label: "Claim ID", placeholder: "claim-1001" }],
  },
  recordAuditorDecision: {
    label: "Record auditor decision",
    description: "Commit one independent approve or reject decision for a claim under review.",
    fields: [
      { name: "claimId", label: "Claim ID", placeholder: "claim-1001" },
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

export function createWorkflowFormValues(
  operation: WorkflowOperation,
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
): WorkflowFormValues {
  const today = dateOffset(0);
  const defaults: Record<WorkflowOperation, WorkflowFormValues> = {
    createPolicyPackage: { id: generatedId("package", idFactory), name: "", description: "", premiumBdt: "", coverageLimitBdt: "", termsText: "" },
    publishPolicyPackage: { id: "" },
    retirePolicyPackage: { id: "" },
    issuePolicy: { id: generatedId("policy", idFactory), packageId: "", policyholderId: "policyholder1", startDate: today, endDate: dateOffset(1) },
    submitClaim: { id: generatedId("claim", idFactory), policyId: "", amountBdt: "", incidentDate: today, descriptionText: "" },
    verifyClaim: { claimId: "", verificationId: generatedId("verification", idFactory), outcome: "VERIFIED", clinicalReferenceText: "" },
    startClaimReview: { claimId: "" },
    recordAuditorDecision: { claimId: "", decisionId: generatedId("decision", idFactory), outcome: "APPROVE", reasonText: "" },
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
    case "submitClaim":
      command = {
        operation,
        id: required(values, "id", "Claim ID"),
        policyId: required(values, "policyId", "Policy ID"),
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
    case "startClaimReview":
      command = { operation, claimId: required(values, "claimId", "Claim ID") };
      break;
    case "recordAuditorDecision":
      command = {
        operation,
        claimId: required(values, "claimId", "Claim ID"),
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
