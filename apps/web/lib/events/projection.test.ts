import { describe, expect, it } from "vitest";
import { applyFabricEvent, emptyEventProjection, notificationsFor } from "./projection";

describe("Fabric event projection", () => {
  it("deduplicates replayed events and advances a transaction checkpoint", () => {
    const event = { id: "7:tx-1:ClaimSubmitted", blockNumber: "7", transactionId: "tx-1", eventName: "ClaimSubmitted", payload: { id: "claim-1" } };
    const once = applyFabricEvent(emptyEventProjection(), event, "2026-09-06T12:00:00Z");
    const twice = applyFabricEvent(once, event, "2026-09-06T12:01:00Z");
    expect(twice).toEqual(once);
    expect(once.checkpoint).toEqual({ blockNumber: "7", transactionId: "tx-1" });
    expect(once.countsByName.ClaimSubmitted).toBe(1);
  });

  it("routes review notifications only to assigned certificate subjects", () => {
    const projection = applyFabricEvent(emptyEventProjection(), {
      id: "8:tx-2:ClaimReviewOpened", blockNumber: "8", transactionId: "tx-2", eventName: "ClaimReviewOpened",
      payload: { id: "review-1", assignedAuditorIds: ["auditor1", "auditor2"] },
    }, "2026-09-06T12:00:00Z");
    expect(notificationsFor(projection, "auditor", "auditor1")).toHaveLength(1);
    expect(notificationsFor(projection, "auditor", "auditor4")).toHaveLength(0);
  });
});
