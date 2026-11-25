import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { readHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  listOracleRegistrySnapshots: vi.fn(), readOracleRegistrySnapshot: vi.fn(), attestMedicalRegistrySnapshot: vi.fn(),
  listMedicalOracleSources: vi.fn(),
} }));
vi.mock("@/lib/oracle/hospital-registry", () => ({
  readHospitalRegistrySnapshot: vi.fn(), registryDigest: (value: string) => createHash("sha256").update(value).digest("hex"),
}));

const rootHash = "c043670d51320bc6b8adb0b6a776951b78ff1d69186e840b523bc07d2fd9aa72";
const proposal = { id: "registry-hospital-v2", hospitalId: "hospital-demo", version: 2, rootHash };
const url = "http://127.0.0.1:3219/api/medical/registry";

function asHospital(subjectId: string) {
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  vi.mocked(currentSession).mockResolvedValue({ role: "hospitalOfficer", subjectId, accountId: subjectId, issuedAt: 0, expiresAt: 1 });
  vi.mocked(ledger.listOracleRegistrySnapshots).mockResolvedValue([proposal] as never);
  vi.mocked(ledger.readOracleRegistrySnapshot).mockResolvedValue(proposal as never);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("does not read another hospital's proposal file", async () => {
  asHospital("hospital-2");
  expect((await GET(new Request(url + "?manifest=" + proposal.id))).status).toBe(404);
  expect(readHospitalRegistrySnapshot).not.toHaveBeenCalled();
});

it("returns only the incomplete source count for the selected hospital to the insurer", async () => {
  asHospital("hospital-demo");
  const request = () => new Request(url + "?checkSources=hospital-demo");
  expect((await GET(request())).status).toBe(403);
  expect(ledger.listMedicalOracleSources).not.toHaveBeenCalled();
  vi.mocked(currentSession).mockResolvedValue({ role: "insurerAdmin", accountId: "insurer-admin", issuedAt: 0, expiresAt: 1 });
  vi.mocked(ledger.listMedicalOracleSources).mockResolvedValue([
    { invoice: { id: "private-one", hospitalId: "hospital-demo" }, complete: false },
    { invoice: { id: "private-two", hospitalId: "hospital-demo" }, complete: true },
    { invoice: { id: "private-three", hospitalId: "hospital-2" }, complete: false },
  ] as never);
  expect(await (await GET(request())).json()).toEqual({ incompleteCount: 1 });
});

it("refuses an attestation using the displayed root when the actual record differs", async () => {
  asHospital("hospital-demo");
  vi.mocked(readHospitalRegistrySnapshot).mockResolvedValue({
    snapshotId: proposal.id, version: 2, rulesVersion: "hospital-invoice-rules-v2", rulesHash: "d".repeat(64), rootHash,
    records: [{
      invoiceId: "invoice-fixture", patientReferenceHash: "a".repeat(64), lookupHash: "b".repeat(64), hospitalId: "hospital-demo",
      treatmentCode: "HOSPITAL_INVOICE", minimumAmountMinor: 1, maximumAmountMinor: 1005,
      validFrom: "2026-11-24", validThrough: "2026-11-24", descriptionHash: "c".repeat(64), status: "VALID",
    }],
  } as never);
  const response = await POST(new Request(url, {
    method: "POST", body: JSON.stringify({ action: "attest", id: proposal.id, rootHash }),
  }));
  expect(response.status).toBe(409);
  expect(ledger.attestMedicalRegistrySnapshot).not.toHaveBeenCalled();
});
