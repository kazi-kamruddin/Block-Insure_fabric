import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluatorHash, evaluatorVersion, hash } from "../../services/oracle-worker/src/xgboost.mjs";
import { fitPeers, generateCohort, protocol, random, scoreCohort } from "./cohort.mjs";
import { fitModels, scoreChallenger } from "./models.mjs";

const summarize = (rows, selected, probability) => {
  const positives = rows.filter((row) => row.label === 1);
  const residual = rows.filter((row) => !row.mandatory);
  const outcomes = Object.fromEntries([...new Set(positives.map((row) => row.family))].sort().map((family) => {
    const group = positives.filter((row) => row.family === family);
    return [family, { positives: group.length, reviewed: group.filter((row) => selected.has(row.id)).length }];
  }));
  const values = Object.values(outcomes);
  const picked = rows.filter((row) => selected.has(row.id));
  const truePositive = picked.filter((row) => row.label === 1).length;
  const reliability = Array.from({ length: 10 }, () => ({ n: 0, prediction: 0, outcome: 0 }));
  let squared = 0;
  for (const row of residual) {
    const p = probability(row);
    assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
    const bin = reliability[Math.min(9, Math.floor(10 * p))];
    bin.n++;
    bin.prediction += p;
    bin.outcome += row.label;
    squared += (p - row.label) ** 2;
  }
  return { reviewed: picked.length, truePositive, precision: truePositive / picked.length,
    recall: truePositive / positives.length, macroRecall: values.reduce((sum, entry) => sum + entry.reviewed / entry.positives, 0) / values.length,
    benignReviewRate: (picked.length - truePositive) / (rows.length - positives.length),
    residualBrier: squared / residual.length,
    residualECE: reliability.reduce((sum, bin) => sum + Math.abs(bin.prediction - bin.outcome), 0) / residual.length, families: outcomes };
};

function atCapacity(rows, units) {
  const mandatory = rows.filter((row) => row.mandatory);
  const slots = Math.ceil(rows.length * protocol.reviewCapacity) - mandatory.length;
  if (slots < 0) throw new Error("Mandatory workload exceeds the declared comparison budget");
  const ordered = rows.filter((row) => !row.mandatory)
    .map((row) => ({ id: row.id, units: units(row) }))
    .sort((a, b) => b.units - a.units || a.id.localeCompare(b.id, "en"));
  return new Set([...mandatory.map((row) => row.id), ...ordered.slice(0, slots).map((row) => row.id)]);
}

function compare(rows, models, prior) {
  const choices = {
    "rules-random": { units: (row) => Number.parseInt(hash([protocol.seed, row.id]).slice(0, 12), 16), probability: () => prior },
    "frozen-xgboost": { units: (row) => row.frozen, probability: (row) => row.frozen / protocol.scoreScale },
  };
  for (const model of models) {
    const scores = new Map(rows.map((row) => [row.id, scoreChallenger(model, row.features)]));
    choices[model.id] = { units: (row) => scores.get(row.id).scoreUnits, probability: (row) => scores.get(row.id).probability };
  }
  const picked = Object.fromEntries(Object.entries(choices).map(([id, choice]) => [id, atCapacity(rows, choice.units)]));
  const results = Object.fromEntries(Object.entries(choices).map(([id, { probability }]) => [id, summarize(rows, picked[id], probability)]));
  for (const result of Object.values(results)) assert.equal(result.reviewed, Math.ceil(rows.length * protocol.reviewCapacity));
  const deployed = new Set(rows.filter((row) => row.frozenRouted).map((row) => row.id));
  results["frozen-operating-point"] = summarize(rows, deployed, choices["frozen-xgboost"].probability);
  return { picked, results };
}

function clusterInterval(rows, challenger, incumbent) {
  const rng = random(protocol.seed + 451);
  const providers = [...new Set(rows.map((row) => row.provider))];
  const positiveByProvider = providers.map((provider) => rows.filter((row) => row.provider === provider && row.label));
  const families = [...new Set(positiveByProvider.flat().map((row) => row.family))];
  const draws = Array.from({ length: protocol.bootstrapDraws }, () => {
    const sample = providers.flatMap(() => positiveByProvider[Math.floor(rng() * providers.length)]);
    return families.reduce((sum, family) => {
      const group = sample.filter((row) => row.family === family);
      if (!group.length) throw new Error("Bootstrap draw omitted a sealed family");
      return sum + group.reduce((total, row) => total + Number(challenger.has(row.id)) - Number(incumbent.has(row.id)), 0) / group.length;
    }, 0) / families.length;
  }).sort((a, b) => a - b);
  return [draws[Math.floor(draws.length * 0.025)], draws[Math.ceil(draws.length * 0.975) - 1]];
}

function checkSplits(cohorts) {
  const fields = ["id", "patient", "provider"];
  const seen = Object.fromEntries(fields.map((key) => [key, new Set()]));
  for (const cohort of Object.values(cohorts)) {
    for (const field of fields) {
      const values = new Set(cohort.cases.map((row) => row[field]));
      for (const value of values) {
        assert.ok(!seen[field].has(value), `Overlapping ${field} between splits`);
        seen[field].add(value);
      }
    }
  }
}

function checkTreeOrder(model) {
  const limits = (tree) => {
    if (tree.leaf !== undefined) return [tree.leaf, tree.leaf];
    const left = limits(tree.left), right = limits(tree.right);
    if (model.monotone.includes(tree.feature)) assert.ok(left[1] <= right[0] + 1e-15);
    return [Math.min(left[0], right[0]), Math.max(left[1], right[1])];
  };
  model.trees.forEach(limits);
}

function replay(models, packet) {
  return models.map((model) => packet.map((row) => scoreChallenger(model, row.features).scoreUnits));
}

async function read(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const [mode, output] = process.argv.slice(2);
  if (!output || !["--run", "--replay"].includes(mode)) throw new Error("Usage: node evaluate.mjs --run|--replay <local evidence directory>");
  if (mode === "--replay") {
    const artifact = await read(join(output, "models.json"));
    const packet = await read(join(output, "replay.json"));
    const receipt = await read(join(output, "results.json"));
    assert.equal(hash(artifact), receipt.artifactHash);
    assert.equal(hash(packet), receipt.replayHash);
    assert.deepEqual(replay(artifact.models, packet.inputs), packet.units);
    console.log(JSON.stringify({ status: "PASSED", integerScores: packet.inputs.length * artifact.models.length, artifactHash: receipt.artifactHash }));
    return;
  }

  const cohorts = Object.fromEntries(Object.keys(protocol.splits).map((split) => [split, generateCohort(split)]));
  checkSplits(cohorts);
  const peers = fitPeers(cohorts.train.records);
  const rows = Object.fromEntries(Object.entries(cohorts).map(([key, value]) => [key, scoreCohort(value, peers)]));
  const models = fitModels(rows.train, rows.calibration);
  const fitted = rows.calibration.filter((row) => !row.mandatory);
  const baselinePrior = fitted.filter((row) => row.label).length / fitted.length;
  const artifact = { protocol: protocol.version, incumbent: { evaluatorVersion, evaluatorHash }, peers, models };
  const stumps = models.find((model) => model.id === "additive-stumps");
  const ranker = models.find((model) => model.id === "monotonic-ranker");
  checkTreeOrder(ranker);
  let maximumAdditivityError = 0;
  for (const row of Object.values(rows).flat()) {
    const { margin, explanation } = scoreChallenger(stumps, row.features);
    maximumAdditivityError = Math.max(maximumAdditivityError, Math.abs(margin - explanation.base -
      Object.values(explanation.contributions).reduce((sum, value) => sum + value, 0)));
  }
  assert.ok(maximumAdditivityError < 1e-12);
  const primary = compare(rows.primary, models, baselinePrior);
  const sealed = compare(rows.sealed, models, baselinePrior);
  const baseline = sealed.results["frozen-xgboost"], candidate = sealed.results["monotonic-ranker"];
  const gain = candidate.macroRecall - baseline.macroRecall;
  const interval = clusterInterval(rows.sealed, sealed.picked["monotonic-ranker"], sealed.picked["frozen-xgboost"]);
  const gate = gain >= 0.05 && interval[0] > 0 && candidate.benignReviewRate <= 0.20 && candidate.residualBrier <= baseline.residualBrier + 0.02;
  const inputs = [...rows.primary.slice(0, 12), ...rows.sealed.slice(0, 12)].map(({ id, features }) => ({ id, features }));
  const packet = { inputs, units: replay(models, inputs) };
  const report = {
    status: "PASSED", environment: process.version, protocol,
    cohortHashes: Object.fromEntries(Object.entries(cohorts).map(([key, value]) => [key, hash(value)])),
    artifactHash: hash(artifact), replayHash: hash(packet), incumbent: artifact.incumbent,
    counts: Object.fromEntries(Object.entries(rows).map(([key, group]) => [key, {
      episodes: group.length, providers: new Set(group.map((row) => row.provider)).size, patients: new Set(group.map((row) => row.patient)).size,
      positives: group.filter((row) => row.label).length, mandatory: group.filter((row) => row.mandatory).length,
      pooledPeer: group.filter((row) => row.pooledPeer).length,
      positiveFamilies: Object.fromEntries([...new Set(group.filter((row) => row.label).map((row) => row.family))]
        .map((family) => [family, group.filter((row) => row.label && row.family === family).length])),
    }])),
    providerPatientEpisodeOverlap: 0, checks: { maximumAdditivityError, monotoneTreeOrder: "PASSED" },
    primary: primary.results, sealed: sealed.results,
    comparison: { gain, interval, syntheticGate: gate ? "PASSED" : "FAILED", promotion: "HOLD" },
  };
  await mkdir(output, { recursive: true });
  for (const [name, object] of Object.entries({ models: artifact, replay: packet, results: report })) {
    await writeFile(join(output, name + ".json"), JSON.stringify(object, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify({ status: report.status, artifactHash: report.artifactHash, comparison: report.comparison }));
}

await main();
