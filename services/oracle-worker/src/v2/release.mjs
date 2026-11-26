import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { digest } from "./canonical.mjs";
import { evaluatorHash } from "../xgboost.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export const evaluatorE2Version = "fabric-xgb-synthetic-e2";
export const evaluatorE2Hash = digest("oracle-v2:evaluator-release", {
  version: evaluatorE2Version,
  v1EvaluatorHash: evaluatorHash,
  provenanceHash: sha256(readFileSync(new URL("../../frozen/provenance.json", import.meta.url))),
  files: readdirSync(new URL(".", import.meta.url)).filter(file => file.endsWith(".mjs")).sort()
    .map(file => [file, sha256(readFileSync(new URL(file, import.meta.url)))]),
});
