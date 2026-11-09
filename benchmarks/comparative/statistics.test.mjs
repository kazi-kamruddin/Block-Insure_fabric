import assert from "node:assert/strict";
import test from "node:test";
import { confidenceInterval95, mean, median, percentile, sampleStandardDeviation } from "./statistics.mjs";

test("comparative statistics produce deterministic paper metrics", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);
  assert.equal(Number(sampleStandardDeviation([1, 2, 3]).toFixed(6)), 1);
  assert.deepEqual(confidenceInterval95([2, 2, 2]), { lower: 2, upper: 2, margin: 0 });
});
