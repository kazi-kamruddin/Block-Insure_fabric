import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const results = path.join(root, "docs/results");
const files = [
  "network/channel-artifacts/insurance-contract_1.4.0-phase2.tar.gz",
  "services/oracle-worker/registry/oracle1-v1.json",
  "services/oracle-worker/registry/oracle2-v1.json",
  "services/oracle-worker/registry/oracle3-v1.json",
  "services/oracle-worker/registry/oracle2-conflict-v1.json",
  "benchmarks/caliper/benchmark.yaml",
  "benchmarks/comparative/run-experiment.mjs",
  "benchmarks/oracle-faults/run-matrix.ps1",
  "benchmarks/oracle-faults/run-protocol-matrix.mjs",
  "benchmarks/security-evaluation/threat-model.json",
];
const sha256 = Object.fromEntries(await Promise.all(files.map(async (relative) => [
  relative,
  createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex"),
])));
function ledgerEntries(content) {
  return Object.fromEntries([...content.matchAll(/^(insurance-[a-z0-9-]+) Blockchain info: (\{.+\})$/gm)].map((match) => [match[1], JSON.parse(match[2])]));
}
const before = ledgerEntries(await readFile(path.join(results, "phase2-preserved-ledgers-before.txt"), "utf8"));
const after = ledgerEntries(await readFile(path.join(results, "phase2-ledgers-after.txt"), "utf8"));
for (const name of ["insurance-channel", "insurance-phase1-20260926"]) {
  assert.ok(before[name] && after[name], `missing ${name} ledger state`);
  assert.equal(after[name].height, before[name].height, `${name} height changed`);
  assert.equal(after[name].currentBlockHash, before[name].currentBlockHash, `${name} head hash changed`);
}
assert.ok(after["insurance-phase2-20260926"], "Phase 2 ledger state missing");
const sourceCommit = execFileSync("git", ["-c", "safe.directory=E:/4-1/4100 thesis/project/Block-Insure_fabric", "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const worktreeStatus = execFileSync("git", ["-c", "safe.directory=E:/4-1/4100 thesis/project/Block-Insure_fabric", "status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim();
const audit = await readFile(path.join(results, "phase2-package-audit.txt"), "utf8");
const packageId = /^Local package ID:\s*(\S+)$/m.exec(audit)?.[1];
assert.ok(packageId, "audited runtime package ID missing");
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceCommit,
  worktreeModified: worktreeStatus.length > 0,
  worktreeStatus,
  runtimePackageId: packageId,
  channel: "insurance-phase2-20260926",
  environment: { node: process.version, platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, memoryBytes: os.totalmem() },
  sha256,
  ledgers: { before, after, preservedUnchanged: true },
  artifactScope: "Synthetic local prototype; package, fixtures, scripts, and raw trial outputs are archived. Credentials and live chain data are not bundled.",
};
await mkdir(results, { recursive: true });
await writeFile(path.join(results, "phase2-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ sourceCommit, runtimePackageId: manifest.runtimePackageId, ledgers: manifest.ledgers }, null, 2)}\n`);
