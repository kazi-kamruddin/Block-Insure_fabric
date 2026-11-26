import { createHash } from "node:crypto";
import { canonical } from "../xgboost.mjs";

export function workerDiagnosticsHash({ evaluatorHash, contextHash, explanation = null, outOfDistribution = null,
  ratios = {}, retrievalPath, retrievalReceipts = [] }) {
  if (![evaluatorHash, contextHash, retrievalPath].every(value => typeof value === "string" && value)) {
    throw new TypeError("Evaluator, context and retrieval-path identities are required");
  }
  const packet = { schema: "oracle-worker-diagnostics-v1", evaluatorHash, contextHash, explanation,
    outOfDistribution, ratios, retrievalPath, retrievalReceipts };
  return createHash("sha256").update("oracle-v2:worker-diagnostics\0" + canonical(packet)).digest("hex");
}
