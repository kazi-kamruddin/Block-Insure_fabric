import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn(async () => ({ role: "policyholder", subjectId: "holder1" })) }));
vi.mock("@/lib/security/request-origin", () => ({ checkMutationOrigin: () => ({ trusted: true }) }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { addEvidenceReference: vi.fn(), readEvidenceReference: vi.fn(), readClaim: vi.fn() } }));
vi.mock("@/lib/evidence/storage", () => ({ evidenceStorageRoot: () => "/synthetic", storeCiphertext: vi.fn(), removeCiphertext: vi.fn() }));
import { ledger } from "@/lib/fabric/ledger";
import { storeCiphertext, removeCiphertext } from "@/lib/evidence/storage";
import { POST } from "./route";
const reference = { id: "evidence-test", claimId: "claim-test", claimVersion: 1, submittedBy: "holder1", documentType: "INVOICE", contentHash: "a".repeat(64), storageReferenceHash: "b".repeat(64) };
function request() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ claimId: "claim-test", evidenceId: "evidence-test", documentType: "INVOICE", contentHash: "a".repeat(64) })) form.set(key, value);
  form.set("ciphertext", new File(["synthetic encrypted bytes"], "invoice.enc"));
  return new Request("http://localhost/api/evidence", { method: "POST", body: form });
}
describe("evidence commit uncertainty", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(removeCiphertext).mockResolvedValue(undefined);
    vi.mocked(ledger.readClaim).mockResolvedValue({ id: "claim-test", claimantId: "holder1", version: 1 } as never);
    vi.mocked(storeCiphertext).mockResolvedValue({ reference: "holder1/evidence-test.enc", referenceHash: "b".repeat(64), ciphertextHash: "c".repeat(64) });
  });
  it("retains ciphertext and recovers a valid reference after response loss", async () => {
    vi.mocked(ledger.readEvidenceReference).mockRejectedValueOnce(new Error("does not exist")).mockResolvedValue(reference as never);
    vi.mocked(ledger.addEvidenceReference).mockRejectedValue(new Error("commit response lost"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(removeCiphertext).not.toHaveBeenCalled();
  });
  it("retains bytes while commit outcome is unresolved", async () => {
    vi.mocked(ledger.readEvidenceReference).mockRejectedValue(new Error("does not exist"));
    vi.mocked(ledger.addEvidenceReference).mockRejectedValue(new Error("commit status unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(removeCiphertext).not.toHaveBeenCalled();
  });
  it("rejects another owner before writing ciphertext or invoking a transaction", async () => {
    vi.mocked(ledger.readClaim).mockResolvedValue({ claimantId: "other-holder", version: 1 } as never);
    expect((await POST(request())).status).toBe(403);
    expect(storeCiphertext).not.toHaveBeenCalled();
    expect(ledger.addEvidenceReference).not.toHaveBeenCalled();
  });
});
