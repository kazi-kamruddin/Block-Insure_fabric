import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { securityCases } from "./cases.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const outputArgument = process.argv.slice(2).find((value) => value.startsWith("--output="));
const outputDirectory = path.resolve(outputArgument?.slice("--output=".length) ?? path.join(here, "reports"));
const model = JSON.parse(await fs.readFile(path.join(here, "threat-model.json"), "utf8"));
const goCache = new Map();
const contractRoot = path.join(projectRoot, "chaincode/insurance-contract");
const localGoProbe = spawnSync("go", ["version"], { encoding: "utf8", windowsHide: true });
const goBackend = localGoProbe.error?.code === "ENOENT" ? "docker" : "local";

function runGoTest(testName) {
  if (goCache.has(testName)) return goCache.get(testName);
  const started = performance.now();
  const directArguments = ["test", "./src", "-run", `^${testName}$`, "-count=1"];
  const dockerArguments = [
    "run", "--rm", "-v", "block-insure-go-cache:/go/pkg/mod",
    "-v", `${contractRoot}:/workspace`, "-w", "/workspace",
    "golang:1.25", "go", ...directArguments,
  ];
  const result = spawnSync(goBackend === "local" ? "go" : "docker", goBackend === "local" ? directArguments : dockerArguments, {
    cwd: contractRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  const evidence = {
    kind: "chaincode-test",
    test: testName,
    backend: goBackend,
    command: goBackend === "local" ? `go test ./src -run ^${testName}$ -count=1` : `docker run ... golang:1.25 go test ./src -run ^${testName}$ -count=1`,
    passed: !result.error && result.status === 0,
    durationMs: Number((performance.now() - started).toFixed(3)),
    output: `${result.error ? `${result.error}\n` : ""}${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-2_000),
  };
  goCache.set(testName, evidence);
  return evidence;
}

const results = [];
for (const threat of model.threats) {
  const evidence = [];
  if (threat.nodeCase) {
    const started = performance.now();
    try {
      const details = await securityCases[threat.nodeCase]();
      evidence.push({ kind: "attack-simulation", test: threat.nodeCase, passed: true, durationMs: Number((performance.now() - started).toFixed(3)), details });
    } catch (error) {
      evidence.push({ kind: "attack-simulation", test: threat.nodeCase, passed: false, durationMs: Number((performance.now() - started).toFixed(3)), error: String(error?.stack ?? error) });
    }
  }
  for (const testName of threat.goTests) evidence.push(runGoTest(testName));
  results.push({
    id: threat.id,
    name: threat.name,
    initialRisk: threat.initialRisk,
    expectedOutcome: threat.expectedOutcome,
    passed: evidence.length > 0 && evidence.every((item) => item.passed),
    controls: threat.controls,
    securityProperty: threat.securityProperty,
    residualRisk: threat.residualRisk,
    residualRiskRating: threat.residualRiskRating,
    evidence,
  });
}

const uniqueControls = new Set(model.threats.flatMap((threat) => threat.controls));
const exercisedControls = new Set(results.filter((result) => result.passed).flatMap((result) => result.controls));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model: { system: model.system, method: model.method, trustAssumptions: model.trustAssumptions },
  metrics: {
    threatsEvaluated: results.length,
    threatsPassed: results.filter((item) => item.passed).length,
    safeOutcomeRatePercent: Number((100 * results.filter((item) => item.passed).length / results.length).toFixed(2)),
    automatedEvidenceCoveragePercent: Number((100 * results.filter((item) => item.evidence.length > 0).length / results.length).toFixed(2)),
    controlCoveragePercent: Number((100 * exercisedControls.size / uniqueControls.size).toFixed(2)),
    highOrCriticalResidualRisks: results.filter((item) => ["HIGH", "CRITICAL"].includes(item.residualRiskRating)).length,
    uniqueChaincodeTestsExecuted: goCache.size,
  },
  results,
};

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
  "# Oracle security evaluation",
  "",
  `Generated ${report.generatedAt}. Safe outcomes: ${report.metrics.threatsPassed}/${report.metrics.threatsEvaluated}; automated evidence coverage: ${report.metrics.automatedEvidenceCoveragePercent}%.`,
  "",
  "| ID | Threat | Initial risk | Expected outcome | Result | Automated evidence |",
  "|---|---|---|---|---|---|",
  ...results.map((result) => `| ${result.id} | ${result.name} | ${result.initialRisk} | ${result.expectedOutcome} | ${result.passed ? "PASS" : "FAIL"} | ${result.evidence.map((item) => item.test).join(", ")} |`),
  "",
  "## Trust assumptions",
  "",
  ...model.trustAssumptions.map((assumption) => `- ${assumption}`),
  "",
  "## Residual risks",
  "",
  ...results.map((result) => `- **${result.id} (${result.residualRiskRating}):** ${result.residualRisk}`),
  "",
].join("\n");
await fs.writeFile(path.join(outputDirectory, "latest.md"), markdown);
console.log(JSON.stringify({ outputDirectory, metrics: report.metrics, results: results.map(({ id, name, passed }) => ({ id, name, passed })) }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
