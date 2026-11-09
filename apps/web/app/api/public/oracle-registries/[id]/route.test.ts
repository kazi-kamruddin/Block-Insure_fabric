import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/oracle/hospital-registry", () => ({ readHospitalRegistrySnapshot: vi.fn() }));
import { readHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "registry-hospital-v1" }) };
describe("private model context transport", () => {
  afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
  it("denies anonymous/wrong-token access and returns no-store for authorized context", async () => {
    vi.mocked(readHospitalRegistrySnapshot).mockResolvedValue({ modelContext: { records: [{ diagnosisCode: "private" }] } } as never);
    vi.stubEnv("ORACLE_REGISTRY_API_TOKEN", "synthetic-test-token-000000000000000000");
    expect((await GET(new Request("http://localhost/registry"), context)).status).toBe(403);
    expect((await GET(new Request("http://localhost/registry", { headers: { authorization: "Bearer wrong" } }), context)).status).toBe(403);
    const response = await GET(new Request("http://localhost/registry", { headers: { authorization: `Bearer ${process.env.ORACLE_REGISTRY_API_TOKEN}` } }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("preserves public access to historical nonclinical registry snapshots", async () => {
    vi.mocked(readHospitalRegistrySnapshot).mockResolvedValue({ snapshotId: "registry-hospital-v1" } as never);
    expect((await GET(new Request("http://localhost/registry"), context)).status).toBe(200);
  });
});
