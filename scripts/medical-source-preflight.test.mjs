import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { classifyMedicalSources } from "./medical-source-preflight.mjs";

const episodes = ["unlinked", "no-benchmark", "undated", "complete", "private-unavailable"].map((id, index) => ({
  id, hospitalId: "hospital-1", revision: 1, service: ["DIAGNOSTIC", "SURGERY", "DIAGNOSTIC", "DIAGNOSTIC", "INPATIENT"][index],
  associationStatus: index === 0 ? "PENDING" : "VERIFIED",
}));
const sources = episodes.map((episode, index) => ({
  invoice: { id: createHash("sha256").update(`fabric-medical-episode-revision-v1|${episode.id.length}:${episode.id}|1:1`).digest("hex"),
    hospitalId: episode.hospitalId }, complete: index === 3, facts: index === 3 ? { treatmentType: "DIAGNOSTIC" } : undefined,
}));

test("finds unverified association, missing benchmark and missing invoice date using readback context", () => {
  const summary = classifyMedicalSources(sources, episodes, [
    { hospitalId: "hospital-1", service: "DIAGNOSTIC" }, { hospitalId: "hospital-1", service: "INPATIENT" },
  ]);
  assert.equal(summary[0].hospitalId, "hospital-1");
  assert.equal(summary[0].sources, 5);
  assert.deepEqual(summary[0].incomplete.map(row => [row.episodeId, row.reason]), [
    ["unlinked", "UNVERIFIED_ASSOCIATION"], ["no-benchmark", "MISSING_BENCHMARK"], ["undated", "MISSING_INVOICE_DATE"],
    ["private-unavailable", "INVOICE_DATE_OR_PRIVATE_BENCHMARK_UNAVAILABLE"],
  ]);
});
