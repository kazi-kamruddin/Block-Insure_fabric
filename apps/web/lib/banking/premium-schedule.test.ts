import { describe, expect, it } from "vitest";
import type { BankAccountReference } from "@/lib/fabric/types";
import { canExecute, workflowCommandSchema } from "@/lib/workflows/commands";
import { applyFabricEvent, emptyEventProjection, notificationsFor } from "@/lib/events/projection";
import { choosePremiumAccount, dhakaToday, installmentEnd, maskAccountNumber, nextInstallment } from "./premium-schedule";

function account(overrides: Partial<BankAccountReference>): BankAccountReference {
  return {
    assetType: "bankAccountReference", schemaVersion: 15, id: "account", bankId: "bank-demo", ownerId: "insurer", accountType: "INSURER",
    accountLabel: "Reserve", maskedAccount: "**** 0001", currency: "BDT", balanceMinor: 0, status: "VERIFIED",
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...overrides,
  } as BankAccountReference;
}

describe("premium schedule helpers", () => {
  it("ends an installment after the interval, capped by later limits", () => {
    expect(installmentEnd("2026-01-01", 30, [])).toBe("2026-01-30");
    expect(installmentEnd("2026-01-31", 30, ["2026-12-31"])).toBe("2026-03-01");
    expect(installmentEnd("2026-12-15", 30, ["2026-12-31", "2026-12-20"])).toBe("2026-12-20");
    expect(installmentEnd("2026-01-01", 0, [])).toBe("2026-01-30");
  });

  it("starts the next installment at the next due date or the policy start", () => {
    expect(nextInstallment({ startDate: "2026-11-20", endDate: "2027-01-18", premiumMinor: 100, nextPremiumDueDate: "" }))
      .toEqual({ start: "2026-11-20", end: "2026-12-19", amountMinor: 100 });
    expect(nextInstallment({ startDate: "2026-11-20", endDate: "2026-12-31", premiumMinor: 100, nextPremiumDueDate: "2026-12-20" }))
      .toEqual({ start: "2026-12-20", end: "2026-12-31", amountMinor: 100 });
    expect(nextInstallment({ startDate: "2026-11-20", endDate: "2026-12-31", premiumMinor: 100, nextPremiumDueDate: "2027-01-01" })).toBeNull();
  });

  it("prefers the configured, then the premium-labelled, Insurer account at the same Bank", () => {
    const accounts = [
      account({ id: "reserve", accountLabel: "Synthetic medical reserve", createdAt: "2026-11-21T00:00:00Z" }),
      account({ id: "premium", accountLabel: "Synthetic medical premium", createdAt: "2026-11-20T00:00:00Z" }),
      account({ id: "other-bank", bankId: "bank-other", accountLabel: "Premium" }),
      account({ id: "customer", ownerId: "policyholder1", accountType: "CUSTOMER", accountLabel: "Premium savings" }),
    ];
    expect(choosePremiumAccount(accounts, "bank-demo")?.id).toBe("premium");
    expect(choosePremiumAccount(accounts, "bank-demo", "reserve")?.id).toBe("reserve");
    expect(choosePremiumAccount(accounts, "bank-demo", "missing")?.id).toBe("premium");
    expect(choosePremiumAccount(accounts, "bank-none")).toBeNull();
  });

  it("masks account digits and uses the Dhaka calendar day", () => {
    expect(maskAccountNumber("12-34")).toBe("**** 1234");
    expect(() => maskAccountNumber("1")).toThrow("last 2 to 6 digits");
    expect(dhakaToday(new Date("2026-11-21T17:59:00Z"))).toBe("2026-11-21");
    expect(dhakaToday(new Date("2026-11-21T18:00:00Z"))).toBe("2026-11-22");
  });
});

describe("bank link and retry commands", () => {
  it("keeps link requests with the customer and reviews with the Bank", () => {
    expect(canExecute("policyholder", "requestBankAccountLink")).toBe(true);
    expect(canExecute("policyholder", "reviewBankAccountLink")).toBe(false);
    expect(canExecute("bankOfficer", "reviewBankAccountLink")).toBe(true);
    expect(canExecute("insurerAdmin", "retryPremiumCollection")).toBe(true);
    expect(canExecute("bankOfficer", "retryPremiumCollection")).toBe(false);
    expect(canExecute("insurerAdmin", "schedulePremiumCollections")).toBe(true);
  });

  it("accepts only masked account numbers in a link request", () => {
    const base = { operation: "requestBankAccountLink", id: "bank-link-1", bankId: "bank-demo", accountLabel: "Savings" };
    expect(workflowCommandSchema.safeParse({ ...base, maskedAccount: "**** 1234" }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ ...base, maskedAccount: "1234567890" }).success).toBe(false);
    expect(workflowCommandSchema.safeParse({ operation: "reviewBankAccountLink", id: "bank-link-1", outcome: "REJECT", decisionHash: "a".repeat(64) }).success).toBe(true);
  });

  it("notifies the Bank of a link request and the customer of the outcome", () => {
    const requested = applyFabricEvent(emptyEventProjection(), {
      id: "1:link:BankAccountLinkRequested", blockNumber: "1", transactionId: "link", eventName: "BankAccountLinkRequested",
      payload: { id: "bank-link-1", ownerId: "policyholder1", maskedAccount: "**** 1234", status: "PENDING" },
    }, "2026-11-21T00:00:00Z");
    expect(notificationsFor(requested, "bankOfficer")).toEqual([expect.objectContaining({ title: "Account link requested for **** 1234" })]);
    const reviewed = applyFabricEvent(requested, {
      id: "2:review:BankAccountLinkReviewed", blockNumber: "2", transactionId: "review", eventName: "BankAccountLinkReviewed",
      payload: { id: "bank-link-1", ownerId: "policyholder1", bankId: "bank-demo", maskedAccount: "**** 1234", status: "LINKED" },
    }, "2026-11-21T00:01:00Z");
    expect(notificationsFor(reviewed, "policyholder", "policyholder1")).toEqual([expect.objectContaining({ title: "Bank linked account **** 1234" })]);
    expect(notificationsFor(reviewed, "policyholder", "policyholder2")).toHaveLength(0);
    expect(reviewed.communications).toEqual([expect.objectContaining({ template: "bank-link-status", recipientSubject: "policyholder1" })]);
  });
});
