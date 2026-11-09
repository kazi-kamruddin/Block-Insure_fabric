import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn(), sessionSecret: () => "synthetic stable workflow secret at least 32 characters" }));
vi.mock("@/lib/workflows/execute", () => ({ executeWorkflowCommand: vi.fn() }));
vi.mock("@/lib/workflows/operation-journal", () => ({ runRecoverableOperation: vi.fn() }));
import { currentSession } from "@/lib/auth/current-session";
import { executeWorkflowCommand } from "@/lib/workflows/execute";
import { runRecoverableOperation } from "@/lib/workflows/operation-journal";
import { POST } from "./route";
const command = { operation: "submitClaim", id: "claim-route", policyId: "policy-route", hospitalId: "hospital-demo", hospitalInvoiceId: "invoice-route", amountMinor: 1000, incidentDate: "2026-11-09", descriptionHash: "a".repeat(64) };
function request(extra: Record<string, string> = {}) {
  return new Request("http://localhost:3200/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "synthetic-route-request-0001", "x-workflow-deployment": "insurance-recovery-test/insurance-contract", ...extra }, body: JSON.stringify(command) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-recovery-test");
  vi.mocked(currentSession).mockResolvedValue({ accountId: "policyholder-1", subjectId: "policyholder1", role: "policyholder", issuedAt: 0, expiresAt: 9999999999 });
});
it("rejects unauthenticated, cross-site and wrong-deployment recovery before executing a ledger command", async () => {
  vi.mocked(currentSession).mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request({ origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" }))).status).toBe(403);
  expect((await POST(request({ "x-workflow-deployment": "another/contract" }))).status).toBe(409);
  expect(runRecoverableOperation).not.toHaveBeenCalled(); expect(executeWorkflowCommand).not.toHaveBeenCalled();
});
it("keeps pending and INVALID outcomes distinct from a committed result", async () => {
  vi.mocked(runRecoverableOperation).mockResolvedValueOnce({ state: "PENDING", transactionId: "tx-original" });
  let response = await POST(request()); expect(response.status).toBe(202); expect(await response.json()).not.toHaveProperty("result");
  vi.mocked(runRecoverableOperation).mockResolvedValueOnce({ state: "INVALID", transactionId: "tx-original", validationCode: 11 });
  response = await POST(request()); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ state: "INVALID", validationCode: 11 });
  vi.mocked(runRecoverableOperation).mockResolvedValueOnce({ state: "COMMITTED", result: { id: command.id }, validationCode: 0 });
  response = await POST(request({ "x-workflow-recovery": "true" })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ result: { id: command.id }, validationCode: 0 });
  expect(runRecoverableOperation).toHaveBeenLastCalledWith(expect.objectContaining({ recoverOnly: true }), expect.any(Function));
});
