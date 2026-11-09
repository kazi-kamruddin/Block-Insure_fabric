import path from "node:path";
import { buildHybridRegistryReplicas } from "../src/hybrid-adapter.mjs";

function options(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match) throw new Error(`Unsupported argument ${argument}; use --name=value`);
    return [match[1], match[2]];
  }));
}

const args = options(process.argv.slice(2));
const serviceRoot = path.resolve(import.meta.dirname, "..");
if (!args.input) throw new Error("An explicit --input=<JSONL dataset> is required; no reference-repository fallback is used");
const inputPath = path.resolve(serviceRoot, args.input);
const outputDirectory = path.resolve(serviceRoot, args.output ?? "../../data/oracle/generated-hybrid");
const manifest = await buildHybridRegistryReplicas({
  inputPath,
  outputDirectory,
  snapshotId: args["snapshot-id"] ?? "registry-hybrid-v1",
  version: Number(args.version ?? 1),
  datasetId: args["dataset-id"] ?? "healthcare-provider-fraud-kaggle",
  datasetVersion: args["dataset-version"] ?? "blockinsure-hybrid-v1.2.0",
  includeCorruptReplica: args["include-corrupt"] !== "false",
});
process.stdout.write(`${JSON.stringify({ outputDirectory, ...manifest }, null, 2)}\n`);
