import { describe, expect, it } from "vitest";
import { medicalAppealWindowDays, medicalReleaseAvailableAt, medicalReviewCommand } from "./medical-review";

const closedAt = "2026-09-05T12:00:00Z";
const windowEnd = Date.parse(closedAt) + medicalAppealWindowDays * 86_400_000;

describe("medical reservation release", () => {
  it("accepts only a claim ID for the release command", () => {
    expect(medicalReviewCommand.safeParse({ action: "release", claimId: "claim-1" }).success).toBe(true);
    expect(medicalReviewCommand.safeParse({ action: "release", claimId: "claim-1", amountMinor: 5 }).success).toBe(false);
  });

  it("waits for the window while an appeal or recovery remains", () => {
    expect(medicalReleaseAvailableAt({ appealCount: 0 }, { status: "REJECTED", closedAt })?.getTime()).toBe(windowEnd);
    expect(medicalReleaseAvailableAt({ appealCount: 1, medicalRecoveryUsed: false }, { status: "TIMED_OUT", closedAt })?.getTime()).toBe(windowEnd);
  });

  it("is available at once when no path remains", () => {
    expect(medicalReleaseAvailableAt({ appealCount: 1 }, { status: "REJECTED", closedAt })).toBeNull();
    expect(medicalReleaseAvailableAt({ appealCount: 0, medicalRecoveryUsed: true }, { status: "ACCESS_FAILED", closedAt })).toBeNull();
  });
});
