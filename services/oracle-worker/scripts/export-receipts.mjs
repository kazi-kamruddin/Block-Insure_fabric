import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readAuthenticatedDecision, writeExplanationReceipt } from "../src/decision-store.mjs";
import { evaluatorHash } from "../src/xgboost.mjs";

const defaultProfile = fileURLToPath(new URL("../../../data/dev-lite/", import.meta.url));
const { values } = parseArgs({ options: {
  log: { type: "string", multiple: true },
  profile: { type: "string" },
  "output-root": { type: "string" },
} });
if (!values.log?.length) throw new Error("Provide an existing Oracle worker log using --log <filename>, once per worker");
const profile = path.resolve(values.profile ?? defaultProfile);
const inputRoot = path.join(profile, "oracle");
const outputRoot = values["output-root"] ? path.resolve(values["output-root"]) : inputRoot;
let exported = 0;
const byWorker = new Map();

// Older files carry the hash of the decision identity. The local logs give
// the request ID and routing code needed to recover the receipt association.
for (const filename of values.log) {
  for (const line of (await fs.readFile(filename, "utf8")).split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const { service: oracleId, requestId, verificationCode } = event;
    if (event.message !== "Oracle request processed" || !/^oracle[123]$/.test(oracleId) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(requestId) ||
        !/^XGB_(AUTO|REVIEW):[A-F0-9]{64}$/.test(verificationCode)) continue;
    if (!byWorker.has(oracleId)) byWorker.set(oracleId, new Map());
    const requests = byWorker.get(oracleId);
    if (requests.has(requestId) && requests.get(requestId) !== verificationCode) {
      throw new Error("Conflicting routing codes for one request in Oracle logs");
    }
    requests.set(requestId, verificationCode);
  }
}

for (const [oracleId, requests] of byWorker) {
  const keystore = path.join(profile, "organizations", "peerOrganizations", "oracle.blockinsure.test",
    "users", `${oracleId}@oracle.blockinsure.test`, "msp", "keystore");
  const keys = (await fs.readdir(keystore, { withFileTypes: true })).filter(entry => entry.isFile() && !entry.name.startsWith("."));
  if (keys.length !== 1) throw new Error("Expected exactly one Oracle decision authentication key");
  const key = await fs.readFile(path.join(keystore, keys[0].name));
  const directory = path.join(inputRoot, oracleId, "decisions");
  try {
    const decisions = new Map();
    for (const filename of (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const decision = await readAuthenticatedDecision(path.join(directory, filename), key);
      const code = decision.assessment?.verificationCode;
      if (code) decisions.set(code, decision);
    }
    for (const [id, code] of requests) {
      if (await writeExplanationReceipt(outputRoot, { id, modelHash: evaluatorHash }, oracleId, decisions.get(code), code)) exported++;
    }
  } finally {
    key.fill(0);
  }
}
const expected = [...byWorker.values()].reduce((sum, requests) => sum + requests.size, 0);
console.log(JSON.stringify({ exported, expected, workers: byWorker.size }));
if (!expected || exported !== expected) process.exitCode = 1;
