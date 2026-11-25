import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export function scanDuplicateCommitments(rows) {
  if (!Array.isArray(rows)) throw new Error("Expected an array of Oracle commitments");
  const subjectsByRequest = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row.requestId !== "string" || !row.requestId || typeof row.oracleId !== "string" || !row.oracleId ||
      typeof row.commitmentHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.commitmentHash)) {
      throw new Error(`Invalid commitment at row ${index + 1}`);
    }
    const hash = row.commitmentHash.toLowerCase();
    if (!subjectsByRequest.has(row.requestId)) subjectsByRequest.set(row.requestId, new Map());
    const hashes = subjectsByRequest.get(row.requestId);
    if (!hashes.has(hash)) hashes.set(hash, new Set());
    hashes.get(hash).add(row.oracleId);
  }
  const duplicates = [];
  for (const [requestId, hashes] of subjectsByRequest) {
    for (const [commitmentHash, oracleIds] of hashes) {
      if (oracleIds.size > 1) duplicates.push({ requestId, commitmentHash, oracleIds: [...oracleIds].sort() });
    }
  }
  return duplicates.sort((left, right) => left.requestId.localeCompare(right.requestId) || left.commitmentHash.localeCompare(right.commitmentHash));
}

async function liveCommitments() {
  const { withDevLitePeer } = await import("./dev-lite-gateway.mjs");
  try {
    return await withDevLitePeer("insurer", async ({ contract }) => JSON.parse(
      Buffer.from(await contract.evaluateTransaction("ListOracleCommitments")).toString("utf8"),
    ));
  } catch {
    throw new Error("Could not evaluate ListOracleCommitments on dev-lite");
  }
}

async function main() {
  const usage = "Usage: node scripts/scan-duplicate-commitments.mjs [--json FILE | --live]";
  const { values } = parseArgs({ options: { json: { type: "string" }, live: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) return console.log(usage);
  if (Boolean(values.live) === Boolean(values.json)) throw new Error(usage);
  const input = values.live ? await liveCommitments() : JSON.parse(await readFile(values.json, "utf8"));
  const rows = Array.isArray(input) ? input : input?.commitments;
  const duplicates = scanDuplicateCommitments(rows);
  console.log(`Scanned ${rows.length} commitments. Found ${duplicates.length} duplicate request/hash groups.`);
  if (duplicates.length) {
    console.table(duplicates.map(row => ({ ...row, oracleIds: row.oracleIds.join(", ") })));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof SyntaxError ? "Commitment export is not valid JSON" : error.message);
    process.exitCode = 1;
  });
}
