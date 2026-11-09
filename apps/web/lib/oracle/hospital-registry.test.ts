import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HospitalInvoice, OracleRegistrySnapshot } from "@/lib/fabric/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/events/state-file", () => ({ persistJsonFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  listHospitalInvoices: vi.fn(), listOracleRegistrySnapshots: vi.fn(), publishOracleRegistrySnapshot: vi.fn(), readHospitalModelFacts: vi.fn(),
} }));

import { ledger } from "@/lib/fabric/ledger";
import { persistJsonFile } from "@/lib/events/state-file";
import { refreshHospitalRegistrySnapshot } from "./hospital-registry";

describe("Hospital registry publication", () => {
  let invoices: HospitalInvoice[];
  let published: OracleRegistrySnapshot[];
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    invoices = [{ id: "invoice-1", hospitalId: "hospital-1", patientReferenceHash: "a".repeat(64),
      invoiceReferenceHash: "b".repeat(64), treatmentHash: "c".repeat(64), amountMinor: 10_000,
      admissionDate: "2026-01-01", dischargeDate: "2026-01-02", status: "FINALIZED" } as HospitalInvoice];
    published = [];
    vi.mocked(ledger.listHospitalInvoices).mockImplementation(async () => structuredClone(invoices));
    vi.mocked(ledger.listOracleRegistrySnapshots).mockImplementation(async () => structuredClone(published));
    vi.mocked(ledger.publishOracleRegistrySnapshot).mockImplementation(async (input) => {
      if (published.some((item) => item.id === input.id)) throw new Error("snapshot already exists");
      const snapshot = { ...input, assetType: "oracleRegistrySnapshot" } as OracleRegistrySnapshot;
      published.push(snapshot);
      return snapshot;
    });
  });

  it("serializes concurrent requests and reuses unchanged invoice facts", async () => {
    const [first, second] = await Promise.all([refreshHospitalRegistrySnapshot(), refreshHospitalRegistrySnapshot()]);
    expect(first?.snapshotId).toBe("registry-hospital-v1");
    expect(second).toEqual(first);
    expect(ledger.publishOracleRegistrySnapshot).toHaveBeenCalledTimes(1);
    invoices[0].amountMinor += 100;
    const [third, fourth] = await Promise.all([refreshHospitalRegistrySnapshot(), refreshHospitalRegistrySnapshot()]);
    expect(third?.snapshotId).toBe("registry-hospital-v2");
    expect(fourth).toEqual(third);
    expect(third?.rootHash).not.toBe(first?.rootHash);
    expect(ledger.publishOracleRegistrySnapshot).toHaveBeenCalledTimes(2);
  });

  it("recovers its queue after a failed publication", async () => {
    vi.mocked(ledger.publishOracleRegistrySnapshot).mockRejectedValueOnce(new Error("endorsement failed"));
    await expect(refreshHospitalRegistrySnapshot()).rejects.toThrow("endorsement failed");
    expect((await refreshHospitalRegistrySnapshot())?.version).toBe(1);
  });

  it("does not publish an empty registry", async () => {
    invoices = [];
    expect(await refreshHospitalRegistrySnapshot()).toBeNull();
    expect(persistJsonFile).not.toHaveBeenCalled();
    expect(ledger.publishOracleRegistrySnapshot).not.toHaveBeenCalled();
  });

  it("pins private explicit model facts and marks unavailable history without inventing records", async () => {
    vi.stubEnv("FABRIC_XGBOOST_ENABLED", "true");
    vi.stubEnv("ORACLE_REGISTRY_API_TOKEN", "test-token-never-deploy-000000000000000000");
    vi.mocked(ledger.readHospitalModelFacts).mockRejectedValueOnce(new Error("private facts does not exist"));
    const unavailable = await refreshHospitalRegistrySnapshot();
    expect(unavailable?.modelContext?.incompleteInvoiceIds).toEqual(["invoice-1"]);
    vi.mocked(ledger.readHospitalModelFacts).mockResolvedValue({ invoiceId: "invoice-1", treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: "2026-01-02", expectedMinMinor: 100, expectedMaxMinor: 20000, licenseStatus: "ACTIVE" });
    const available = await refreshHospitalRegistrySnapshot();
    expect(available?.rootHash).not.toBe(unavailable?.rootHash);
    expect(available?.modelContext?.incompleteInvoiceIds).toEqual([]);
    expect(available?.modelContext?.records[0]).toMatchObject({ patientIssuerMsp: "InsurerMSP", hospitalMsp: "HospitalMSP", patientReferenceHash: invoices[0].patientReferenceHash });
    vi.unstubAllEnvs();
  });
});
