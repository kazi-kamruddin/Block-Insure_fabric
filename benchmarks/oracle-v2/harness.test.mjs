import assert from "node:assert/strict";
import test from "node:test";
import { configurations, simulate, summarize } from "./harness.mjs";

const seed = 42;

test("all four modes receive the same eleven seeded scenarios", () => {
  const experiment = simulate({ seed, perScenario: 3, panelBudgetPercent: 50 });
  assert.equal(experiment.rows.length, 4 * 11 * 3);
  const byMode = configurations.map(({ id }) => experiment.rows.filter(row => row.mode === id));
  const cases = byMode[0].map(({ claimId, scenario, eligible }) => [claimId, scenario, eligible]);
  for (const rows of byMode) {
    assert.deepEqual(rows.map(({ claimId, scenario, eligible }) => [claimId, scenario, eligible]), cases);
    assert.equal(new Set(rows.map(row => row.scenario)).size, 11);
  }
  assert.deepEqual(simulate({ seed, perScenario: 3, panelBudgetPercent: 50 }), experiment);
});

test("only the provenance-aware mode refers otherwise agreeing dependent evidence", () => {
  const { rows } = simulate({ seed, perScenario: 1, panelBudgetPercent: 100 });
  const copies = rows.filter(row => row.scenario === "agreeing-copies");
  assert.deepEqual(copies.map(row => [row.mode, row.route, row.quorum]), [
    ["v1-shared", "AUTO_APPROVE", "CONSENSUS"],
    ["v2-single-origin", "AUTO_APPROVE", "CONSENSUS"],
    ["v2-multi-source", "AUTO_APPROVE", "CONSENSUS"],
    ["v2-provenance-aware", "PANEL_REVIEW", "CONSENSUS"],
  ]);
  assert.equal(copies.at(-1).evidenceReason, "DEPENDENT_ACCREDITATION");
  assert.equal(copies.at(-1).matchingWorkers, 2);
  assert.equal(copies.at(-1).availableAgreeingWorkers, 3);
});

test("provenance still approves clean claims, one-offline trials and undetectable consistent collusion", () => {
  const { rows } = simulate({ seed, perScenario: 1, panelBudgetPercent: 100 });
  const results = rows.filter(row => row.mode === "v2-provenance-aware");
  for (const scenario of ["clean", "one-worker-offline", "stale-mirror", "copied-commitment", "consistent-collusion"]) {
    assert.equal(results.find(row => row.scenario === scenario).route, "AUTO_APPROVE", scenario);
  }
  assert.equal(results.find(row => row.scenario === "copied-commitment").acceptedCommitments, 2);
  assert.equal(results.find(row => row.scenario === "contradictory-payment").route, "PANEL_REVIEW");
  assert.equal(results.find(row => row.scenario === "licence-or-accreditation").route, "INTEGRITY_FAIL");
});

test("fixed panel capacity creates no automatic approvals for referrals left unresolved", () => {
  const results = simulate({ seed, perScenario: 2, panelBudgetPercent: 50 });
  const summaries = summarize(results);
  assert.equal(summaries.find(row => row.mode === "v1-shared").wrongAutomaticApprovals, 13);
  const strict = summaries.find(row => row.mode === "v2-provenance-aware");
  assert.equal(strict.wrongAutomaticApprovals, 2);
  assert.equal(strict.legitimateReferrals, 1);
  assert.equal(strict.panelDemand, 12);
  assert.equal(strict.panelCapacity, 11);
  assert.equal(strict.unresolved, 1);
  const pending = results.rows.find(row => row.mode === strict.mode && row.panelStatus === "WAITLISTED");
  assert.notEqual(pending.route, "AUTO_APPROVE");
  assert.equal(pending.decisionSeconds, null);
});

test("a stale mirror plus a different concurrent fault exercises conflict and timeout", () => {
  const { rows } = simulate({ seed, perScenario: 6, panelBudgetPercent: 100 });
  for (const { id } of configurations) {
    const current = rows.filter(row => row.mode === id);
    const conflict = current.find(row => row.variant === "STALE_AND_THIRD_DISTINCT_RESULT");
    assert.equal(conflict.quorum, "CONFLICT");
    assert.equal(conflict.route, "PANEL_REVIEW");
    const timeout = current.find(row => row.variant === "STALE_AND_LATE_REVEAL");
    assert.equal(timeout.quorum, "TIMEOUT");
    assert.equal(timeout.routingSeconds, 120);
  }
});
