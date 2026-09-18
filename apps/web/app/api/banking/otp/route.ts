import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sessionSecret } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";
import { otpChallenges } from "@/lib/banking/otp";
import { deliverBankOtp } from "@/lib/banking/email-gateway";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const requestSchema = z.object({ policyId: z.string().min(3).max(128), sourceAccountId: z.string().min(3).max(128) });
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
  if (!parsed.success) return NextResponse.json({ message: "Invalid OTP request" }, { status: 400 });
  try {
    const [policy, account] = await Promise.all([
      ledger.readPolicy(parsed.data.policyId),
      ledger.readBankAccountReference(parsed.data.sourceAccountId),
    ]);
    if (policy.policyholderId !== session.subjectId || account.ownerId !== session.subjectId
      || account.accountType !== "CUSTOMER" || account.status !== "VERIFIED"
      || !policy.bankIds?.includes(account.bankId)) {
      return NextResponse.json({ message: "The selected customer account cannot fund this policy" }, { status: 403 });
    }
    const ttl = Number(process.env.OTP_TTL_SECONDS ?? 300);
    const challenge = otpChallenges.issue({ ...parsed.data, subjectId: session.subjectId }, otpSecret(), ttl);
    const recipient = findDemoAccount(session.accountId)?.email ?? process.env.POLICYHOLDER_OTP_EMAIL;
    if (!recipient) throw new Error("No OTP email address is configured for this policyholder");
    const delivery = await deliverBankOtp({ recipient, code: challenge.code, expiresAt: challenge.expiresAt, policyId: policy.id });
    const demoDelivery = process.env.ENABLE_DEMO_AUTH === "true" ? { demoCode: challenge.code } : {};
    return NextResponse.json({ challengeId: challenge.challengeId, expiresAt: new Date(challenge.expiresAt).toISOString(), delivery, ...demoDelivery });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "OTP request failed" }, { status: 409 });
  }
}
