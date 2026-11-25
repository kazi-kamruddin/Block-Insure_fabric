import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import vectors from "../../../../services/oracle-worker/test/fixtures/canonical-vectors.json";
import { canonical, hash, verifyExplanation, verifyV2Explanation, type ExplanationReceipt } from "./explanation-receipt";

const payload = {
  evaluatorHash: "a".repeat(64), contextHash: "b".repeat(64),
  assessment: {
    explanation: { contributions: { amount: 0.25, invoice_lag_days: -0.6 } },
    riskScoreUnits: 40, policy: { thresholdUnits: 50 }, reasons: [],
    uncertainty: { ood: { distance: 9 } },
  },
};
const finalCode = "XGB_AUTO:" + hash(payload).toUpperCase();
const receipt = (oracleId: string): ExplanationReceipt => ({
  schema: "explanation-receipt-v1", requestId: "request-201", oracleId, ...payload,
});
const finalResults = ["oracle1", "oracle2"].map(oracleId => ({ oracleId, verificationCode: finalCode }));

describe("Oracle explanation receipts", () => {
  it.each(vectors)("uses the frozen worker's canonical bytes", vector => {
    expect(canonical(vector.value)).toBe(vector.canonical);
    expect(hash(vector.value)).toBe(vector.sha256);
  });
  it("requires matching receipts from two distinct assignees with committed results", () => {
    expect(verifyExplanation([receipt("oracle1"), receipt("oracle2")], finalResults, payload.evaluatorHash))
      .toMatchObject({ verified: true, matchingWorkers: 2, scoreUnits: 40, thresholdUnits: 50,
        ood: { distance: 9, threshold: 8.8, outOfRange: true } });
    expect(verifyExplanation([receipt("oracle1"), receipt("oracle1")], finalResults, payload.evaluatorHash))
      .toMatchObject({ verified: false, matchingWorkers: 1 });
    expect(verifyExplanation([receipt("oracle1"), receipt("oracle3")], finalResults, payload.evaluatorHash))
      .toMatchObject({ verified: false, matchingWorkers: 1 });
  });
  it("makes a mutated contribution unverified", () => {
    const altered = structuredClone(receipt("oracle2"));
    altered.assessment.explanation.contributions.amount = 2;
    expect(verifyExplanation([receipt("oracle1"), altered], finalResults, payload.evaluatorHash))
      .toMatchObject({ verified: false, matchingWorkers: 1 });
  });
  it("verifies each v2 worker against its own committed diagnostic hash", () => {
    const diagnostics = { schema: "oracle-worker-diagnostics-v1", evaluatorHash: payload.evaluatorHash, contextHash: payload.contextHash,
      explanation: payload.assessment.explanation, outOfDistribution: { distance: 9 }, ratios: {}, retrievalPath: "DIRECT", retrievalReceipts: [] };
    const workerDiagnosticsHash = createHash("sha256").update("oracle-v2:worker-diagnostics\0" + canonical(diagnostics)).digest("hex");
    const result = { requestId: "request-201", oracleId: "oracle1", workerDiagnosticsHash };
    const report = { ...diagnostics, ...result, schema: "oracle-v2-explanation-receipt-v1" };
    expect(verifyV2Explanation(report, result, payload.evaluatorHash)).toBe(true);
    expect(verifyV2Explanation({ ...report, oracleId: "oracle2" }, result, payload.evaluatorHash)).toBe(false);
    expect(verifyV2Explanation({ ...report, explanation: null }, result, payload.evaluatorHash)).toBe(false);
  });
});
