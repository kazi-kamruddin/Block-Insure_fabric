import "server-only";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { customerEmail, CustomerStore, type CustomerRecord } from "@/lib/customers/store";
import { localCustomerCodes, onboardingEnabled } from "@/lib/customers/settings";
import { deliverBankCommunication } from "@/lib/banking/email-gateway";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { sessionCookieName, sessionSecret, sessionTtlSeconds } from "./current-session";
import { EmailCodeStore, type EmailCodePurpose } from "./email-code";
import { createSessionToken, verifySessionToken } from "./session-token";

const signupCookie = "block_insure_signup";
const signupTtl = 900;
const options = { httpOnly: true, sameSite: "strict", path: "/" } as const;
const code = z.string().regex(/^\d{6}$/);
export const requestCode = z.object({ action: z.literal("request"), email: customerEmail });
export const verifyCode = z.object({ action: z.literal("verify"), email: customerEmail, code });
export const profileFields = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[\d ()-]{7,25}$/).refine(value => value.replace(/\D/g, "").length >= 7),
  address: z.string().trim().max(250).optional(),
  dataSharing: z.literal(true),
});

export function customerResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}

export function customerGuard(request?: Request) {
  if (!onboardingEnabled()) return customerResponse({ message: "Customer onboarding is unavailable" }, 404);
  if (request) {
    const trust = checkMutationOrigin(request);
    if (!trust.trusted) return customerResponse({ message: trust.reason }, 403);
  }
}

export function codes() {
  const secret = process.env.OTP_SECRET ?? "";
  return new EmailCodeStore(secret.length >= 32 ? secret : sessionSecret());
}

type CustomerTemplate = "signup-code" | "signup-existing" | "login-code" | "email-change-code" | "kyc-approved" | "kyc-rejected";

export function queueCustomerEmail(recipient: string, template: CustomerTemplate, variables: Record<string, string> = {}) {
  if (!process.env.EMAIL_GATEWAY_URL?.trim()) return;
  after(async () => {
    try {
      await deliverBankCommunication({ recipient, template, variables });
    } catch {
      console.warn("Customer email delivery failed");
    }
  });
}

export async function sendCustomerCode(email: string, purpose: EmailCodePurpose) {
  // The dev-lite listener is loopback-only. Client-supplied proxy headers cannot
  // create extra rate-limit buckets in this single-host profile.
  const result = await codes().issue(email, "127.0.0.1", purpose);
  if (result.code === undefined) {
    return customerResponse({ message: "Too many code requests. Try again later." }, 429, { "Retry-After": String(result.retryAfter) });
  }
  const existing = (await new CustomerStore().list()).find(customer => customer.email === email);
  const variables = { code: result.code, expiresAt: new Date(result.expiresAt).toISOString() };
  if (purpose === "signup") {
    if (existing) queueCustomerEmail(email, "signup-existing");
    else queueCustomerEmail(email, "signup-code", variables);
  } else if (purpose === "login") {
    if (existing?.status === "ACTIVE" || existing?.status === "EMAIL_VERIFIED") queueCustomerEmail(email, "login-code", variables);
  } else if (!existing) queueCustomerEmail(email, "email-change-code", variables);

  return customerResponse({ message: "If this address can be used, a code will be sent.", ...(localCustomerCodes() ? { displayCode: result.code } : {}) });
}

export async function establishSignup(customer: CustomerRecord) {
  (await cookies()).set(signupCookie, createSessionToken({ accountId: `signup:${customer.email}`, role: "policyholder", subjectId: customer.memberId },
    `${sessionSecret()}:signup`, signupTtl), { ...options, secure: process.env.SESSION_COOKIE_SECURE === "true", maxAge: signupTtl });
}

export async function signupIdentity() {
  const token = (await cookies()).get(signupCookie)?.value;
  return token ? verifySessionToken(token, `${sessionSecret()}:signup`) : null;
}

export async function finishSignup() {
  (await cookies()).delete(signupCookie);
}

export async function establishCustomerSession(customer: CustomerRecord, sessionId: string) {
  const ttl = sessionTtlSeconds();
  const token = createSessionToken({ accountId: `customer:${customer.memberId}`, role: "policyholder", subjectId: customer.memberId, sessionId }, sessionSecret(), ttl);
  (await cookies()).set(sessionCookieName, token, { ...options, secure: process.env.SESSION_COOKIE_SECURE === "true", maxAge: ttl });
}
