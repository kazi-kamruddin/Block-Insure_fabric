import assert from "node:assert/strict";
import test from "node:test";
import { fitPeers, generateCohort, peerHistoryFeatures, rankFeatures } from "./cohort.mjs";
import { fitModels, rawMargin, scoreChallenger } from "./models.mjs";

test("peer bounds are fitted to early training records and missing groups use the pooled bound", () => {
  const { records } = generateCohort("train");
  const peers = fitPeers(records);
  const future = { ...records[0], invoiceDate: "2026-09-01", amountMinor: 900000 };
  assert.deepEqual(fitPeers([...records, future]), peers);
  assert.equal(peers.cuts.OTHER, undefined);
  const record = { ...records[0], treatmentType: "OTHER", amountMinor: peers.pooled * 1.5, admissionDate: "2026-08-25" };
  const prior = { ...record, invoiceDate: "2026-08-30", dischargeDate: "2026-08-30" };
  const sameDay = { ...prior, invoiceDate: "2026-09-01" };
  const wrongIssuer = { ...prior, patientIssuerMsp: "DifferentMSP" };
  assert.deepEqual(peerHistoryFeatures(record, [prior, sameDay, future, wrongIssuer], "2026-09-01", peers),
    { peerExcess: 0.5, overlap14: Math.log1p(1) });
});

test("stump explanations add to the margin and ranker replays finite monotone scores", () => {
  const rows = Array.from({ length: 84 }, (_, i) => {
    const excess = (i % 14) / 13;
    const features = Object.fromEntries(rankFeatures.map((key, j) => [key, (i * (j + 1)) % 11 / 10]));
    features.peerExcess = excess;
    const label = Number(excess >= 0.6);
    return { features, label, provider: "provider-" + Math.floor(i / 14), mandatory: false };
  });
  const models = fitModels(rows.slice(0, 56), rows.slice(56));
  const stumps = models.find((model) => model.id === "additive-stumps");
  const ranker = models.find((model) => model.id === "monotonic-ranker");
  assert.ok(ranker.trees.some((tree) => tree.feature), "Ranker should learn a split");
  assert.ok(rawMargin(ranker, rows[13].features) > rawMargin(ranker, rows[0].features));
  for (const row of rows.slice(56)) {
    const { margin, explanation } = scoreChallenger(stumps, row.features);
    assert.ok(Math.abs(margin - explanation.base - Object.values(explanation.contributions).reduce((sum, x) => sum + x, 0)) < 1e-12);
    for (const increasing of ranker.monotone) {
      const low = { ...row.features, [increasing]: 0 };
      const high = { ...row.features, [increasing]: 2 };
      assert.ok(scoreChallenger(ranker, low).scoreUnits <= scoreChallenger(ranker, high).scoreUnits);
    }
    const exported = JSON.parse(JSON.stringify(ranker));
    assert.deepEqual(scoreChallenger(exported, row.features), scoreChallenger(ranker, row.features));
  }
  assert.throws(() => scoreChallenger(ranker, { ...rows[0].features, peerExcess: NaN }), /invalid challenger feature/);
});
