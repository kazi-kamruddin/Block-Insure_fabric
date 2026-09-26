import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resultsRoot = path.join(projectRoot, "docs/results");
const inputs = {
  comparative: "phase2-comparative/latest.json",
  security: "phase2-security/latest.json",
  protocol: "phase2-protocol/protocol-matrix.json",
  faults: "phase2-faults.json",
  caliper1: "phase2-caliper/run1.log",
  caliper2: "phase2-caliper/run2.log",
  caliper3: "phase2-caliper/run3.log",
};
const raw = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([key, relative]) => [key, await readFile(path.join(resultsRoot, relative))])));
const hashes = Object.fromEntries(Object.entries(raw).map(([key, content]) => [inputs[key], createHash("sha256").update(content).digest("hex")]));
const comparative = JSON.parse(raw.comparative);
const security = JSON.parse(raw.security);
const protocol = JSON.parse(raw.protocol);
const faults = JSON.parse(raw.faults);
assert.equal(comparative.design.repetitions, 30);
assert.equal(security.metrics.threatsPassed, 8);
assert.equal(protocol.stateSpace.total, 64);
assert.equal(protocol.commonSourceAssessment.classification, "UNSAFE_AUTOMATIC_UNDER_SYNTHETIC_SOURCE_ERROR");
assert.equal(faults.channel, "insurance-phase2-20260926");
assert.equal(faults.measurements.length, 15);

function round(value, digits = 3) { return Number(value.toFixed(digits)); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
const profileNames = ["baseline", "negative", "one-unavailable", "conflict", "timeout"];
const live = profileNames.map((profile) => {
  const trials = faults.measurements.filter((item) => item.profile === profile);
  assert.equal(trials.length, 3, `${profile} trial count`);
  const elapsedSeconds = trials.map((item) => item.elapsedMs / 1_000);
  return {
    profile,
    trials: trials.length,
    passed: trials.filter((item) => item.passed).length,
    meanWholeTestSeconds: round(mean(elapsedSeconds), 1),
    rangeWholeTestSeconds: [round(Math.min(...elapsedSeconds), 1), round(Math.max(...elapsedSeconds), 1)],
  };
});

const expectedRounds = [
  "schema-read", "oracle-1-of-1", "oracle-2-of-2", "oracle-2-of-3",
  "anchored-write-5-tps", "anchored-write-10-tps", "anchored-write-20-tps",
  ...[5, 10, 20, 40, 80, 160].map((rate) => `claim-submit-${rate}-tps`),
  ...[5, 10, 20, 40, 80, 160].map((rate) => `mixed-policy-claim-${rate}-tps`),
];
function parseCaliper(content, run) {
  const log = content.toString("utf8").replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(log, /Successful rounds:\s+19\. Failed rounds:\s+0/);
  const section = log.slice(log.lastIndexOf("### All test results ###"), log.lastIndexOf("Generated report with path"));
  assert.ok(section.length > 0, `${run} final report`);
  const pattern = /\|\s*([\w-]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/g;
  const rows = [...section.matchAll(pattern)].map((match) => ({
    run,
    label: match[1],
    successful: Number(match[2]),
    failed: Number(match[3]),
    offeredTpsObserved: Number(match[4]),
    maxLatencySeconds: Number(match[5]),
    minLatencySeconds: Number(match[6]),
    averageLatencySeconds: Number(match[7]),
    achievedTps: Number(match[8]),
  }));
  assert.deepEqual(rows.map((row) => row.label), expectedRounds, `${run} round names`);
  return rows;
}
const caliperTrials = [1, 2, 3].flatMap((index) => parseCaliper(raw[`caliper${index}`], index));
function distribution(values) {
  const ordered = [...values].sort((left, right) => left - right);
  function percentile(percent) {
    const index = (percent / 100) * (ordered.length - 1);
    const lower = Math.floor(index);
    const fraction = index - lower;
    return ordered[lower] + (ordered[Math.min(lower + 1, ordered.length - 1)] - ordered[lower]) * fraction;
  }
  return { count: ordered.length, medianMs: round(percentile(50), 3), p95Ms: round(percentile(95), 3), maxMs: round(ordered.at(-1), 3) };
}
for (const trial of caliperTrials) {
  const roundIndex = expectedRounds.indexOf(trial.label);
  if (roundIndex < 4) continue;
  const workerFiles = await Promise.all([0, 1].map(async (worker) => {
    const relative = `phase2-caliper/samples/run${trial.run}-round${roundIndex}-worker${worker}.json`;
    const content = await readFile(path.join(resultsRoot, relative));
    hashes[relative] = createHash("sha256").update(content).digest("hex");
    return JSON.parse(content);
  }));
  const samples = workerFiles.flatMap((file) => file.samples);
  assert.equal(samples.length, 100, `${trial.label} run ${trial.run} sample count`);
  trial.workloadLatency = {
    all: distribution(samples.map((item) => item.elapsedMs)),
    reads: samples.some((item) => item.readOnly) ? distribution(samples.filter((item) => item.readOnly).map((item) => item.elapsedMs)) : null,
    writes: distribution(samples.filter((item) => !item.readOnly).map((item) => item.elapsedMs)),
    threw: samples.filter((item) => item.threw).length,
  };
}
function memoryMiB(rawUsage) {
  const match = /^([\d.]+)([KMG]iB)\s*\//.exec(rawUsage);
  if (!match) throw new Error(`Unsupported docker memory unit: ${rawUsage}`);
  return Number(match[1]) * { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[match[2]];
}
const resourceSamples = [];
for (let run = 1; run <= 3; run += 1) {
  const relative = `phase2-caliper/run${run}-resources.jsonl`;
  const content = await readFile(path.join(resultsRoot, relative));
  hashes[relative] = createHash("sha256").update(content).digest("hex");
  const lines = content.toString("utf8").trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${relative} resource samples`);
  resourceSamples.push(...lines.map((line) => {
    const item = JSON.parse(line);
    return { run, observedAt: item.observedAt, name: item.name, cpuPercent: Number(item.cpuPercent.replace("%", "")), memoryMiB: memoryMiB(item.memoryUsage) };
  }));
}
const resources = [...new Set(resourceSamples.map((item) => item.name))].map((name) => {
  const samples = resourceSamples.filter((item) => item.name === name);
  return { name, samples: samples.length, meanCpuPercent: round(mean(samples.map((item) => item.cpuPercent)), 2), maxCpuPercent: round(Math.max(...samples.map((item) => item.cpuPercent)), 2), meanMemoryMiB: round(mean(samples.map((item) => item.memoryMiB)), 2), maxMemoryMiB: round(Math.max(...samples.map((item) => item.memoryMiB)), 2) };
});
const caliper = expectedRounds.map((label) => {
  const rows = caliperTrials.filter((item) => item.label === label);
  return {
    label,
    runs: rows.length,
    successful: rows.reduce((sum, row) => sum + row.successful, 0),
    failed: rows.reduce((sum, row) => sum + row.failed, 0),
    meanObservedSendTps: round(mean(rows.map((row) => row.offeredTpsObserved)), 2),
    meanAchievedTps: round(mean(rows.map((row) => row.achievedTps)), 2),
    achievedTpsRange: [Math.min(...rows.map((row) => row.achievedTps)), Math.max(...rows.map((row) => row.achievedTps))],
    meanAverageLatencySeconds: round(mean(rows.map((row) => row.averageLatencySeconds)), 3),
    averageLatencyRangeSeconds: [Math.min(...rows.map((row) => row.averageLatencySeconds)), Math.max(...rows.map((row) => row.averageLatencySeconds))],
    workloadP95MsRange: rows[0].workloadLatency ? [Math.min(...rows.map((row) => row.workloadLatency.all.p95Ms)), Math.max(...rows.map((row) => row.workloadLatency.all.p95Ms))] : null,
  };
});
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputSha256: hashes,
  comparative: { design: comparative.design, environment: comparative.environment, summary: comparative.summary, comparisons: comparative.comparisons },
  protocol: { stateSpace: protocol.stateSpace, commonSourceAssessment: protocol.commonSourceAssessment },
  security: security.metrics,
  live,
  caliperTrials,
  caliper,
  resources,
  interpretation: "Protocol operations, full browser tests, and Caliper Gateway transactions have different timing boundaries; the three Caliper runs and three browser trials per profile are local observations rather than population reliability estimates.",
};
const output = path.join(resultsRoot, "phase2-summary");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  "# Phase 2 derived results",
  "",
  `Generated ${report.generatedAt}. All values below are derived from the hashed raw inputs in \`summary.json\`.`,
  "",
  "## Protocol computation",
  "",
  "| Profile | Mean latency (µs) | Trial-mean 95% CI (µs) | P95 (µs) | Mean ops/s |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...comparative.summary.map((item) => `| ${item.configuration} | ${item.meanLatencyUs} | ${item.trialMeanLatency95CiUs.lower}–${item.trialMeanLatency95CiUs.upper} | ${item.p95LatencyUs} | ${item.meanThroughputOpsPerSecond} |`),
  "",
  "## Live browser fault profiles",
  "",
  "| Profile | Passed | Mean whole-test time (s) | Range (s) |",
  "| --- | ---: | ---: | ---: |",
  ...live.map((item) => `| ${item.profile} | ${item.passed}/${item.trials} | ${item.meanWholeTestSeconds} | ${item.rangeWholeTestSeconds.join("–")} |`),
  "",
  "## Fabric Gateway and ledger",
  "",
  "| Round | Success | Fail | Observed send TPS | Achieved TPS, mean (range) | Caliper mean latency, s | Workload P95 range, ms |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...caliper.map((item) => `| ${item.label} | ${item.successful} | ${item.failed} | ${item.meanObservedSendTps} | ${item.meanAchievedTps} (${item.achievedTpsRange.join("–")}) | ${item.meanAverageLatencySeconds} (${item.averageLatencyRangeSeconds.join("–")}) | ${item.workloadP95MsRange?.join("–") ?? "—"} |`),
  "",
  "## Docker resource samples during Caliper",
  "",
  "| Container | Samples | Mean CPU % | Max CPU % | Mean memory MiB | Max memory MiB |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...resources.map((item) => `| ${item.name} | ${item.samples} | ${item.meanCpuPercent} | ${item.maxCpuPercent} | ${item.meanMemoryMiB} | ${item.maxMemoryMiB} |`),
  "",
  `Security model: ${security.metrics.threatsPassed}/${security.metrics.threatsEvaluated} expected safe outcomes passed. The synthetic common-source error produced ${protocol.commonSourceAssessment.classification}.`,
  "",
  report.interpretation,
  "",
];
await writeFile(path.join(output, "summary.md"), `${lines.join("\n")}\n`);
process.stdout.write(`${JSON.stringify({ output, live, caliper }, null, 2)}\n`);
