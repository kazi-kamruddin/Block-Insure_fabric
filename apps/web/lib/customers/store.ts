import "server-only";
import path from "node:path";
import { z } from "zod";
import { memberIdPattern } from "./member-id";
import { customerStateRoot } from "./settings";
import { readJson, serialized, writeJson } from "./state-file";

export const customerEmail = z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase());
export const sealedValue = z.object({ version: z.literal(1), nonce: z.string(), ciphertext: z.string(), tag: z.string() }).strict();
const customerRecord = z.object({
  memberId: z.string().regex(memberIdPattern), email: customerEmail,
  fullName: z.string().optional(), phone: z.string().optional(), dateOfBirth: z.string().optional(),
  nidHmac: z.string().optional(), nidLast3: z.string().optional(), address: z.string().optional(),
  consent: z.object({ dataSharing: z.literal(true), at: z.string() }).optional(),
  status: z.enum(["EMAIL_VERIFIED", "PENDING_KYC", "ACTIVE", "REJECTED", "SUSPENDED"]),
  kycDecision: z.object({ by: z.string(), at: z.string(), reasonHash: z.string() }).optional(),
  createdAt: z.string(), sessionId: z.string().uuid().optional(),
  issuance: z.object({
    phase: z.enum(["PREPARED", "REGISTERED"]), secret: sealedValue,
    registerHttpStatus: z.number().int().optional(),
  }).optional(),
  certificateIssued: z.object({ registerHttpStatus: z.number().int(), enrollHttpStatus: z.number().int() }).optional(),
}).strict();

export type SealedValue = z.infer<typeof sealedValue>;
export type CustomerRecord = z.infer<typeof customerRecord>;

export function customerView(record: CustomerRecord) {
  const { memberId, email, fullName, phone, dateOfBirth, address, consent, status, nidLast3, createdAt } = record;
  return { memberId, email, fullName, phone, dateOfBirth, address, consent, status, nidLast3, createdAt };
}

export class CustomerStore {
  readonly file: string;

  constructor(root = customerStateRoot()) {
    this.file = path.join(root, "customers.json");
  }

  async list() {
    return z.array(customerRecord).parse(await readJson(this.file, []));
  }

  async find(memberId: string) {
    return (await this.list()).find(customer => customer.memberId === memberId);
  }

  async update<T>(edit: (customers: CustomerRecord[]) => T) {
    return serialized(this.file, async () => {
      const customers = await this.list();
      const result = edit(customers);
      await writeJson(this.file, z.array(customerRecord).parse(customers));
      return result;
    });
  }
}
