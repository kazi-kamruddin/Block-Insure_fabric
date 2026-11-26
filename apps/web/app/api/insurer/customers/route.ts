import { createHash } from "node:crypto";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { customerGuard, customerResponse, queueCustomerEmail } from "@/lib/auth/customer-auth";
import { memberIdPattern } from "@/lib/customers/member-id";
import { decideCustomer, nationalIdHolder } from "@/lib/customers/onboarding";
import { CustomerStore, customerView } from "@/lib/customers/store";
import { FabricCaRequestError } from "@/lib/fabric/ca-client";

const actionSchema = z.object({ action: z.enum(["approve", "reject", "suspend", "reactivate"]), memberId: z.string().regex(memberIdPattern), reason: z.string().trim().max(500).default("") });

async function insurer() {
  const session = await currentSession().catch(() => null);
  return session?.role === "insurerAdmin" ? session : null;
}

export async function GET(request: Request) {
  const refusal = customerGuard();
  if (refusal) return refusal;
  if (!await insurer()) return customerResponse({ message: "Insurer access is required" }, 403);
  const hash = new URL(request.url).searchParams.get("patientReferenceHash");
  if (hash !== null && !/^[a-f0-9]{64}$/i.test(hash)) return customerResponse({ message: "Invalid patient reference digest" }, 400);
  try {
    const customers = await new CustomerStore().list();
    if (hash) {
      const match = customers.find(item => item.status === "ACTIVE" && createHash("sha256").update(item.memberId).digest("hex") === hash.toLowerCase());
      return customerResponse({ match: match ? { memberId: match.memberId, fullName: match.fullName, dateOfBirth: match.dateOfBirth } : null });
    }
    return customerResponse({ customers: customers.filter(item => item.status !== "EMAIL_VERIFIED").map(item => ({
      ...customerView(item), duplicateNationalIdOf: nationalIdHolder(customers, item)?.memberId,
    })) });
  } catch {
    return customerResponse({ message: "Customer approvals are temporarily unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  const refusal = customerGuard(request);
  if (refusal) return refusal;
  const session = await insurer();
  if (!session) return customerResponse({ message: "Insurer access is required" }, 403);
  const input = actionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return customerResponse({ message: "Check the customer approval fields" }, 400);
  try {
    const { action, memberId, reason } = input.data;
    const result = await decideCustomer(memberId, action, session.accountId, reason);
    if (result.outcome === "missing") return customerResponse({ message: "Customer does not exist" }, 404);
    if (result.outcome === "conflict") return customerResponse({ message: "The requested decision is unavailable at this stage" }, 409);
    if (result.outcome === "duplicate-nid") return customerResponse({ message: "Another active customer already holds this national ID" }, 409);
    const { customer, changed } = result;
    if (changed && action === "approve") queueCustomerEmail(customer.email, "kyc-approved", { memberId });
    if (changed && action === "reject") queueCustomerEmail(customer.email, "kyc-rejected");
    return customerResponse({ customer: customerView(customer), ...(action === "approve" ? { ca: customer.certificateIssued } : {}) });
  } catch (error) {
    if (error instanceof FabricCaRequestError) return customerResponse({ message: "Customer certificate issuance could not be completed", caStatus: error.status }, 502);
    return customerResponse({ message: "The customer decision could not be completed" }, 503);
  }
}
