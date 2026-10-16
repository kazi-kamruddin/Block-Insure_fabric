import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HospitalInvoice, OracleRegistrySnapshot } from "@/lib/fabric/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/events/state-file", () => ({ persistJsonFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  listHospitalInvoices: vi.fn(), listOracleRegistrySnapshots: vi.fn(), publishOracleRegistrySnapshot: vi.fn(),
} }));

import { ledger } from "@/lib/fabric/ledger";
import { persistJsonFile } from "@/lib/events/state-file";
import { refreshHospitalRegistrySnapshot } from "./hospital-registry";

describe("Hospital registry publication", () => {
  let invoices: HospitalInvoice[];
  let published: OracleRegistrySnapshot[];
  beforeEach(() => {
    vi.resetAllMocks();
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
});
