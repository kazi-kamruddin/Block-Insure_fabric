import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrivacyFixture } from "../lib/privacy-fixture.mjs";
import { buildCommitmentDigest, buildDeterministicSalt, buildResultDigest } from "../../services/oracle-worker/src/protocol.mjs";
import { verifySelectiveDisclosurePresentation } from "../../services/oracle-worker/src/privacy.mjs";
import { loadRegistrySnapshot, assessRegistryRecord } from "../../services/oracle-worker/src/registry.mjs";
import { evaluateThreshold } from "../../services/oracle-worker/src/threshold-model.mjs";
import { confidenceInterval95, mean, median, percentile, round, sampleStandardDeviation } from "./statistics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function positiveInteger(name, fallback) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const repetitions = positiveInteger("repetitions", 30);
const operationsPerTrial = positiveInteger("operations", 1_000);
const warmupOperations = positiveInteger("warmup", 200);
const outputDirectory = path.resolve(option("output", path.join(here, "reports")));

const snapshot = await loadRegistrySnapshot(path.join(projectRoot, "services/oracle-worker/registry/oracle1-v1.json"));
const clinicalReferenceHash = snapshot.records[0].lookupHash;
const claim = {
  id: "benchmark-claim",
  version: 1,
  policyId: "benchmark-policy",
  claimantId: "policyholder1",
  hospitalInvoiceId: "benchmark-invoice",
  hospitalId: snapshot.records[0].hospitalId,
  amountMinor: snapshot.records[0].minimumAmountMinor,
  incidentDate: snapshot.records[0].validFrom,
  descriptionHash: snapshot.records[0].descriptionHash,
};
const hospitalVerification = { id: "benchmark-verification", claimVersion: 1, appealId: "", clinicalReferenceHash };
const baseRequest = {
  id: "benchmark-request",
  claimId: claim.id,
  queryHash: "1".repeat(64),
  claimVersion: claim.version,
  hospitalVerificationId: hospitalVerification.id,
  appealId: "",
  appealCommitmentHash: "",
  registrySnapshotId: snapshot.snapshotId,
  registryVersion: snapshot.version,
  registryRootHash: snapshot.rootHash,
  rulesVersion: snapshot.rulesVersion,
  rulesHash: snapshot.rulesHash,
  modelVersion: "model-v1",
  modelHash: "c".repeat(64),
};
const privacyFixture = buildPrivacyFixture();
const privacyClaim = { ...claim, ...privacyFixture.claim };
const privacyRequest = { ...baseRequest, ...privacyFixture.requestBinding };
const workerKeys = [Buffer.from("benchmark-worker-1"), Buffer.from("benchmark-worker-2"), Buffer.from("benchmark-worker-3")];

function assess(request = baseRequest, inputClaim = claim) {
  return assessRegistryRecord({
    snapshot,
    request,
    claim: inputClaim,
    hospitalVerification,
    appeal: null,
    configuredModelVersion: "model-v1",
    configuredModelHash: "c".repeat(64),
  });
}

function oracleConsensus(workerCount, request = baseRequest, inputClaim = claim) {
  const assessment = assess(request, inputClaim);
  const resultHash = buildResultDigest(request, assessment);
  for (let index = 0; index < workerCount; index += 1) {
    buildCommitmentDigest(request, {
      verified: assessment.verified,
      resultHash,
      salt: buildDeterministicSalt(workerKeys[index], request.id, `oracle${index + 1}`),
    });
  }
  return evaluateThreshold({
    responses: Array.from({ length: workerCount }, () => resultHash),
    requiredConfirmations: workerCount === 1 ? 1 : 2,
    expectedResponses: workerCount,
  });
}

const configurations = [
  {
    id: "centralized",
    label: "Centralized trusted verifier",
    operation() { return assess(); },
  },
  {
    id: "oracle-1-of-1",
    label: "Single Oracle (1-of-1)",
    operation() { return oracleConsensus(1); },
  },
  {
    id: "oracle-2-of-2",
    label: "Unanimous Oracles (2-of-2)",
    operation() { return oracleConsensus(2); },
  },
  {
    id: "oracle-2-of-3",
    label: "Fault-tolerant Oracles (2-of-3)",
    operation() { return oracleConsensus(3); },
  },
  {
    id: "oracle-2-of-3-private",
    label: "2-of-3 with selective disclosure",
    operation() {
      for (let index = 0; index < 3; index += 1) {
        const proof = verifySelectiveDisclosurePresentation({
          request: privacyRequest,
          claim: privacyClaim,
          publicPresentation: privacyFixture.publicPresentation,
          privatePresentation: privacyFixture.privatePresentation,
          invoiceCredential: privacyFixture.invoiceCredential,
          policyCredential: privacyFixture.policyCredential,
          now: Date.parse("2026-09-19T00:00:00Z"),
        });
        if (!proof.valid) throw new Error(`benchmark privacy fixture failed: ${proof.code}`);
      }
      return oracleConsensus(3, privacyRequest, privacyClaim);
    },
  },
];

for (const configuration of configurations) {
  for (let index = 0; index < warmupOperations; index += 1) configuration.operation();
}

const trials = [];
const samplesByConfiguration = new Map(configurations.map(({ id }) => [id, []]));
for (let repetition = 0; repetition < repetitions; repetition += 1) {
  const ordered = configurations.map((_, index) => configurations[(index + repetition) % configurations.length]);
  for (const configuration of ordered) {
    const latenciesUs = [];
    const cpuStart = process.cpuUsage();
    const memoryStart = process.memoryUsage();
    const trialStart = process.hrtime.bigint();
    for (let operation = 0; operation < operationsPerTrial; operation += 1) {
      const started = process.hrtime.bigint();
      const result = configuration.operation();
      if (result.status && !["CONSENSUS", "PENDING"].includes(result.status)) throw new Error(`${configuration.id} produced ${result.status}`);
      latenciesUs.push(Number(process.hrtime.bigint() - started) / 1_000);
    }
    const elapsedMs = Number(process.hrtime.bigint() - trialStart) / 1_000_000;
    const cpu = process.cpuUsage(cpuStart);
    const memoryEnd = process.memoryUsage();
    samplesByConfiguration.get(configuration.id).push(...latenciesUs);
    trials.push({
      repetition: repetition + 1,
      configuration: configuration.id,
      operations: operationsPerTrial,
      elapsedMs: round(elapsedMs),
      meanLatencyUs: round(mean(latenciesUs)),
      medianLatencyUs: round(median(latenciesUs)),
      p95LatencyUs: round(percentile(latenciesUs, 95)),
      throughputOpsPerSecond: round((operationsPerTrial * 1_000) / elapsedMs),
      cpuUserMs: round(cpu.user / 1_000),
      cpuSystemMs: round(cpu.system / 1_000),
      processCpuUtilizationPercent: round(100 * (cpu.user + cpu.system) / (elapsedMs * 1_000)),
      heapDeltaBytes: memoryEnd.heapUsed - memoryStart.heapUsed,
      rssDeltaBytes: memoryEnd.rss - memoryStart.rss,
    });
  }
}

const summary = configurations.map((configuration) => {
  const observations = samplesByConfiguration.get(configuration.id);
  const configurationTrials = trials.filter((trial) => trial.configuration === configuration.id);
  const trialMeans = configurationTrials.map((trial) => trial.meanLatencyUs);
  const throughputs = configurationTrials.map((trial) => trial.throughputOpsPerSecond);
  const latencyCi = confidenceInterval95(trialMeans);
  const throughputCi = confidenceInterval95(throughputs);
  return {
    configuration: configuration.id,
    label: configuration.label,
    repetitions,
    totalOperations: observations.length,
    meanLatencyUs: round(mean(observations)),
    medianLatencyUs: round(median(observations)),
    p95LatencyUs: round(percentile(observations, 95)),
    latencyStandardDeviationUs: round(sampleStandardDeviation(observations)),
    trialMeanLatency95CiUs: { lower: round(latencyCi.lower), upper: round(latencyCi.upper), margin: round(latencyCi.margin) },
    meanThroughputOpsPerSecond: round(mean(throughputs)),
    throughput95Ci: { lower: round(throughputCi.lower), upper: round(throughputCi.upper), margin: round(throughputCi.margin) },
    meanCpuUserMsPer1000Operations: round(mean(configurationTrials.map((trial) => trial.cpuUserMs)) * 1_000 / operationsPerTrial),
    meanCpuSystemMsPer1000Operations: round(mean(configurationTrials.map((trial) => trial.cpuSystemMs)) * 1_000 / operationsPerTrial),
    meanProcessCpuUtilizationPercent: round(mean(configurationTrials.map((trial) => trial.processCpuUtilizationPercent))),
    meanHeapDeltaBytes: round(mean(configurationTrials.map((trial) => trial.heapDeltaBytes))),
  };
});
const centralizedSummary = summary.find((item) => item.configuration === "centralized");
const nonPrivateThreeOracleSummary = summary.find((item) => item.configuration === "oracle-2-of-3");
for (const item of summary) {
  item.latencyOverheadVsCentralized = round(item.meanLatencyUs / centralizedSummary.meanLatencyUs);
  item.throughputRelativeToCentralizedPercent = round(100 * item.meanThroughputOpsPerSecond / centralizedSummary.meanThroughputOpsPerSecond);
}
const comparisons = {
  twoOfThreeLatencyOverheadVsCentralized: summary.find((item) => item.configuration === "oracle-2-of-3").latencyOverheadVsCentralized,
  privacyLatencyOverheadVsNonPrivateTwoOfThree: round(summary.find((item) => item.configuration === "oracle-2-of-3-private").meanLatencyUs / nonPrivateThreeOracleSummary.meanLatencyUs),
};
function pairedComparison(treatmentId, controlId) {
  const treatment = trials.filter((trial) => trial.configuration === treatmentId);
  const control = trials.filter((trial) => trial.configuration === controlId);
  const differences = treatment.map((trial, index) => trial.meanLatencyUs - control[index].meanLatencyUs);
  const ratios = treatment.map((trial, index) => trial.meanLatencyUs / control[index].meanLatencyUs);
  const differenceCi = confidenceInterval95(differences);
  const ratioCi = confidenceInterval95(ratios);
  return {
    treatment: treatmentId,
    control: controlId,
    repetitions: treatment.length,
    meanDifferenceUs: round(mean(differences)),
    difference95CiUs: { lower: round(differenceCi.lower), upper: round(differenceCi.upper) },
    meanRatio: round(mean(ratios)),
    ratio95Ci: { lower: round(ratioCi.lower), upper: round(ratioCi.upper) },
  };
}
comparisons.paired = [
  pairedComparison("oracle-2-of-3", "centralized"),
  pairedComparison("oracle-2-of-3-private", "oracle-2-of-3"),
];
const fixturePaths = [
  "services/oracle-worker/registry/oracle1-v1.json",
  "services/oracle-worker/src/protocol.mjs",
  "services/oracle-worker/src/privacy.mjs",
  "services/oracle-worker/src/registry.mjs",
  "services/oracle-worker/src/threshold-model.mjs",
  "benchmarks/lib/privacy-fixture.mjs",
];
const inputSha256 = Object.fromEntries(await Promise.all(fixturePaths.map(async (relative) => [
  relative,
  createHash("sha256").update(await fs.readFile(path.join(projectRoot, relative))).digest("hex"),
])));

const report = {
  schemaVersion: 1,
  benchmarkType: "controlled-protocol-microbenchmark",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  design: {
    repetitions,
    operationsPerTrial,
    warmupOperations,
    orderStrategy: "balanced cyclic rotation",
    timer: "process.hrtime.bigint",
    confidenceInterval: "normal approximation over independent trial means (95%)",
    scope: "Oracle decision, binding, threshold, and optional selective-disclosure computation; excludes Fabric network and storage latency",
  },
  inputSha256,
  summary,
  comparisons,
  trials,
};

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
const csvHeader = "configuration,repetitions,total_operations,mean_latency_us,median_latency_us,p95_latency_us,latency_ci_lower_us,latency_ci_upper_us,mean_throughput_ops_s,throughput_ci_lower,throughput_ci_upper,cpu_user_ms_per_1000_ops,mean_process_cpu_utilization_percent,latency_overhead_vs_centralized,throughput_relative_to_centralized_percent";
const csvRows = summary.map((item) => [
  item.configuration, item.repetitions, item.totalOperations, item.meanLatencyUs, item.medianLatencyUs,
  item.p95LatencyUs, item.trialMeanLatency95CiUs.lower, item.trialMeanLatency95CiUs.upper,
  item.meanThroughputOpsPerSecond, item.throughput95Ci.lower, item.throughput95Ci.upper,
  item.meanCpuUserMsPer1000Operations, item.meanProcessCpuUtilizationPercent, item.latencyOverheadVsCentralized, item.throughputRelativeToCentralizedPercent,
].join(","));
await fs.writeFile(path.join(outputDirectory, "latest.csv"), `${[csvHeader, ...csvRows].join("\n")}\n`);
const markdown = [
  "# Comparative Oracle protocol benchmark",
  "",
  `Generated ${report.generatedAt} using ${repetitions} repetitions and ${operationsPerTrial} measured operations per repetition.`,
  "",
  "| Configuration | Mean latency (µs) | Median (µs) | P95 (µs) | Trial-mean 95% CI (µs) | Mean throughput (ops/s) | Latency vs centralized |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...summary.map((item) => `| ${item.label} | ${item.meanLatencyUs} | ${item.medianLatencyUs} | ${item.p95LatencyUs} | ${item.trialMeanLatency95CiUs.lower}–${item.trialMeanLatency95CiUs.upper} | ${item.meanThroughputOpsPerSecond} | ${item.latencyOverheadVsCentralized}× |`),
  "",
  `Scope: ${report.design.scope}. Use the Caliper benchmark for ledger-level latency and throughput.`,
  "",
].join("\n");
await fs.writeFile(path.join(outputDirectory, "latest.md"), markdown);
console.log(JSON.stringify({ outputDirectory, summary }, null, 2));
