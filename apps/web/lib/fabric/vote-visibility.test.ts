import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditorDecision } from "@/lib/fabric/types";
import { canSeeDecision, isVoteVisible, redactVoteTallies, visibleDecisions } from "./vote-visibility";

const vote = (id: string, reviewId: string, auditorId: string): AuditorDecision => ({
  assetType: "auditorDecision", schemaVersion: 15, id, claimId: "claim-1", reviewId, reviewRound: 1,
  auditorId, auditorIdentity: `x509::${auditorId}`, outcome: "REJECT", reasonHash: "a".repeat(64), createdAt: "2026-11-21T00:00:00Z",
});

const assignedAuditorIds = ["auditor1", "auditor2"];
const open = { id: "review-open", status: "OPEN" as const, assignedAuditorIds };
const closed = { id: "review-closed", status: "REJECTED" as const, assignedAuditorIds };
const decisions = [vote("d1", open.id, "auditor1"), vote("d2", open.id, "auditor2"), vote("d3", closed.id, "auditor1")];

describe("auditor vote visibility", () => {
  it("requires vote-fetching API routes to apply the visibility boundary or return a bare acknowledgment", () => {
    const routes = readdirSync(new URL("../../app/api", import.meta.url), { recursive: true, withFileTypes: true });
    const unguarded = routes.filter(file => file.isFile() && file.name === "route.ts").filter(file => {
      const source = readFileSync(path.join(file.parentPath, file.name), "utf8");
      return /(?:\b(?:list|read)AuditorDecisions?\(|AuditorDecisionRecorded|assetType === "auditorDecision")/.test(source)
        && !/\b(?:isVoteVisible|visibleDecisions|canSeeDecision|publicWorkflowResult)\(/.test(source);
    });
    expect(unguarded.map(file => path.join(file.parentPath, file.name))).toEqual([]);
  });
  it("withholds open-round votes from the claimant", () => {
    expect(visibleDecisions(decisions, [open, closed], { role: "policyholder", subjectId: "policyholder1" }).map(d => d.id)).toEqual(["d3"]);
  });

  it("withholds individual votes even from their authors while the round is open", () => {
    expect(visibleDecisions(decisions, [open, closed], { role: "auditor", subjectId: "auditor2" }).map(d => d.id)).toEqual(["d3"]);
    expect(canSeeDecision(decisions[0], open, { role: "auditor" })).toBe(false);
  });

  it("allows only known closed rounds, scoped to the auditor's assignments", () => {
    expect(visibleDecisions(decisions, [open, closed], { role: "insurerAdmin" })).toHaveLength(1);
    expect(visibleDecisions(decisions, [], { role: "policyholder", subjectId: "policyholder1" })).toHaveLength(0);
    expect(isVoteVisible(closed, { role: "auditor", subjectId: "auditor3" })).toBe(false);
  });

  it("redacts open tallies, with final totals across closed rounds", () => {
    const tallies = { votesCast: 2, approvals: 1, rejections: 1 };
    const viewer = { role: "insurerAdmin" } as const;
    expect(redactVoteTallies({ ...open, ...tallies }, viewer)).toMatchObject({ votesCast: 0, approvals: 0, rejections: 0 });
    expect(redactVoteTallies({ ...closed, ...tallies }, viewer)).toMatchObject(tallies);
  });
});
