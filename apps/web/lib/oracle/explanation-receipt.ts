import { createHash } from "node:crypto";

type Assessment = {
  riskScoreUnits: number;
  policy: { thresholdUnits: number };
  reasons: string[];
  explanation: { contributions: Record<string, number> };
  uncertainty: { ood: { distance: number } };
};

export type ExplanationReceipt = {
  schema: "explanation-receipt-v1";
  requestId: string;
  oracleId: string;
  evaluatorHash: string;
  contextHash: string;
  assessment: Assessment;
};

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export const explanationOodThreshold = 8.8;

export function verifyV2Explanation(receipt: unknown, result: { requestId: string; oracleId: string; workerDiagnosticsHash?: string }, evaluatorHash: string) {
  if (!receipt || typeof receipt !== "object" || !result.workerDiagnosticsHash) return false;
  const row = receipt as Record<string, unknown>;
  if (row.schema !== "oracle-v2-explanation-receipt-v1" || row.requestId !== result.requestId || row.oracleId !== result.oracleId ||
      row.evaluatorHash !== evaluatorHash || row.workerDiagnosticsHash !== result.workerDiagnosticsHash ||
      typeof row.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(row.contextHash) ||
      !["DIRECT", "MIRROR", "ORACLE_PEER_AND_SIGNED_FEEDS"].includes(String(row.retrievalPath))) return false;
  const diagnostics = {
    schema: "oracle-worker-diagnostics-v1",
    evaluatorHash: row.evaluatorHash, contextHash: row.contextHash, explanation: row.explanation ?? null,
    outOfDistribution: row.outOfDistribution ?? null, ratios: row.ratios ?? {},
    retrievalPath: row.retrievalPath, retrievalReceipts: row.retrievalReceipts ?? [],
  };
  return createHash("sha256").update("oracle-v2:worker-diagnostics\0" + canonical(diagnostics)).digest("hex") === result.workerDiagnosticsHash;
}

export function verifyExplanation(
  receipts: ExplanationReceipt[],
  results: { oracleId: string; verificationCode: string }[],
  modelHash: string,
) {
  const codes = new Map(results.map(result => [result.oracleId, result.verificationCode]));
  const groups = new Map<string, { workers: Set<string>; assessment: Assessment }>();
  for (const { schema, oracleId, contextHash, evaluatorHash, assessment } of receipts) {
    const match = /^XGB_(?:AUTO|REVIEW):([a-f0-9]{64})$/i.exec(codes.get(oracleId) ?? "");
    if (!match || schema !== "explanation-receipt-v1" || evaluatorHash !== modelHash || !/^[a-f0-9]{64}$/.test(contextHash)) continue;
    const digest = hash({ contextHash, evaluatorHash, assessment });
    if (digest !== match[1].toLowerCase() || !Number.isSafeInteger(assessment?.riskScoreUnits) ||
        !Number.isSafeInteger(assessment.policy?.thresholdUnits) || !Number.isFinite(assessment.uncertainty?.ood?.distance) ||
        !Array.isArray(assessment.reasons) || !assessment.explanation?.contributions) continue;
    const key = canonical({ contextHash, evaluatorHash, assessment });
    if (!groups.has(key)) groups.set(key, { workers: new Set(), assessment });
    groups.get(key)!.workers.add(oracleId);
  }
  const best = [...groups.values()].sort((left, right) => right.workers.size - left.workers.size)[0];
  const distance = best?.assessment.uncertainty.ood.distance ?? null;
  return {
    verified: (best?.workers.size ?? 0) >= 2,
    matchingWorkers: best?.workers.size ?? 0,
    topContributions: Object.entries(best?.assessment.explanation.contributions ?? {})
      .filter(([, contribution]) => Number.isFinite(contribution))
      .sort(([leftName, left], [rightName, right]) => Math.abs(right) - Math.abs(left) || leftName.localeCompare(rightName))
      .slice(0, 5).map(([feature, contribution]) => ({ feature, contribution })),
    scoreUnits: best?.assessment.riskScoreUnits ?? null,
    thresholdUnits: best?.assessment.policy.thresholdUnits ?? null,
    mandatoryHits: best?.assessment.reasons.filter(reason => reason !== "MODEL_THRESHOLD") ?? [],
    ood: { distance, threshold: explanationOodThreshold, outOfRange: distance !== null && distance > explanationOodThreshold },
  };
}
