import { expect, it } from "vitest";
import { medicalReviewCommand, readMedicalAppealWindow } from "./medical-review";

it("uses the last committed ledger time and fails closed if it cannot be read", () => {
  const closed = "2026-10-25T10:00:00Z";
  const deadline = Date.parse("2026-11-24T10:00:00Z");
  expect(readMedicalAppealWindow(deadline - 1, closed)).toEqual({ endsAt: deadline, canAppeal: true });
  expect(readMedicalAppealWindow(deadline, closed).canAppeal).toBe(false);
  expect(readMedicalAppealWindow(null, closed).canAppeal).toBe(false);
});

it("uses a pinned DEMO appeal deadline and asks the ledger for new review defaults", () => {
  const closed = "2026-11-25T10:00:00Z";
  const deadline = "2026-11-25T10:30:00Z";
  expect(readMedicalAppealWindow(Date.parse(deadline), closed, deadline)).toEqual({
    endsAt: Date.parse(deadline), canAppeal: false,
  });
  expect(medicalReviewCommand.safeParse({ action: "open", reviewId: "review-one", deadline: "" }).success).toBe(true);
});
