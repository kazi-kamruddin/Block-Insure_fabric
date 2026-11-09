import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session-token";

vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { readPolicy: vi.fn() } }));

import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { GET } from "./route";

describe("policy statement authorization", () => {
  beforeEach(() => vi.resetAllMocks());
  const get = () => GET(new Request("http://localhost/api/policies/policy-1/statement"), { params: Promise.resolve({ id: "policy-1" }) });

  it.each(["hospitalOfficer", "bankOfficer"] as const)("denies %s before reading policy or clinical data", async (role) => {
    vi.mocked(currentSession).mockResolvedValue({ role } as Session);
    expect((await get()).status).toBe(403);
    expect(ledger.readPolicy).not.toHaveBeenCalled();
  });

  it("denies another policyholder's statement", async () => {
    vi.mocked(currentSession).mockResolvedValue({ role: "policyholder", subjectId: "holder-1" } as Session);
    vi.mocked(ledger.readPolicy).mockResolvedValue({ policyholderId: "holder-2" } as Awaited<ReturnType<typeof ledger.readPolicy>>);
    expect((await get()).status).toBe(403);
  });

  it("requires authentication", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(ledger.readPolicy).not.toHaveBeenCalled();
  });
});
