import { expect, it } from "vitest";
import { readMedicalAppealWindow } from "./medical-review";

it("uses the last committed ledger time and fails closed if it cannot be read", () => {
  const closed = "2026-10-25T10:00:00Z";
  const deadline = Date.parse("2026-11-24T10:00:00Z");
  expect(readMedicalAppealWindow(deadline - 1, closed)).toEqual({ endsAt: deadline, canAppeal: true });
  expect(readMedicalAppealWindow(deadline, closed).canAppeal).toBe(false);
  expect(readMedicalAppealWindow(null, closed).canAppeal).toBe(false);
});
