import { describe, expect, it } from "vitest";
import type { AuditorDecision } from "@/lib/fabric/types";
import { canSeeDecision, visibleDecisions } from "./vote-visibility";

const vote = (id: string, reviewId: string, auditorId: string): AuditorDecision => ({
  assetType: "auditorDecision", schemaVersion: 15, id, claimId: "claim-1", reviewId, reviewRound: 1,
  auditorId, auditorIdentity: `x509::${auditorId}`, outcome: "REJECT", reasonHash: "a".repeat(64), createdAt: "2026-11-21T00:00:00Z",
});

const open = { id: "review-open", status: "OPEN" as const };
const closed = { id: "review-closed", status: "REJECTED" as const };
const decisions = [vote("d1", open.id, "auditor1"), vote("d2", open.id, "auditor2"), vote("d3", closed.id, "auditor1")];

describe("auditor vote visibility", () => {
  it("withholds open-round votes from the claimant", () => {
    expect(visibleDecisions(decisions, [open, closed], { role: "policyholder", subjectId: "policyholder1" }).map(d => d.id)).toEqual(["d3"]);
  });

  it("shows an auditor only their own vote while the round is open", () => {
    expect(visibleDecisions(decisions, [open, closed], { role: "auditor", subjectId: "auditor2" }).map(d => d.id)).toEqual(["d2", "d3"]);
    expect(canSeeDecision(decisions[0], open, { role: "auditor" })).toBe(false);
  });

  it("keeps the insurer operator tally and closed or unknown rounds", () => {
    expect(visibleDecisions(decisions, [open, closed], { role: "insurerAdmin" })).toHaveLength(3);
    expect(visibleDecisions(decisions, [], { role: "policyholder", subjectId: "policyholder1" })).toHaveLength(3);
  });
});
