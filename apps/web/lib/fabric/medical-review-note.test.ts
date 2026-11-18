import { afterEach, expect, it, vi } from "vitest";
import { openMedicalReviewNote, sealMedicalReviewNote } from "./medical-review-note";

afterEach(() => vi.unstubAllEnvs());

it("seals review messages and rejects a changed record, purpose, or key", () => {
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_NOTE_KEY", "1a".repeat(32));
  const text = "Confirm the covered service date.";
  const envelope = sealMedicalReviewNote("question", "clarification-1", text);
  expect(envelope).not.toContain(text);
  expect(sealMedicalReviewNote("question", "clarification-1", text)).not.toBe(envelope);
  expect(openMedicalReviewNote("question", "clarification-1", envelope)).toBe(text);
  expect(() => openMedicalReviewNote("question", "other", envelope)).toThrow();
  expect(() => openMedicalReviewNote("appeal", "clarification-1", envelope)).toThrow();
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_NOTE_KEY", "3a".repeat(32));
  expect(() => openMedicalReviewNote("question", "clarification-1", envelope)).toThrow();
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_NOTE_KEY", "");
  expect(() => sealMedicalReviewNote("question", "clarification-1", text)).toThrow("key is unavailable");
});
