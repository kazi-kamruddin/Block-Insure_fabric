import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sessionSecret } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { otpChallenges } from "@/lib/banking/otp";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const requestSchema = z.object({ policyId: z.string().min(3).max(128), mandateId: z.string().min(3).max(128) });
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
    const [policy, mandate] = await Promise.all([
      ledger.readPolicy(parsed.data.policyId),
      ledger.readBankMandate(parsed.data.mandateId),
    ]);
    if (policy.policyholderId !== session.subjectId || mandate.ownerId !== session.subjectId
      || mandate.policyId !== policy.id || mandate.status !== "ACTIVE") {
      return NextResponse.json({ message: "The active mandate is not owned by this account" }, { status: 403 });
    }
    const ttl = Number(process.env.OTP_TTL_SECONDS ?? 300);
    const challenge = otpChallenges.issue({ ...parsed.data, subjectId: session.subjectId }, otpSecret(), ttl);
    const demoDelivery = process.env.ENABLE_DEMO_AUTH === "true" ? { demoCode: challenge.code } : {};
    return NextResponse.json({ challengeId: challenge.challengeId, expiresAt: new Date(challenge.expiresAt).toISOString(), ...demoDelivery });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "OTP request failed" }, { status: 409 });
  }
}
