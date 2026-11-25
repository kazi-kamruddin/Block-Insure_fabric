import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configurations, simulate, summarize } from "./harness.mjs";
import { scenarios } from "./fixtures.mjs";

const { values } = parseArgs({ options: {
  seed: { type: "string", default: "42" },
  "per-scenario": { type: "string", default: "24" },
  "panel-budget": { type: "string", default: "50" },
  date: { type: "string" },
  output: { type: "string" },
} });

const date = values.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Use --date YYYY-MM-DD");
const experiment = simulate({
  seed: Number(values.seed),
  perScenario: Number(values["per-scenario"]),
  panelBudgetPercent: Number(values["panel-budget"]),
});
const summary = summarize(experiment);
const totalCases = summary[0].total;
const reportName = "oracle-v2-offline-" + date;
const details = experiment.rows;
const csvColumns = Object.keys(details[0]);
const csv = [csvColumns.join(","), ...details.map(row => csvColumns.map(key => row[key]).join(","))].join("\n") + "\n";

const percent = (count, total) => (100 * count / total).toFixed(1) + "%";
const summaryLines = summary.map(row =>
  `| ${row.label} | ${row.automaticApprovals} (${percent(row.automaticApprovals, row.total)}) | ${row.wrongAutomaticApprovals} (${percent(row.wrongAutomaticApprovals, row.ineligible)}) | ${row.legitimateReferrals} (${percent(row.legitimateReferrals, row.eligible)}) | ${row.conflict} (${percent(row.conflict, row.total)}) | ${row.timeout} | ${row.panelDemand} (${percent(row.panelDemand, row.total)}) | ${row.panelReviewed} | ${row.unresolved} | ${row.routingP50}/${row.routingP95} | ${row.decisionP50 ?? "—"}/${row.decisionP95 ?? "—"} |`);
const scenarioLines = scenarios.map(({ id, label }) => {
  const comparison = summarize(experiment, id);
  return `| ${label} | ${comparison[0].eligible}/${experiment.perScenario} | ${comparison.map(row => `${row.wrongAutomaticApprovals}/${row.legitimateReferrals}/${row.panelDemand}/${row.unresolved}`).join(" | ")} |`;
});

const first = scenario => details.filter(row => row.claimId === scenario + "-001");
const replay = first("agreeing-copies");
const taka = minor => (minor / 100).toFixed(2);
const replayLines = replay.map(row => `| ${row.mode} | ${row.route} | ${row.availableAgreeingWorkers} | ${row.matchingWorkers} | ${row.evidenceReason} | ${row.agreementHash} |`);
const strictClean = first("clean").find(row => row.mode === "v2-provenance-aware");
const strictCollusion = first("consistent-collusion").find(row => row.mode === "v2-provenance-aware");
const benignMismatches = details.filter(row => row.mode === "v1-shared" && row.variant === "BENIGN_TRANSCRIPTION").length;
const markdown = `# Oracle v2 paired offline experiment

Date ${date} (Asia/Dhaka). Node ${process.version}. Seed ${experiment.seed}. ${experiment.perScenario} synthetic diagnostic claims per scenario for ${totalCases} distinct paired cases and ${details.length} mode observations.

## Cohort and decision gates

The benchmark pairs the same claims and truth labels across four configurations. The v1 fixture gives workers a shared Insurer snapshot and uses the v1 result digest and threshold function. Signed single-origin v2 verifies the HIS invoice under an invoice-only comparison policy. Signed multi-source v2 adds licence, accreditation, tariff, claimant receipt and payment where the fixture policy enables it. Provenance-aware v2 adds cross-domain and disjoint-origin checks between the invoice and the material regulator and payment evidence. The receipt is used to check consistency with the invoice and cites it in every case.

The adapters sign the synthetic records and feeds with test-only Ed25519 keys. The verifier checks feed pins, record authority and Merkle membership before the v2 routes are evaluated. The experiment fixes model advice to AUTO to isolate the evidence gate. The ground-truth labels come from scenario construction. In this cohort, ${benignMismatches} eligible claims contain a receipt transcription mismatch. The remaining mismatched receipts represent ineligible claims. The licence/accreditation cases alternate the two integrity failures. The optional-payment policy applies to the contradictory-payment scenario and every other clean case.

Each scenario has equal representation. The cohort contains ${summary[0].eligible} eligible and ${summary[0].ineligible} ineligible cases. Most stale-mirror cases retain two agreeing current workers. Every sixth case has a third distinct result, and the preceding case has one late reveal, exercising compound-fault CONFLICT and TIMEOUT. The duplicate-offer scenario models acceptance at the old commit gate versus refusal at the subject-bound gate. Both modes rely on two valid reveals for their decision.

The panel budget is fixed at ${experiment.panelBudgetPercent}% of the full cohort, rounded down to ${experiment.panelCapacity} fixed slots per mode. Referrals enter the panel in routing-time order with ties broken by claim ID. Overflow is unresolved; referrals count regardless of panel capacity. Modeled routing times use a 60-second commit deadline, a 120-second reveal deadline, and deterministic worker delays and jitter. Completing a panel slot adds a fixed 30 seconds in the simulation. The decision percentiles exclude unresolved cases. These times describe the analytical schedule.

## Outcomes at the fixed panel budget

| Configuration | Auto approvals (% of all) | Wrong auto approvals (% of ineligible) | Legitimate referrals (% of eligible) | CONFLICT (% of all) | TIMEOUT | Panel demand (% of all) | Panel served | Unresolved | Routing p50/p95 (s) | Decision p50/p95 (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${summaryLines.join("\n")}

Compared with signed multi-source v2, the provenance-aware mode sends ${summary[3].panelDemand - summary[2].panelDemand} additional cases to the panel and prevents ${summary[2].wrongAutomaticApprovals - summary[3].wrongAutomaticApprovals} additional wrong automatic approvals in this cohort. The residual ${summary[3].wrongAutomaticApprovals} automatic errors are the consistent-collusion cases. Those signed hospital and claimant assertions agree on an in-band false amount, and separate regulator evidence independently supports the licence, accreditation and tariff. The configured policy has no independent amount observation for that scenario.

In the table below, each mode column reports wrong automatic approvals / legitimate referrals / panel demand / unresolved.

| Scenario | Eligible / total | v1 shared | v2 single origin | v2 multi-source | v2 provenance |
| --- | ---: | ---: | ---: | ---: | ---: |
${scenarioLines.join("\n")}

## Replay of one shared-source decision

The synthetic case ${replay[0].claimId} claims BDT ${taka(replay[0].billMinor)}. Its ground-truth invoice is BDT ${taka(replay[0].groundTruthInvoiceMinor)}. The regulator-signed accreditation record cites the hospital's invoice record, so their origin closures overlap even though their signer and control-domain metadata differ. The signed claimant receipt matches the hospital invoice as a derivative copy.

| Configuration | Routing decision | Agreeing worker observations | Reveals needed before finalization | Evidence condition | Shared result or fact-vector hash |
| --- | --- | ---: | ---: | --- | --- |
${replayLines.join("\n")}

The three observations produce the same result within each configuration for this case. Two exact reveals decide the route. In the same run ${strictClean.claimId} routes ${strictClean.route} under v2 provenance. The consistently false in-band case ${strictCollusion.claimId} also routes ${strictCollusion.route} under that policy. The fixture results quantify the named evidence and availability scenarios at the selected workload and budget.

## Reproduce

Run from the Fabric repository root:

~~~powershell
node --test benchmarks/oracle-v2/harness.test.mjs
node benchmarks/oracle-v2/run.mjs --seed ${experiment.seed} --per-scenario ${experiment.perScenario} --panel-budget ${experiment.panelBudgetPercent} --date ${date}
~~~

[Per-case results CSV](${reportName}.csv)
`;

const directory = values.output ?? fileURLToPath(new URL("../../docs/results/", import.meta.url));
await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(path.join(directory, reportName + ".csv"), csv),
  writeFile(path.join(directory, reportName + ".md"), markdown),
]);
console.log(JSON.stringify({ distinctCases: totalCases, observations: details.length, panelSlots: experiment.panelCapacity,
  modes: configurations.length, summary }, null, 2));
