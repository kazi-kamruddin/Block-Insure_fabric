import { z } from "zod";
import { currentSession, matchesActiveCustomer } from "@/lib/auth/current-session";
import { codes, customerGuard, customerResponse, profileFields, sendCustomerCode, verifyCode } from "@/lib/auth/customer-auth";
import { memberForAccount } from "@/lib/customers/member-id";
import { customerEmail, customerView, CustomerStore } from "@/lib/customers/store";

const profileAction = z.discriminatedUnion("action", [
  profileFields.extend({ action: z.literal("update") }),
  z.object({ action: z.literal("request-email"), email: customerEmail }),
  verifyCode.extend({ action: z.literal("verify-email") }),
]);
const unavailable = () => customerResponse({ message: "An active customer session is required" }, 403);

export async function GET() {
  const denied = customerGuard();
  if (denied) return denied;
  try {
    const session = await currentSession();
    const memberId = session && memberForAccount(session.accountId);
    if (!session || !memberId) return unavailable();
    const customer = await new CustomerStore().find(memberId);
    if (!customer || !matchesActiveCustomer(session, customer)) return unavailable();
    return customerResponse({ customer: customerView(customer) });
  } catch {
    return customerResponse({ message: "Customer profile is unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  const denied = customerGuard(request);
  if (denied) return denied;
  try {
    const session = await currentSession();
    const memberId = session && memberForAccount(session.accountId);
    if (!session || !memberId) return unavailable();
    const parsed = profileAction.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return customerResponse({ message: "Invalid profile request" }, 400);
    const action = parsed.data;
    const purpose = `email-change:${memberId}` as const;
    if (action.action === "request-email") return await sendCustomerCode(action.email, purpose);
    const rejectedCode = () => customerResponse({ message: "The code or email address could not be verified" }, 409);
    if (action.action === "verify-email" && !await codes().consume(action.email, purpose, action.code)) return rejectedCode();

    const outcome = await new CustomerStore().update(customers => {
      const customer = customers.find(item => item.memberId === memberId);
      if (!customer || !matchesActiveCustomer(session, customer)) return "inactive";
      if (action.action === "verify-email") {
        if (customers.some(item => item.email === action.email)) return "email-conflict";
        customer.email = action.email;
      } else {
        customer.fullName = action.fullName;
        customer.phone = action.phone;
        customer.address = action.address || undefined;
        customer.consent ??= { dataSharing: true, at: new Date().toISOString() };
      }
      return customerView(customer);
    });
    if (outcome === "inactive") return unavailable();
    if (outcome === "email-conflict") return rejectedCode();
    return customerResponse({ customer: outcome });
  } catch {
    return customerResponse({ message: "Customer profile is unavailable" }, 503);
  }
}
