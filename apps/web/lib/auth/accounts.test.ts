import { describe, expect, it } from "vitest";
import { demoAccounts, workspaceForAccount } from "./accounts";

describe("canonical role workspaces", () => {
  it("maps each server-owned account role to one route", () => {
    expect(workspaceForAccount(demoAccounts["insurer-admin"])).toBe("insurer");
    expect(workspaceForAccount(demoAccounts["policyholder-1"])).toBe("policyholder");
    expect(workspaceForAccount(demoAccounts["hospital-officer"])).toBe("hospital");
    expect(workspaceForAccount(demoAccounts.auditor)).toBe("auditor");
    expect(workspaceForAccount(demoAccounts["bank-officer"])).toBe("bank");
  });
});
