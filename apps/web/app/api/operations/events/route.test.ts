import { expect, it, vi } from "vitest";
import { currentSession } from "@/lib/auth/current-session";
import { emptyEventProjection } from "@/lib/events/projection";
import { readEventProjection } from "@/lib/events/store";
import { ledger } from "@/lib/fabric/ledger";
import type { ClaimReview } from "@/lib/fabric/types";
import { GET } from "./route";

vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/events/store", () => ({ readEventProjection: vi.fn() }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { listClaimReviews: vi.fn() } }));

it("hides open and unreadable vote events and their aggregate count", async () => {
  vi.mocked(currentSession).mockResolvedValue({ role: "insurerAdmin", accountId: "insurer-admin", issuedAt: 0, expiresAt: 1 });
  const eventName = "AuditorDecisionRecorded";
  vi.mocked(readEventProjection).mockResolvedValue({
    ...emptyEventProjection(),
    countsByName: { [eventName]: 3 },
    events: ["open", "closed", "missing"].map(reviewId => ({
      id: reviewId, eventName, blockNumber: "1", transactionId: reviewId, payload: { reviewId, outcome: "REJECT" },
    })),
  });
  vi.mocked(ledger.listClaimReviews).mockResolvedValue([
    { id: "open", status: "OPEN" }, { id: "closed", status: "REJECTED" },
  ] as ClaimReview[]);
  const request = new Request("http://localhost:3219/api/operations/events");
  const response = await GET(request);
  expect(await response.json()).toMatchObject({ countsByName: {}, events: [{ id: "closed" }] });
  vi.mocked(ledger.listClaimReviews).mockRejectedValue(new Error("peer unavailable"));
  expect(await (await GET(request)).json()).toMatchObject({ events: [] });
});
