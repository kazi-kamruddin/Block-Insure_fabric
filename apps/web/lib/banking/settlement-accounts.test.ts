import { describe, expect, it } from "vitest";
import type { BankAccountReference } from "@/lib/fabric/types";
import { suggestSettlementAccounts } from "./settlement-accounts";

const account = (id: string, fields: Partial<BankAccountReference>): BankAccountReference => ({
  assetType: "bankAccountReference", schemaVersion: 1, id, bankId: "bank-demo", ownerId: "insurer", accountType: "INSURER",
  accountLabel: "Premium", maskedAccount: "**** 0001", accountTokenHash: "a".repeat(64), currency: "BDT", balanceMinor: 0,
  status: "VERIFIED", createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z", ...fields,
});

describe("payout account suggestion", () => {
  const accounts = [
    account("premium", { accountLabel: "Insurer premium account", balanceMinor: 900_000_000 }),
    account("reserve-small", { accountLabel: "Claims reserve", balanceMinor: 3_600_000 }),
    account("reserve-main", { accountLabel: "Block-Insure claims reserve", balanceMinor: 500_000_000 }),
    account("other-bank-reserve", { bankId: "bank-other", accountLabel: "Claims reserve", balanceMinor: 999_000_000 }),
    account("old-customer", { ownerId: "BI-7K3Q9XM0", accountType: "CUSTOMER", createdAt: "2026-11-01T00:00:00Z" }),
    account("new-customer", { ownerId: "BI-7K3Q9XM0", accountType: "CUSTOMER", createdAt: "2026-11-21T10:00:00Z" }),
    account("disabled-customer", { ownerId: "BI-7K3Q9XM0", accountType: "CUSTOMER", status: "DISABLED", createdAt: "2026-11-22T00:00:00Z" }),
    account("someone-else", { ownerId: "BI-00000000", accountType: "CUSTOMER", createdAt: "2026-11-23T00:00:00Z" }),
  ];

  it("pays from the funded claims reserve to the claimant's newest verified account at the policy's Bank", () => {
    expect(suggestSettlementAccounts(accounts, ["bank-demo"], "BI-7K3Q9XM0")).toMatchObject({
      bankId: "bank-demo", source: { id: "reserve-main" }, destination: { id: "new-customer" },
    });
  });

  it("finds nothing when the claimant has no verified account at a policy Bank", () => {
    expect(suggestSettlementAccounts(accounts, ["bank-other"], "BI-7K3Q9XM0")).toBeNull();
    expect(suggestSettlementAccounts(accounts, ["bank-demo"], "BI-NOBODY00")).toBeNull();
  });
});
