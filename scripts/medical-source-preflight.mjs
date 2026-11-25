import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readRegisteredBenchmarks } from "./validate-dev-lite-seed.mjs";

function revisionId(episode) {
  const revision = String(episode.revision);
  return createHash("sha256").update(`fabric-medical-episode-revision-v1|${Buffer.byteLength(episode.id)}:${episode.id}|${revision.length}:${revision}`).digest("hex");
}

export function classifyMedicalSources(sources, episodes, benchmarks) {
  const episodeIndex = new Map(episodes.map(episode => [revisionId(episode), episode]));
  const registrations = new Set(benchmarks.map(row => `${row.hospitalId}/${row.service}`));
  const readableBenchmarks = new Set(sources.filter(source => source.complete && source.facts?.treatmentType)
    .map(source => `${source.invoice.hospitalId}/${source.facts.treatmentType}`));
  const groups = new Map();
  for (const source of sources) {
    const { id: revision, hospitalId } = source.invoice;
    if (!groups.has(hospitalId)) groups.set(hospitalId, { hospitalId, sources: 0, incomplete: [] });
    const group = groups.get(hospitalId);
    group.sources++;
    if (source.complete) continue;
    const episode = episodeIndex.get(revision);
    let reason;
    if (!episode || episode.hospitalId !== hospitalId) reason = "EPISODE_READBACK_UNAVAILABLE";
    else if (episode.associationStatus !== "VERIFIED") reason = "UNVERIFIED_ASSOCIATION";
    else if (readableBenchmarks.has(`${hospitalId}/${episode.service}`)) reason = "MISSING_INVOICE_DATE";
    else if (!registrations.has(`${hospitalId}/${episode.service}`)) reason = "MISSING_BENCHMARK";
    else reason = "INVOICE_DATE_OR_PRIVATE_BENCHMARK_UNAVAILABLE";
    group.incomplete.push({ episodeId: episode?.id ?? null, revisionId: revision, service: episode?.service ?? null, reason });
  }
  return [...groups.values()].sort((left, right) => left.hospitalId.localeCompare(right.hospitalId));
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, live: { type: "boolean" } } });
  const usage = "Usage: node scripts/medical-source-preflight.mjs --live";
  if (values.help) return console.log(usage);
  if (!values.live) throw new Error(usage);
  const { devLiteProfile, withDevLitePeer } = await import("./dev-lite-gateway.mjs");
  const report = await withDevLitePeer("insurer", async ({ network, contract }) => {
    const evaluate = async name => JSON.parse(Buffer.from(await contract.evaluateTransaction(name)).toString("utf8"));
    const sources = await evaluate("ListMedicalOracleSources");
    if (sources.every(source => source.complete)) return classifyMedicalSources(sources, [], []);
    const episodes = await evaluate("ListMedicalEpisodes");
    const qscc = network.getContract("qscc");
    const benchmarks = await readRegisteredBenchmarks((name, ...args) => qscc.evaluateTransaction(name, ...args),
      devLiteProfile.channel, devLiteProfile.chaincodeName);
    return classifyMedicalSources(sources, episodes, benchmarks);
  }).catch(() => { throw new Error("Could not complete the read-only dev-lite medical source checks"); });
  console.log(`Checked sources for ${report.length} hospitals.`);
  for (const hospital of report) {
    console.log(`${hospital.hospitalId}: ${hospital.incomplete.length} incomplete of ${hospital.sources} sources`);
    if (hospital.incomplete.length) console.table(hospital.incomplete);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
