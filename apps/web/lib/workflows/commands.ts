import { z } from "zod";
import type { FabricRole } from "@/lib/fabric/config";

const id = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
const hash = z.string().trim().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().positive().safe();

export const workflowCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("createPolicyPackage"),
    id,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000),
    premiumMinor: money,
    coverageLimitMinor: money,
    termsHash: hash,
  }),
  z.object({ operation: z.literal("publishPolicyPackage"), id }),
  z.object({
    operation: z.literal("issuePolicy"),
    id,
    packageId: id,
    policyholderId: id,
    startDate: date,
    endDate: date,
  }),
  z.object({
    operation: z.literal("submitClaim"),
    id,
    policyId: id,
    amountMinor: money,
    incidentDate: date,
    descriptionHash: hash,
  }),
  z.object({
    operation: z.literal("verifyClaim"),
    claimId: id,
    verificationId: id,
    outcome: z.enum(["VERIFIED", "INVALID"]),
    clinicalReferenceHash: hash,
  }),
  z.object({ operation: z.literal("startClaimReview"), claimId: id }),
  z.object({
    operation: z.literal("recordAuditorDecision"),
    claimId: id,
    decisionId: id,
    outcome: z.enum(["APPROVE", "REJECT"]),
    reasonHash: hash,
  }),
  z.object({ operation: z.literal("authorizeSettlement"), settlementId: id, claimId: id }),
  z.object({ operation: z.literal("confirmSettlement"), settlementId: id, bankReferenceHash: hash }),
]);

export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;
export type WorkflowOperation = WorkflowCommand["operation"];

export const requiredRoleByOperation = {
  createPolicyPackage: "insurerAdmin",
  publishPolicyPackage: "insurerAdmin",
  issuePolicy: "insurerAdmin",
  submitClaim: "policyholder",
  verifyClaim: "hospitalOfficer",
  startClaimReview: "insurerAdmin",
  recordAuditorDecision: "auditor",
  authorizeSettlement: "insurerAdmin",
  confirmSettlement: "bankOfficer",
} as const satisfies Record<WorkflowOperation, FabricRole>;

export function canExecute(role: FabricRole, operation: WorkflowOperation) {
  return requiredRoleByOperation[operation] === role;
}
