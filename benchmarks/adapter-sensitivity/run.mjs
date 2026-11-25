import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { evaluatorHash, inferContext } from "../../services/oracle-worker/src/xgboost.mjs";
import { context, prior, source } from "../../services/oracle-worker/test/fixtures/xgboost-inputs.mjs";

const require = createRequire(import.meta.url);
const bundle = require("../../services/oracle-worker/frozen/bundle.json");
const { temporalFeatures } = require("../../services/oracle-worker/frozen/xgboost.cjs");
const DAY = 86_400_000;
const { values } = parseArgs({ options: { date: { type: "string" }, output: { type: "string" } } });
const date = values.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use --date YYYY-MM-DD");
const directory = values.output ?? fileURLToPath(new URL("../../docs/results/", import.meta.url));

function oodSplits(node, tree) {
  return [
    ...(node.split === "ood_distance" ? [{ tree, node: node.nodeid, threshold: node.split_condition }] : []),
    ...(node.children ?? []).flatMap(child => oodSplits(child, tree)),
  ];
}

function traceScore(observation, distance) {
  const features = { ...observation.features,
    ...temporalFeatures(observation.providerLags, bundle.pipeline.hawkes), ood_distance: distance };
  let margin = Math.fround(0);
  const visited = [];
  for (const [tree, root] of bundle.trees.trees.entries()) {
    let node = root;
    while (node.leaf === undefined) {
      const branch = Math.fround(features[node.split]) < Math.fround(node.split_condition) ? node.yes : node.no;
      if (node.split === "ood_distance") visited.push(`${tree}:${node.nodeid}->${branch}`);
      node = node.children.find(child => child.nodeid === branch);
    }
    margin = Math.fround(margin + Math.fround(node.leaf));
  }
  const sigmoid = value => 1 / (1 + Math.exp(-value));
  const risk = Math.min(1 - 1e-7, Math.max(1e-7, sigmoid(margin)));
  const calibration = bundle.pipeline.calibration;
  const score = Math.floor(sigmoid(calibration.slope * Math.log(risk / (1 - risk)) + calibration.intercept) * bundle.policy.scoreScale + 0.5);
  return { score, visited, review: observation.mandatory || score >= bundle.policy.thresholdUnits };
}

const rows = [];
for (const amountBdt of [500, 1_000, 10_000, 100_000, 200_000]) {
  for (const lagDays of [0, 1, 7, 30]) {
    for (const completeness of ["complete", "complete-no-priors", "incomplete"]) {
      const invoiceDate = new Date(Date.parse(source.dischargeDate) + lagDays * DAY).toISOString().slice(0, 10);
      const cutoff = `${invoiceDate}T18:00:00.000Z`;
      const current = { ...source, invoiceDate, amountMinor: amountBdt * 100 };
      const input = { ...context, snapshotTimestamp: cutoff, claim: { ...context.claim, createdAt: cutoff, amountMinor: current.amountMinor },
        records: completeness === "complete-no-priors" ? [current] : [current, prior],
        incompleteInvoiceIds: completeness === "incomplete" ? ["synthetic-missing-invoice"] : [] };
      const row = { amountBdt, lagDays, completeness, score: null, outcome: "CONTEXT_UNAVAILABLE", ood: null,
        oodBranches: null, scoreAtZeroOod: null, thresholdCrossed: null };
      try {
        const { assessment, prepared } = inferContext(input);
        row.score = assessment.riskScoreUnits;
        row.outcome = assessment.recommendation === "REVIEW_RECOMMENDED" ? "REVIEW" : "AUTO";
        row.ood = assessment.uncertainty.ood.distance;
        const actual = traceScore(prepared.observation, row.ood);
        if (actual.score !== row.score || actual.review !== (row.outcome === "REVIEW")) throw new Error("Frozen path trace differs from inference");
        const counterfactual = traceScore(prepared.observation, 0);
        row.oodBranches = actual.visited.join(";");
        row.scoreAtZeroOod = counterfactual.score;
        row.thresholdCrossed = Number(actual.review !== counterfactual.review);
      } catch (error) {
        if (completeness !== "incomplete" || error.message !== "Required source history is incomplete") throw error;
      }
      rows.push(row);
    }
  }
}

const splits = bundle.trees.trees.flatMap(oodSplits);
const frequent = Array.from({ length: 6 }, (_, index) => {
  const start = Date.parse(source.dischargeDate) - (index + 1) * DAY;
  const day = new Date(start).toISOString().slice(0, 10);
  return { ...prior, invoiceId: `prior-${index}`, invoiceHash: String(index).padStart(64, "0"),
    admissionDate: day, dischargeDate: day, invoiceDate: day };
});
const cutoff = new Date(Date.parse(source.dischargeDate) + DAY).toISOString();
const diagnostic = inferContext({ ...context, records: [{ ...source, amountMinor: source.expectedMinMinor }, ...frequent],
  snapshotTimestamp: cutoff, claim: { ...context.claim, amountMinor: source.expectedMinMinor, createdAt: cutoff } });
const diagnosticDistance = diagnostic.assessment.uncertainty.ood.distance;
const actualDiagnostic = traceScore(diagnostic.prepared.observation, diagnosticDistance);
const zeroDiagnostic = traceScore(diagnostic.prepared.observation, 0);
if (!actualDiagnostic.visited.length || actualDiagnostic.score !== diagnostic.assessment.riskScoreUnits ||
    actualDiagnostic.score === zeroDiagnostic.score) throw new Error("Frequent-history fixture must exercise the OOD score dependency");
const auto = rows.filter(row => row.outcome === "AUTO").length;
const review = rows.filter(row => row.outcome === "REVIEW").length;
const unavailable = rows.length - auto - review;
const scoreChanges = rows.filter(row => row.score !== null && row.score !== row.scoreAtZeroOod).length;
const routeChanges = rows.filter(row => row.thresholdCrossed === 1).length;
const csv = ["amount_bdt,invoice_lag_days,context,risk_score_units,routing,ood_distance,ood_branches,score_at_zero_ood,route_changed_at_zero_ood",
  ...rows.map(row => Object.values(row).join(","))].join("\n") + "\n";
const resultBase = `adapter-sensitivity-${date}`;
const md = `# Frozen adapter sensitivity

Date ${date} (Asia/Dhaka). Node ${process.version}. Evaluator ${evaluatorHash}.

This deterministic paired fixture varies one synthetic episode's amount and invoice timing across three history contexts. It uses the installed frozen weights, actual adapter and unchanged thresholds. Amounts are in BDT. Scores are integer model units.

${rows.length} cases yielded ${auto} AUTO, ${review} REVIEW and ${unavailable} CONTEXT_UNAVAILABLE. Recursively inspecting ${bundle.trees.trees.length} trees found ${splits.length} splits on ood_distance (${splits.map(split => `tree ${split.tree}, node ${split.node}, cut ${split.threshold}`).join("; ")}). The OOD warning threshold has no direct routing gate. The numeric OOD feature enters the trees. With every other feature held fixed, substituting zero OOD for the observed distance changed ${scoreChanges} integer scores and ${routeChanges} routing outcomes in this grid. The counterfactual trace does not alter the frozen bundle or the actual inference result.

An additional paired fixture with six same-patient prior invoices reaches the OOD branches. Observed OOD ${diagnosticDistance.toFixed(4)} follows ${actualDiagnostic.visited.join(", ")} and scores ${actualDiagnostic.score} (${actualDiagnostic.review ? "REVIEW" : "AUTO"}). The same tree observations at zero OOD follow ${zeroDiagnostic.visited.join(", ")} and score ${zeroDiagnostic.score} (${zeroDiagnostic.review ? "REVIEW" : "AUTO"}).

| Amount BDT | Lag days | Context | Score units | Routing | OOD distance |
|---:|---:|---|---:|---|---:|
${rows.map(row => `| ${row.amountBdt} | ${row.lagDays} | ${row.completeness} | ${row.score ?? "—"} | ${row.outcome} | ${row.ood?.toFixed(4) ?? "—"} |`).join("\n")}

[CSV](${resultBase}.csv)
`;
await mkdir(directory, { recursive: true });
await Promise.all([writeFile(path.join(directory, resultBase + ".csv"), csv), writeFile(path.join(directory, resultBase + ".md"), md)]);
console.log(JSON.stringify({ cases: rows.length, auto, review, unavailable, treeCount: bundle.trees.trees.length, splits, scoreChanges, routeChanges,
  frequentHistory: { distance: diagnosticDistance, actual: actualDiagnostic, zero: zeroDiagnostic } }));
