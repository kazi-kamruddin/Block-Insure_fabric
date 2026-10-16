import { describe, expect, it } from "vitest";
import { ledgerDateSchema, ledgerIdSchema } from "./validation";
import { workflowCommandSchema } from "@/lib/workflows/commands";

describe("ledger input alignment", () => {
  it("accepts the full chaincode ID range and rejects invalid keys", () => {
    for (const id of ["abc", "a".repeat(128), " claim-1 ", "request-1:oracle1"]) {
      expect(ledgerIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of ["a", "ab", "a".repeat(129), ".claim", "../claim", "claim/1"]) {
      expect(ledgerIdSchema.safeParse(id).success).toBe(false);
    }
    expect(workflowCommandSchema.safeParse({ operation: "publishPolicyPackage", id: "a".repeat(128) }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "publishPolicyPackage", id: ".." }).success).toBe(false);
  });

  it("rejects impossible calendar dates before a transaction or OTP is consumed", () => {
    expect(ledgerDateSchema.safeParse("2028-02-29").success).toBe(true);
    for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01"]) {
      expect(ledgerDateSchema.safeParse(date).success).toBe(false);
      expect(workflowCommandSchema.safeParse({ operation: "advancePolicyLifecycle", id: "policy-1", asOfDate: date }).success).toBe(false);
    }
  });
});
