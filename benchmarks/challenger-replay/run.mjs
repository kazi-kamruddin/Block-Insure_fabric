import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { devLiteProfile } from "../../scripts/dev-lite-gateway.mjs";
import { loadChallengerShadow, shadowChallengerScores } from "../../services/oracle-worker/src/challenger-shadow.mjs";
import { evaluatorHash, evaluatorVersion, hash, inferContext } from "../../services/oracle-worker/src/xgboost.mjs";
import { generateCohort, protocol } from "../ml-challengers/cohort.mjs";

const archivedHash = "1bc58b5db36a73bf07a5333c139c2ba085236f13a409b7e60bb0f9ac08cc1f67";
const archivedArtifact = fileURLToPath(new URL("../../.local-reference/ml-challengers-20261119/final/models.json", import.meta.url));
const { values } = parseArgs({ options: {
  artifact: { type: "string" }, hash: { type: "string" }, output: { type: "string" }, date: { type: "string" },
} });
const artifact = values.artifact ? resolve(values.artifact) : archivedArtifact;
const expectedHash = values.hash ?? archivedHash;
const reportDate = values.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("Use --date YYYY-MM-DD");
const challenger = await loadChallengerShadow(devLiteProfile.channel, artifact, expectedHash);

function scoreEpisode({ record, id, provider, patient, label }, records) {
  const available = records.filter(row => row.invoiceDate <= record.invoiceDate);
  const when = record.invoiceDate + "T18:00:00.000Z";
  const { prepared, assessment } = inferContext({
    records: available, snapshotTimestamp: when,
    claim: { hospitalInvoiceId: id, hospitalId: provider, hospitalMsp: "HospitalMSP", claimantId: patient,
      claimantMsp: "InsurerMSP", createdAt: when, invoiceHash: record.invoiceHash, amountMinor: record.amountMinor,
      incidentDate: record.dischargeDate, treatmentType: record.treatmentType },
  });
  return {
    id, label, units: assessment.riskScoreUnits,
    frozenReview: assessment.recommendation === "REVIEW_RECOMMENDED",
    scoreShadow: () => shadowChallengerScores(challenger, { source: record, records: available, prepared }),
  };
}

function summarize(rows) {
  const detected = rows.filter(row => row.label === 1).length;
  return { detected, benign: rows.length - detected };
}

function summarizeBudget(rows, slots, scoring) {
  const ordered = rows.map(row => ({ row, score: scoring(row) }));
  assert.ok(ordered.every(item => Number.isSafeInteger(item.score)), "Expected an integer score per eligible episode");
  ordered.sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id, "en"));
  return summarize(ordered.slice(0, slots).map(item => item.row));
}

function replaySplit(split) {
  const cohort = generateCohort(split);
  const rows = cohort.cases.map(episode => scoreEpisode(episode, cohort.records));
  const preserved = rows.filter(row => row.frozenReview);
  const cleared = rows.filter(row => !row.frozenReview);
  const eligible = cleared.map(row => ({ ...row, shadow: row.scoreShadow() })).filter(row => row.shadow);
  const budget = Math.ceil(rows.length * protocol.reviewCapacity);
  const slots = budget - preserved.length;
  assert.ok(slots >= 0 && slots <= eligible.length, "Declared panel budget cannot be met");
  const scoreModes = [
    ["Frozen-score extension", row => row.units],
    ["Additive boosted stumps", row => row.shadow.scores["additive-stumps"]],
    ["Monotonic boosted ranker", row => row.shadow.scores["monotonic-ranker"]],
  ];
  let reference;
  const comparisons = scoreModes.map(([label, scoring]) => {
    const added = summarizeBudget(eligible, slots, scoring);
    reference ??= added;
    assert.equal(added.detected + added.benign, slots, "Allocation exceeded the fixed panel budget");
    return { label, ...added, detectionDelta: added.detected - reference.detected,
      benignDelta: added.benign - reference.benign };
  });
  return {
    split, cohortHash: hash(cohort), providers: new Set(cohort.cases.map(row => row.provider)).size,
    episodes: rows.length, positives: summarize(rows).detected, existing: summarize(preserved),
    cleared: summarize(cleared), budget, slots, skipShadow: cleared.length - eligible.length, comparisons,
  };
}

const bySplit = ["primary", "sealed"].map(replaySplit);
const tableRows = bySplit.flatMap(replay => replay.comparisons.map(row => {
  const { existing } = replay;
  return `| ${replay.split} | ${row.label} | ${row.detected} | ${row.benign} | ${row.detectionDelta} | ${row.benignDelta} | ${existing.detected + row.detected} | ${existing.benign + row.benign} |`;
}));
const splitRows = bySplit.map(row => `| ${row.split} | ${row.providers} | ${row.episodes} | ${row.positives} | ${row.existing.detected + row.existing.benign} | ${row.cleared.detected} | ${row.cleared.benign} | ${row.budget} | ${row.slots} | ${row.skipShadow} |`);
const report = `# Challenger shadow replay at a fixed panel budget

Date ${reportDate} (Asia/Dhaka). Node ${process.version}. Promotion **HOLD**.

The unit is one synthetic target episode from the existing provider-disjoint held-out cohorts. The primary split has 40/240 injected positives and target bills of BDT 338.96–1,025.00. The sealed split has 56/336 injected positives and target bills of BDT 301.34–1,025.00. Both have 16.7% positives before frozen routing. Training, calibration, primary and sealed data use the existing generator and seed ${protocol.seed}. The frozen input adapter divides BDT minor units by 10,000,000.

The frozen evaluator ${evaluatorVersion} has hash ${evaluatorHash}. The archived challenger artifact is verified by the existing shadow worker loader against hash ${expectedHash}. The original model and review gate are unchanged.

## Allocation

Preserve every frozen referral. The fixed total budget is 20% of the original split, rounded up. Allocate the remaining slots separately for each ranker, only among frozen-cleared episodes eligible for shadow scoring. Rank by descending integer score with case ID as the tie-breaker. The equal-budget comparator spends the same slots on the same pool using frozen scores. An incremental detection is a referred case with a generator-positive label. A benign referral is a referred generator-negative case.

| Split | Providers | Episodes | Positives | Existing referrals | Cleared positives | Cleared benign | Total budget | Additional slots | Cleared cases excluded by shadow eligibility |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${splitRows.join("\n")}

| Split | Residual ranker | Added detections | Added benign referrals | Detection delta vs frozen-score extension | Benign delta vs frozen-score extension | Total detections | Total benign referrals |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${tableRows.join("\n")}

## Reproducibility and limits

${bySplit.map(row => `- ${row.split} cohort SHA-256 ${row.cohortHash}`).join("\n")}

Rerun from the Fabric root with \`node benchmarks/challenger-replay/run.mjs --date ${reportDate}\`. The default input is the retained \`.local-reference/ml-challengers-20261119/final/models.json\`. If the retained archive is unavailable, use the [existing deterministic fitting instructions](../fabric-ml-challengers.md) to reproduce it, then pass its \`models.json\` path with \`--artifact\`.

The replay measures selection on authored synthetic labels. It gives no estimate of real-patient fraud detection, field prevalence or live clinical workload. Filled residual slots simulate additional panel referrals. The challengers remain diagnostics outside Oracle quorum and settlement authority.
`;
if (values.output) await writeFile(resolve(values.output), report, "utf8");
else process.stdout.write(report);
