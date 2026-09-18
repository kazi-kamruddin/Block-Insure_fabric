import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { currentSession, sessionSecret } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { otpChallenges } from "@/lib/banking/otp";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const hash = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const requestSchema = z.object({
  challengeId: z.string().uuid(), otp: z.string().regex(/^\d{6}$/),
  transferId: z.string().min(3).max(128), paymentId: z.string().min(3).max(128), policyId: z.string().min(3).max(128),
  sourceAccountId: z.string().min(3).max(128), destinationAccountId: z.string().min(3).max(128),
  periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountMinor: z.number().int().positive().safe(), externalReferenceHash: hash,
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
    const { challengeId, otp, ...payment } = parsed.data;
    otpChallenges.consume(challengeId, otp, {
      policyId: payment.policyId, sourceAccountId: payment.sourceAccountId, subjectId: session.subjectId,
    }, otpSecret());
    const authorizationHash = createHmac("sha256", otpSecret()).update(`${challengeId}:${session.subjectId}:consumed`).digest("hex");
    return NextResponse.json({ result: await ledger.executeManualPremiumPayment({ ...payment, authorizationHash }) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Premium payment failed" }, { status: 409 });
  }
}
