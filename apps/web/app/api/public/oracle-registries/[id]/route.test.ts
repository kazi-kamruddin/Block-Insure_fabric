import { afterEach, expect, it, vi } from "vitest";
import { readHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";
import { GET } from "./route";

vi.mock("@/lib/oracle/hospital-registry", () => ({ readHospitalRegistrySnapshot: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("requires the worker bearer token before reading even legacy snapshots and never caches the response", async () => {
  const token = "synthetic-registry-worker-secret-for-tests";
  vi.stubEnv("ORACLE_REGISTRY_API_TOKEN", token);
  const uri = "http://127.0.0.1:3219/api/public/oracle-registries/legacy";
  const context = { params: Promise.resolve({ id: "legacy" }) };
  const denied = await GET(new Request(uri), context);
  expect(denied.status).toBe(403);
  expect(denied.headers.get("cache-control")).toBe("no-store");
  expect(readHospitalRegistrySnapshot).not.toHaveBeenCalled();
  const snapshot = { snapshotId: "legacy", records: [] };
  vi.mocked(readHospitalRegistrySnapshot).mockResolvedValue(snapshot as never);
  const accepted = await GET(new Request(uri, { headers: { authorization: `Bearer ${token}` } }), context);
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get("cache-control")).toBe("no-store");
  expect(await accepted.json()).toEqual(snapshot);
});
