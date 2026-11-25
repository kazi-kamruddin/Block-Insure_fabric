import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { digest } from "./v2/canonical.mjs";
import { evaluatorE2Hash } from "./v2/release.mjs";

export const evaluatorE3Version = "fabric-xgb-synthetic-e3";
export const evaluatorE3Hash = digest("oracle-v2:evaluator-release", {
  version: evaluatorE3Version,
  parentEvaluatorHash: evaluatorE2Hash,
  revisionDigest: "fabric-medical-intake-v2",
  patientToken: "fabric-medical-oracle-patient-v2",
  files: ["e3-release.mjs", "e3-worker.mjs"].map(file => [
    file, createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex"),
  ]),
});
