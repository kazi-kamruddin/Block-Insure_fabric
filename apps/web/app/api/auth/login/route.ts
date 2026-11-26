import { randomUUID } from "node:crypto";
import { z } from "zod";
import { codes, customerGuard, customerResponse, establishCustomerSession, establishSignup, requestCode, sendCustomerCode, verifyCode } from "@/lib/auth/customer-auth";
import { CustomerStore, customerView } from "@/lib/customers/store";

const inputSchema = z.discriminatedUnion("action", [requestCode, verifyCode]);

export async function POST(request: Request) {
  const refusal = customerGuard(request);
  if (refusal) return refusal;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return customerResponse({ message: "Check the sign-in fields" }, 400);
  const input = parsed.data;
  try {
    if (input.action === "request") return await sendCustomerCode(input.email, "login");
    if (!await codes().consume(input.email, "login", input.code)) return customerResponse({ message: "Invalid or expired code" }, 401);
    const sessionId = randomUUID();
    const customer = await new CustomerStore().update(customers => {
      const record = customers.find(item => item.email === input.email);
      if (!record) return null;
      if (record.status === "EMAIL_VERIFIED") return record;
      if (record.status !== "ACTIVE") return null;
      record.sessionId = sessionId;
      return record;
    });
    if (!customer) return customerResponse({ message: "Invalid or expired code" }, 401);
    if (customer.status === "EMAIL_VERIFIED") {
      await establishSignup(customer);
      return customerResponse({ next: "complete-profile" });
    }
    await establishCustomerSession(customer, sessionId);
    return customerResponse({ customer: customerView(customer) });
  } catch {
    return customerResponse({ message: "Sign-in is temporarily unavailable" }, 503);
  }
}
