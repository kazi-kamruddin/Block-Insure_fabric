import { expect, it, vi } from "vitest";
import { ledger } from "./ledger";

const gateway = vi.hoisted(() => ({ submit: vi.fn().mockResolvedValue(new Uint8Array()) }));
vi.mock("server-only", () => ({}));
vi.mock("./gateway", () => ({ withFabricContract: vi.fn((_role, run) => run(gateway)) }));

it("accepts the empty payload from a committed private receipt summary", async () => {
  const summary = { evidenceId: "receipt-test", amountMinor: 320000 };
  await expect(ledger.recordPrivateMedicalReceipt("claim-test", summary)).resolves.toBeNull();
  expect(gateway.submit).toHaveBeenCalledOnce();
  expect(gateway.submit).toHaveBeenCalledWith("RecordMedicalOCRSummary", {
    arguments: ["claim-test"],
    transientData: { medicalOCRSummary: JSON.stringify(summary) },
  });
});
