import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session-token";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: Object.fromEntries([
  "listPolicyPackages", "listPolicies", "listClaims", "listEvidenceReferences", "listSettlements",
  "listEvidenceAccessRecords", "listBankMandates", "listBankAccountReferences", "listBankTransfers",
  "listPremiumPayments", "listPremiumCollections", "listBenefitRequests", "listLiabilities",
  "listClaimReviews", "listClaimAppeals", "listAuditorDecisions", "listFraudAssessments",
  "listOracleRequests", "listOracleRegistrySnapshots", "listPartnerAgreements", "listHospitalInvoices",
].map((name) => [name, vi.fn().mockResolvedValue([])])) }));

import { ledger } from "@/lib/fabric/ledger";
import { loadRoleDashboard } from "./load-dashboard";

describe("role dashboard queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the Hospital workspace without unrelated banking or claim queries", async () => {
    await loadRoleDashboard({ role: "hospitalOfficer", subjectId: "hospital-1" } as Session);
    const called = Object.entries(ledger).filter(([, fn]) => vi.isMockFunction(fn) && fn.mock.calls.length).map(([name]) => name).sort();
    expect(called).toEqual(["listHospitalInvoices", "listPartnerAgreements"]);
  });

  it.each(["insurerAdmin", "policyholder", "auditor", "bankOfficer"] as const)("retains the %s workspace while avoiding unused collections", async (role) => {
    const dashboard = await loadRoleDashboard({ role, subjectId: "subject-1" } as Session);
    expect(dashboard.title).toBeTruthy();
    expect(ledger.listEvidenceReferences).not.toHaveBeenCalled();
    expect(ledger.listOracleRegistrySnapshots).not.toHaveBeenCalled();
    expect(ledger.listHospitalInvoices).not.toHaveBeenCalled();
  });
});
