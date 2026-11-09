import type { z } from "zod";
import type { BankTransfer, PremiumPayment } from "@/lib/fabric/types";
import type { premiumIntentSchema } from "./premium-intent";

export function reconcilePremiumOutcome(intent: z.infer<typeof premiumIntentSchema>, transfer: BankTransfer, payment?: PremiumPayment) {
  if (transfer.id !== intent.transferId || transfer.paymentId !== intent.paymentId || transfer.method !== "OTP" ||
      ["policyId", "sourceAccountId", "destinationAccountId", "amountMinor", "externalReferenceHash"].some((name) =>
        transfer[name as keyof BankTransfer] !== intent[name as keyof typeof intent])) throw new Error("Stored transfer differs from the original premium intent");
  if (transfer.status === "BOUNCED") return { status: "BOUNCED", result: transfer };
  if (transfer.status !== "SETTLED" || !payment || payment.id !== intent.paymentId || payment.transferId !== intent.transferId || payment.method !== "OTP" ||
      ["policyId", "sourceAccountId", "destinationAccountId", "periodStartDate", "periodEndDate", "amountMinor", "externalReferenceHash"].some((name) =>
        payment[name as keyof PremiumPayment] !== intent[name as keyof typeof intent])) throw new Error("Committed premium linkage is incomplete or inconsistent; do not resubmit");
  return { status: "SETTLED", result: transfer };
}
