import "server-only";
import { findDemoAccount } from "./accounts";
import { memberForAccount } from "@/lib/customers/member-id";
import { CustomerStore } from "@/lib/customers/store";
import type { Session } from "./session-token";

export async function policyholderRecipient(session: Session) {
  const memberId = memberForAccount(session.accountId);
  if (!memberId) return findDemoAccount(session.accountId)?.email ?? process.env.POLICYHOLDER_OTP_EMAIL;
  const customer = await new CustomerStore().find(memberId);
  if (customer?.status === "ACTIVE" && customer.sessionId === session.sessionId) return customer.email;
}
