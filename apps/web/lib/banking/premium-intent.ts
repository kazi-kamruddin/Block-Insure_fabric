import { createHash } from "node:crypto";
import { z } from "zod";
import { ledgerDateSchema, ledgerIdSchema } from "@/lib/fabric/validation";
export const premiumIntentSchema = z.object({
  transferId: ledgerIdSchema, paymentId: ledgerIdSchema, policyId: ledgerIdSchema,
  sourceAccountId: ledgerIdSchema, destinationAccountId: ledgerIdSchema,
  periodStartDate: ledgerDateSchema, periodEndDate: ledgerDateSchema,
  amountMinor: z.number().int().positive().safe(), externalReferenceHash: z.string().regex(/^[a-fA-F0-9]{64}$/).transform((v) => v.toLowerCase()),
});
export function premiumOtpBinding(payment: z.infer<typeof premiumIntentSchema>, subjectId: string, recipient: string) {
  const sorted = Object.entries(payment).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return { policyId: payment.policyId, sourceAccountId: payment.sourceAccountId, subjectId, recipient,
    intentHash: createHash("sha256").update(JSON.stringify({ action: "MANUAL_PREMIUM", payment: sorted })).digest("hex") };
}
