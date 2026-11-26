import { afterEach, expect, it, vi } from "vitest";
import { ledger } from "@/lib/fabric/ledger";
import { POST } from "./route";

vi.mock("@/lib/fabric/ledger", () => ({ ledger: { listPremiumCollections: vi.fn() } }));
vi.mock("@/lib/banking/collections", () => ({ processDueCollection: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("rejects cross-site collection commands and preserves bearer-only worker requests", async () => {
  const token = "synthetic-collections-worker-secret";
  vi.stubEnv("BANKING_WORKER_SECRET", token);
  const request = (origin?: string) => new Request("http://localhost:3219/api/internal/banking/collections", {
    method: "POST",
    body: JSON.stringify({ action: "listDue", asOfDate: "2026-11-25" }),
    headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
  });
  expect((await POST(request("https://elsewhere.example.invalid"))).status).toBe(403);
  expect(ledger.listPremiumCollections).not.toHaveBeenCalled();
  vi.mocked(ledger.listPremiumCollections).mockResolvedValue([]);
  expect((await POST(request())).status).toBe(200);
});
