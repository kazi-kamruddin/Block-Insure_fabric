import { describe, expect, it } from "vitest";
import { extractInvoiceFields } from "@/lib/evidence/ocr-fields";
import { formatBdt } from "@/lib/money";
import { workflowCommandSchema, canExecute } from "@/lib/workflows/commands";
import { bdtToMinor, nonNegativeBdtToMinor } from "@/lib/workflows/forms";
import { premiumStanding } from "./premium-schedule";

const medical = { medicalRulesVersion: 1, gracePeriodDays: 15, startDate: "2026-11-21", endDate: "2027-11-20" } as const;

describe("medical premium standing mirrors the chaincode cover rules", () => {
  it("accepts a first premium until the grace period after the start date", () => {
    expect(premiumStanding({ ...medical, status: "PENDING_PAYMENT", nextPremiumDueDate: "2026-11-21" }, "2026-11-21"))
      .toMatchObject({ canPay: true, note: expect.stringContaining("day the first premium is paid") });
    expect(premiumStanding({ ...medical, status: "PENDING_PAYMENT", nextPremiumDueDate: "2026-11-21" }, "2026-11-20"))
      .toMatchObject({ canPay: true, note: "Cover begins on 2026-11-21 once the first premium is paid." });
    expect(premiumStanding({ ...medical, status: "PENDING_PAYMENT", nextPremiumDueDate: "2026-11-21" }, "2026-12-07"))
      .toMatchObject({ canPay: false, note: expect.stringContaining("paid by 2026-12-06") });
  });

  it("keeps cover continuous within grace and refuses payment after it", () => {
    const active = { ...medical, status: "ACTIVE" as const, nextPremiumDueDate: "2026-12-21" };
    expect(premiumStanding(active, "2026-12-20")).toEqual({ canPay: true, note: "" });
    expect(premiumStanding(active, "2027-01-05")).toMatchObject({ canPay: true, note: expect.stringContaining("In grace until 2027-01-05") });
    expect(premiumStanding(active, "2027-01-06")).toMatchObject({ canPay: false, note: expect.stringContaining("ended on 2027-01-05") });
  });

  it("only accepts a lapsed policy's installment on its reinstatement day", () => {
    const lapsed = { ...medical, status: "LAPSED" as const, nextPremiumDueDate: "2027-01-10", reinstatedDate: "2027-01-10" };
    expect(premiumStanding(lapsed, "2027-01-10").canPay).toBe(true);
    expect(premiumStanding(lapsed, "2027-01-11").canPay).toBe(false);
    expect(premiumStanding({ ...lapsed, reinstatedDate: "" }, "2027-01-10").canPay).toBe(false);
  });

  it("leaves non-medical products and closed policies to their own rules", () => {
    expect(premiumStanding({ ...medical, medicalRulesVersion: 0, status: "LAPSED", nextPremiumDueDate: "2026-01-01" }, "2027-01-10").canPay).toBe(true);
    expect(premiumStanding({ ...medical, status: "CANCELLED", nextPremiumDueDate: "2026-12-21" }, "2026-12-01").canPay).toBe(false);
  });
});

describe("realistic taka amounts", () => {
  it("formats amounts with thousands separators", () => {
    expect(formatBdt(30_000_000)).toBe("BDT 300,000.00");
    expect(formatBdt(125_000)).toBe("BDT 1,250.00");
    expect(formatBdt(0)).toBe("BDT 0.00");
  });

  it("accepts plain, international and lakh-grouped input", () => {
    expect(bdtToMinor("150000")).toBe(15_000_000);
    expect(bdtToMinor("150,000.00")).toBe(15_000_000);
    expect(bdtToMinor("1,50,000.00")).toBe(15_000_000);
    expect(bdtToMinor("12,50,000")).toBe(125_000_000);
    expect(bdtToMinor("1,250.50")).toBe(125_050);
    for (const malformed of ["1,2,3", "15,00", "1,5000", ",500", "1,50,00"]) expect(() => bdtToMinor(malformed)).toThrow();
    expect(nonNegativeBdtToMinor("0.00")).toBe(0);
    expect(nonNegativeBdtToMinor("25,000.00")).toBe(2_500_000);
  });

  it("reads lakh-grouped invoice totals", () => {
    expect(extractInvoiceFields("Invoice number: MED-250\nTotal due: BDT 1,90,000.00").totalBdt).toBe("190000.00");
    expect(extractInvoiceFields("Total due: BDT 190,000.00").totalBdt).toBe("190000.00");
    expect(extractInvoiceFields("Total: Tk. 85000").totalBdt).toBe("85000");
  });
});

describe("reinstatement command", () => {
  it("is an Insurer operation with a hashed reason", () => {
    const command = workflowCommandSchema.parse({ operation: "reinstatePolicy", id: "policy-1", reasonHash: "a".repeat(64) });
    expect(canExecute("insurerAdmin", command.operation)).toBe(true);
    expect(canExecute("policyholder", command.operation)).toBe(false);
    expect(() => workflowCommandSchema.parse({ operation: "reinstatePolicy", id: "policy-1", reasonHash: "short" })).toThrow();
  });
});
