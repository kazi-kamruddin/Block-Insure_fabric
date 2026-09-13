import { describe, expect, it } from "vitest";
import { demoAccounts, workspaceForAccount } from "./accounts";

describe("canonical role workspaces", () => {
  it("maps each server-owned account role to one route", () => {
    expect(workspaceForAccount(demoAccounts["insurer-admin"])).toBe("insurer");
    expect(workspaceForAccount(demoAccounts["policyholder-1"])).toBe("policyholder");
    expect(workspaceForAccount(demoAccounts["hospital-officer"])).toBe("hospital");
    expect(new Set([demoAccounts["hospital-officer"], demoAccounts["hospital-officer-2"], demoAccounts["hospital-officer-3"], demoAccounts["hospital-officer-4"], demoAccounts["hospital-officer-5"]].map((item) => item.fabricUserName)).size).toBe(5);
    expect(new Set([demoAccounts["hospital-officer"], demoAccounts["hospital-officer-2"], demoAccounts["hospital-officer-3"], demoAccounts["hospital-officer-4"], demoAccounts["hospital-officer-5"]].map((item) => item.subjectId)).size).toBe(5);
    expect(workspaceForAccount(demoAccounts.auditor)).toBe("auditor");
    expect(workspaceForAccount(demoAccounts["auditor-2"])).toBe("auditor");
    expect(new Set([demoAccounts.auditor, demoAccounts["auditor-2"], demoAccounts["auditor-3"], demoAccounts["auditor-4"]].map((item) => item.fabricUserName)).size).toBe(4);
    expect(workspaceForAccount(demoAccounts["bank-officer"])).toBe("bank");
  });
});
