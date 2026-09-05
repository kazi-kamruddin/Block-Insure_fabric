import { describe, expect, it } from "vitest";
import { canExecute, workflowCommandSchema } from "./commands";

describe("workflow command boundary", () => {
  it("maps operations to server-owned roles", () => {
    expect(canExecute("policyholder", "submitClaim")).toBe(true);
    expect(canExecute("policyholder", "authorizeSettlement")).toBe(false);
    expect(canExecute("bankOfficer", "confirmSettlement")).toBe(true);
  });

  it("rejects invalid hashes and monetary values before Gateway", () => {
    const parsed = workflowCommandSchema.safeParse({
      operation: "submitClaim",
      id: "claim-1",
      policyId: "policy-1",
      amountMinor: -10,
      incidentDate: "2026-09-05",
      descriptionHash: "not-a-hash",
    });

    expect(parsed.success).toBe(false);
  });
});
