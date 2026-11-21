import { randomBytes } from "node:crypto";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const memberIdPattern = /^BI-[0-9A-HJKMNP-TV-Z]{8}$/;

export function newMemberId(existing: ReadonlySet<string>) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const id = `BI-${Array.from(randomBytes(8), byte => alphabet[byte & 31]).join("")}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("A unique member ID could not be allocated");
}

export function memberForAccount(accountId: string) {
  if (!accountId.startsWith("customer:")) return undefined;
  const memberId = accountId.slice("customer:".length);
  return memberIdPattern.test(memberId) ? memberId : undefined;
}
