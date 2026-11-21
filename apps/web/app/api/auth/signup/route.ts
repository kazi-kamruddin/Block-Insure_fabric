import { z } from "zod";
import { codes, customerGuard, customerResponse, establishSignup, finishSignup, profileFields, requestCode, sendCustomerCode, signupIdentity, verifyCode } from "@/lib/auth/customer-auth";
import { newMemberId } from "@/lib/customers/member-id";
import { nationalIdFields } from "@/lib/customers/pii";
import { CustomerStore, customerView, type CustomerRecord } from "@/lib/customers/store";

const inputSchema = z.discriminatedUnion("action", [requestCode, verifyCode, profileFields.extend({
  action: z.literal("profile"), dateOfBirth: z.iso.date().refine(value => value < new Date().toISOString().slice(0, 10)),
  nid: z.string().trim().regex(/^(?:\d{10}|\d{13}|\d{17})$/),
})]);

export async function POST(request: Request) {
  const refusal = customerGuard(request);
  if (refusal) return refusal;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return customerResponse({ message: "Check the signup fields" }, 400);
  const input = parsed.data;
  try {
    if (input.action === "request") return await sendCustomerCode(input.email, "signup");
    const store = new CustomerStore();
    if (input.action === "verify") {
      if (!await codes().consume(input.email, "signup", input.code)) return customerResponse({ message: "Invalid or expired code" }, 401);
      const customer = await store.update(customers => {
        if (customers.some(item => item.email === input.email)) return null;
        const record: CustomerRecord = { email: input.email, memberId: newMemberId(new Set(customers.map(item => item.memberId))), status: "EMAIL_VERIFIED", createdAt: new Date().toISOString() };
        customers.push(record);
        return record;
      });
      if (!customer) return customerResponse({ message: "Invalid or expired code" }, 401);
      await establishSignup(customer);
      return customerResponse({ message: "Email verified" });
    }

    const proof = await signupIdentity();
    if (!proof) return customerResponse({ message: "Verify your email before submitting a profile" }, 401);
    const customer = await store.update(customers => {
      const record = customers.find(item => item.memberId === proof.subjectId && proof.accountId === `signup:${item.email}`);
      if (!record || record.status !== "EMAIL_VERIFIED") return null;
      const now = new Date().toISOString();
      const { fullName, phone, dateOfBirth, address, nid } = input;
      Object.assign(record, { fullName, phone, dateOfBirth, address, ...nationalIdFields(nid), consent: { dataSharing: true, at: now }, status: "PENDING_KYC" });
      return record;
    });
    if (!customer) return customerResponse({ message: "This profile cannot be submitted" }, 409);
    await finishSignup();
    return customerResponse({ customer: customerView(customer) });
  } catch {
    return customerResponse({ message: "Signup is temporarily unavailable" }, 503);
  }
}
