import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session-token";

vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { listPolicies: vi.fn(), listClaims: vi.fn() } }));
vi.mock("@/lib/events/store", () => ({ readEventProjection: vi.fn() }));

import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { readEventProjection } from "@/lib/events/store";
import { applyFabricEvent, emptyEventProjection } from "@/lib/events/projection";
import { GET } from "./route";

describe("policyholder notification ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(currentSession).mockResolvedValue({ role: "policyholder", subjectId: "owner" } as Session);
  });

  it("filters events using ledger ownership instead of broadcasting a role", async () => {
    let projection = emptyEventProjection();
    for (const id of ["claim-owned", "claim-other"]) {
      projection = applyFabricEvent(projection, { id, eventName: "ClaimHospitalVerified", blockNumber: "1", transactionId: id, payload: { claimId: id } }, "now");
    }
    vi.mocked(readEventProjection).mockResolvedValue(projection);
    vi.mocked(ledger.listPolicies).mockResolvedValue([]);
    vi.mocked(ledger.listClaims).mockResolvedValue([
      { id: "claim-owned", claimantId: "owner" }, { id: "claim-other", claimantId: "other" },
    ] as Awaited<ReturnType<typeof ledger.listClaims>>);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).notifications.map((item: { assetId: string }) => item.assetId)).toEqual(["claim-owned"]);
  });

  it("avoids ledger queries when there are no unscoped notices", async () => {
    vi.mocked(readEventProjection).mockResolvedValue(emptyEventProjection());
    expect((await GET()).status).toBe(200);
    expect(ledger.listClaims).not.toHaveBeenCalled();
    expect(ledger.listPolicies).not.toHaveBeenCalled();
  });

  it("does not expose unscoped notices when ownership cannot be checked", async () => {
    vi.mocked(readEventProjection).mockResolvedValue(applyFabricEvent(emptyEventProjection(), {
      id: "event-1", eventName: "ClaimHospitalVerified", blockNumber: "1", transactionId: "tx-1", payload: { claimId: "claim-other" },
    }, "now"));
    vi.mocked(ledger.listPolicies).mockResolvedValue([]);
    vi.mocked(ledger.listClaims).mockRejectedValue(new Error("peer unavailable"));
    expect((await GET()).status).toBe(503);
  });
});
