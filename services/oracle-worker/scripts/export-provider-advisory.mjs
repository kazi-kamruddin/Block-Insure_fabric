import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [, , reportPath, artifactPath] = process.argv;
if (!reportPath || !artifactPath) throw new Error("Supply the existing provider benchmark report and an artifact output path");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const model = report.models.find(model => model.kind === "logistic");
if (!model) throw new Error("Logistic regression artifact is absent");
const artifact = JSON.stringify({ model, features: report.features, scoreScale: report.scoreScale });
await writeFile(artifactPath, artifact, { flag: "wx" });
console.log(JSON.stringify({ id: "provider-logistic-v1", modelVersion: "provider-logistic-v1",
  featureSchema: "provider-aggregates-v1", calibrationVersion: "provider-calibration-v1",
  intendedTask: "ADVISORY", artifactHash: createHash("sha256").update(artifact).digest("hex") }));
