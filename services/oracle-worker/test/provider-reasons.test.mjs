import test from "node:test";
import assert from "node:assert/strict";
import { describeProviderReferral } from "../src/provider-reasons.mjs";

test("provider reasons report contributions and the nearest feasible discrete single-feature change", () => {
  const artifact = { features: ["visits", "cost"], scoreScale: 1000000,
    model: { kind: "logistic", weights: [0, 2, 1], means: [10, 100], scales: [2, 10], calibration: [0, 1] } };
  const ranges = [{ min: 0, max: 20, step: 1 }, { min: 0, max: 300, step: 5 }];
  const text = describeProviderReferral(artifact, [12, 110], 750000, ranges).join("\n");
  assert.match(text, /visits: 2\.0000/);
  assert.match(text, /cost: 1\.0000/);
  assert.match(text, /visits from 12 to 10/);
  assert.match(describeProviderReferral(artifact, [10, 100], 750000, ranges).join("\n"), /below this referral cutoff/);
  assert.match(describeProviderReferral(artifact, [12, 110], 750000, [{ min: 12, max: 20, step: 1 },
    { min: 110, max: 300, step: 5 }]).join("\n"), /No feasible/);
});
