import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { premiumIntentSchema, premiumOtpBinding } from "@/lib/banking/premium-intent";
import { findDemoAccount } from "@/lib/auth/accounts";
import { currentSession, sessionSecret } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { otpChallenges } from "@/lib/banking/otp";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { reconcilePremiumOutcome } from "@/lib/banking/premium-outcome";

const requestSchema = premiumIntentSchema.extend({
  challengeId: z.string().uuid().optional(), otp: z.string().regex(/^\d{6}$/).optional(), recoverOnly: z.boolean().default(false),
});
export const runtime = "nodejs";

function otpSecret() {
  const configured = process.env.OTP_SECRET ?? "";
  return configured.length >= 32 ? configured : sessionSecret();
}

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  const session = await currentSession().catch(() => null);
  if (!session || session.role !== "policyholder" || !session.subjectId) {
    return NextResponse.json({ message: "A policyholder session is required" }, { status: 403 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Invalid premium payment request" }, { status: 400 });
  try {
    const { challengeId, otp, recoverOnly, ...payment } = parsed.data;
    const policy = await ledger.readPolicy(payment.policyId);
    if (policy.policyholderId !== session.subjectId) return NextResponse.json({ message: "This policy belongs to another subject" }, { status: 403 });
    const transfer = await ledger.readBankTransfer(payment.transferId).catch((error: unknown) => {
      if (String(error).includes("does not exist")) return null;
      throw error;
    });
    if (transfer) {
      const recorded = transfer.status === "SETTLED" ? await ledger.readPremiumPayment(payment.paymentId) : undefined;
      return NextResponse.json({ ...reconcilePremiumOutcome(payment, transfer, recorded), recovered: true });
    }
    if (recoverOnly) return NextResponse.json({ status: "UNRESOLVED", message: "No matching committed transfer is visible. An unknown submission is not permission to create another payment." }, { status: 202 });
    if (!challengeId || !otp) throw new Error("A valid OTP challenge is required for a new payment");
    const recipient = findDemoAccount(session.accountId)?.email ?? process.env.POLICYHOLDER_OTP_EMAIL;
    if (!recipient) throw new Error("No OTP recipient is configured");
    otpChallenges.consume(challengeId, otp, premiumOtpBinding(payment, session.subjectId, recipient), otpSecret());
    const authorizationHash = createHmac("sha256", otpSecret()).update(`${challengeId}:${session.subjectId}:consumed`).digest("hex");
    return NextResponse.json({ result: await ledger.executeManualPremiumPayment({ ...payment, authorizationHash }) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Premium payment failed" }, { status: 409 });
  }
}
