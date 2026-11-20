import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildHybridRegistryReplicas } from "../src/hybrid-adapter.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const dataset = path.join(root, "datasets/hybrid-v1");
const args = process.argv.slice(2);
const verifyArchive = args.length === 1 && args[0] === "--verify-archive";
if (args.length && !verifyArchive) {
  throw new Error("Usage: node hybrid-comparison.mjs [--verify-archive]");
}

async function verify(file, expected, load = false) {
  const hash = createHash("sha256");
  let bytes;
  try {
    if (load) {
      bytes = await readFile(file);
      hash.update(bytes);
    } else {
      for await (const chunk of createReadStream(file)) hash.update(chunk);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("Missing " + path.relative(root, file) + ". Restore the Fabric-local dataset bundle. See datasets/hybrid-v1/README.md.");
  }
  if (hash.digest("hex") !== expected) {
    throw new Error("Dataset checksum mismatch for " + path.relative(root, file));
  }
  return bytes;
}

const comparison = JSON.parse(await readFile(path.join(dataset, "comparison-manifest.json"), "utf8"));
const upstreamPath = path.join(dataset, "upstream-manifest.json");
const presetsPath = path.join(dataset, "comparison-presets.json");
const upstream = JSON.parse(await verify(upstreamPath, comparison.upstreamManifestSha256, true));
const presets = JSON.parse(await verify(presetsPath, comparison.presetSha256, true));

if (verifyArchive) {
  for (const [name, entry] of Object.entries(upstream.sourceFiles)) {
    await verify(path.join(dataset, "raw", name), entry.sha256);
  }
  for (const [key, file] of Object.entries(upstream.outputFiles)) {
    await verify(path.join(dataset, file), upstream.outputSha256[key]);
  }
  console.log(JSON.stringify({
    status: "PASSED",
    datasetVersion: upstream.datasetVersion,
    sourceClaims: upstream.totalUniqueClaims,
    runtimeRows: upstream.counts.runtimeHybrid,
    verifiedDatasetFiles: Object.keys(upstream.sourceFiles).length + Object.keys(upstream.outputFiles).length,
  }, null, 2));
} else {
  const runtimePath = path.join(dataset, upstream.outputFiles.runtimeHybrid);
  const runtime = (await verify(runtimePath, upstream.outputSha256.runtimeHybrid, true)).toString("utf8");
  const runtimeRows = runtime.trimEnd().split(/\r?\n/).filter(line => line.trim()).length;
  if (runtimeRows !== upstream.counts.runtimeHybrid || presets.length !== comparison.presetCount ||
      runtimeRows + presets.length !== comparison.recordCount) {
    throw new Error("The comparison workload must have exactly 4,995 hybrid rows and five presets");
  }
  const researchRoot = path.join(root, "data/research");
  await mkdir(researchRoot, { recursive: true });
  const outputDirectory = await mkdtemp(path.join(researchRoot, comparison.comparisonId + "-"));
  const inputPath = path.join(outputDirectory, "comparison-input.jsonl");
  const input = presets.map(row => JSON.stringify(row)).join("\n") + "\n" + runtime.trimEnd() + "\n";
  await writeFile(inputPath, input, { flag: "wx" });
  const manifest = await buildHybridRegistryReplicas({
    inputPath,
    outputDirectory,
    snapshotId: comparison.comparisonId,
    datasetId: comparison.datasetId,
    datasetVersion: upstream.datasetVersion,
  });
  if (manifest.recordCount !== comparison.recordCount ||
      Object.values(manifest.replicaRoots).some(hash => hash !== manifest.baselineRootHash) ||
      !manifest.corruptRootHash || manifest.corruptRootHash === manifest.baselineRootHash) {
    throw new Error("Comparison registry count or replica commitments differ from their expected values");
  }
  const receipt = {
    status: "PASSED",
    comparisonId: comparison.comparisonId,
    sourceRevision: comparison.sourceRevision,
    runtimeRows,
    presets: presets.length,
    runtimeSha256: upstream.outputSha256.runtimeHybrid,
    presetSha256: comparison.presetSha256,
    outputDirectory: path.relative(root, outputDirectory),
    inputSha256: manifest.inputSha256,
    recordCount: manifest.recordCount,
    replicaRoots: manifest.replicaRoots,
    corruptRootHash: manifest.corruptRootHash,
  };
  await writeFile(path.join(outputDirectory, "comparison-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(receipt, null, 2));
}
