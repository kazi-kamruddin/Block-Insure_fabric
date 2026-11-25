import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { phase3Scenarios } from "./fixtures.mjs";
import { simulate, summarize } from "./harness.mjs";

const { values } = parseArgs({ options: { date: { type: "string" }, output: { type: "string" } } });
const date = values.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use --date YYYY-MM-DD");
const budgets = [25, 50, 75, 100];
const adviceModes = ["fixed-auto", "frozen"];
const reports = [];
const heads = [];
for (const advice of adviceModes) {
  const experiments = budgets.map(panelBudgetPercent => simulate({ extended: true, advice, panelBudgetPercent }));
  const primary = experiments.find(run => run.panelBudgetPercent === 50);
  const modelReview = primary.rows.filter(row => row.mode === "v2-provenance-aware" && row.modelAdvice === "REVIEW").length;
  const perScenario = phase3Scenarios.map(scenario => {
    const label = scenario.id === "agreeing-copies" ? "Synthetic lineage stress case" : scenario.label;
    const rows = summarize(primary, scenario.id);
    return `| ${label} | ${rows[0].eligible}/${primary.perScenario} | ${rows.map(row =>
      [row.wrongAutomaticApprovals, row.legitimateReferrals, row.panelDemand, row.unresolved].join("/")).join(" | ")} |`;
  });
  const sweeps = experiments.flatMap(run => summarize(run).map(row =>
    `| ${run.panelBudgetPercent}% | ${row.mode} | ${row.wrongAutomaticApprovals} | ${row.legitimateReferrals} | ${row.panelDemand} | ${row.panelReviewed} | ${row.unresolved} | ${row.conflict} | ${row.timeout} | ${row.routingP50}/${row.routingP95} |`));
  heads.push({ advice, modelReview, budget50: summarize(primary).map(row => [row.mode, row.wrongAutomaticApprovals, row.legitimateReferrals, row.panelDemand, row.unresolved]) });
  reports.push(`## ${advice === "frozen" ? "Frozen model advice" : "Fixed AUTO advice"}

The frozen worker scorer uses one synthetic observation without prior visits. It produced REVIEW advice for ${modelReview} of ${primary.rows.length / 4} cases in this run. The legacy shared-snapshot comparison retains its snapshot route.

The columns below show wrong automatic approvals / legitimate referrals / panel demand / unresolved at 50% panel capacity.

| Scenario | Eligible / total | v1 shared | v2 single origin | v2 multi-source | v2 provenance |
| --- | ---: | ---: | ---: | ---: | ---: |
${perScenario.join("\n")}

### Panel budget sweep

Every aggregate below depends on the equal-weight synthetic scenario mix. Unresolved counts also depend on the fixed number of panel slots. Routing percentiles use the analytical schedule in seconds.

| Budget | Mode | Wrong AUTO | Legitimate referrals | Panel demand | Served | Unresolved | Conflict | Timeout | Routing p50/p95 (s) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${sweeps.join("\n")}`);
}
const report = `# Phase 3 Oracle evidence experiment

Date ${date} (Asia/Dhaka). Node ${process.version}. Seed 42. Twelve paired scenarios with 24 cases per scenario give 288 cases per advice setting. The same cohort appears at every panel budget.

The Hospital payment confirmation is a signed copy derived from the invoice and belongs to the Hospital control domain. Half of these cases also contain an independent Bank-signed event contradicting the payment. The provenance-aware policy rejects the Hospital copy as independent authority and uses the Bank event when present. The accreditation-lineage stress case remains an artificial dependency test. Evidence policy still governs routing when the real frozen model is used.

${reports.join("\n\n")}

## Live evidence

The [R1 journey record](r1-journeys-2026-11-25.md) reports the separately observed sequence-2 AUTO, panel, quorum and timeout decisions. Live results use ledger transactions and are outside the analytical cohort.

~~~powershell
node --test benchmarks/oracle-v2/harness.test.mjs
node benchmarks/oracle-v2/run-phase3.mjs --date ${date}
~~~
`;
await writeFile(values.output ?? new URL(`../../docs/results/oracle-v2-phase3-${date}.md`, import.meta.url), report);
console.log(JSON.stringify(heads));
