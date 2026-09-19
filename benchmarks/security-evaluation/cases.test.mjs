import assert from "node:assert/strict";
import test from "node:test";
import { securityCases } from "./cases.mjs";

for (const [name, execute] of Object.entries(securityCases)) {
  test(`threat case: ${name}`, async () => {
    assert.ok(await execute());
  });
}
