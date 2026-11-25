import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { buildSeedReport, readRegisteredBenchmarks } from "./validate-dev-lite-seed.mjs";

const summary = {
  seededOn: "2026-11-24",
  plans: ["HLT-IND-2026", "HLT-PLS-2026", "HLT-SRG-2026", "HLT-DGN-2026", "HLT-OPD-2026"],
  members: Object.fromEntries(["kazi", "sumit", "abdullah", "sadik", "rakibul"].map(key => [key, "BI-FIXTURE"])),
  claims: [
    { id: "CLM-2026-000201", status: "SETTLED" },
    { id: "CLM-2026-000202", status: "SETTLEMENT_AUTHORIZED" },
    { id: "CLM-2026-000203", status: "SUBMITTED" },
  ],
};

test("older seed summaries report seed-derived gaps and Dhaka calendar boundaries", () => {
  const result = buildSeedReport(summary, { today: "2026-11-25", defenceDate: "2026-12-24" });
  assert.equal(result.source, "seed summary and seed procedure");
  assert.equal(result.benchmarks.length, 12);
  assert.deepEqual(result.benchmarks.filter(row => row.registered).map(row => [row.hospital, row.service]), [
    ["hospital-demo", "DIAGNOSTIC"], ["hospital-demo", "INPATIENT"],
    ["hospital-2", "DIAGNOSTIC"], ["hospital-2", "INPATIENT"],
  ]);
  assert.equal(result.claim203Snapshot.attested, false);
  const sadik = result.policies.find(policy => policy.member === "Sadik");
  assert.deepEqual([sadik.waitingEnd, sadik.waitingToday, sadik.waitingDefence], ["2026-12-24", "waiting", "ends today"]);
  const rakibul = result.policies.find(policy => policy.member === "Rakibul");
  assert.deepEqual([rakibul.waitingEnd, rakibul.graceEnd, rakibul.graceToday, rakibul.graceDefence],
    [null, "2026-12-09", "open", "expired"]);
  assert.equal(result.days.today, "2026-11-25");
  assert.deepEqual(result.runningOrder.find(step => step.step === "14: Bank payout").claims, ["CLM-2026-000202"]);
  assert.deepEqual(result.runningOrder.find(step => step.step === "12: Start Oracle processing").claims, []);
  assert.deepEqual(result.runningOrder.find(step => step.step === "10–11: Propose and attest registry").claims, ["CLM-2026-000203"]);
});

test("ledger results override the seed estimates and list later eligible claims", () => {
  const result = buildSeedReport(summary, { today: "2026-12-09", live: {
    plans: [
      { id: "HLT-IND-2026", service: "INPATIENT", waitingDays: 0, hospitalIds: ["hospital-2"] },
    ],
    policies: [{ member: "Rakibul", id: "POL-2026-000105", status: "ACTIVE", startDate: "2026-11-24",
      coverStartDate: "2026-11-25", nextPremiumDueDate: "2026-12-24", gracePeriodDays: 15, waitingDays: 0 }],
    claims: [
      { id: "CLM-2026-000203", hospitalId: "hospital-2", status: "SUBMITTED" },
      { id: "STAGED-PANEL", hospitalId: "hospital-2", status: "MEDICAL_REVIEW_REQUIRED" },
    ],
    snapshots: [
      { id: "historical", hospitalId: "hospital-2", status: "SUPERSEDED", attestedAt: "2026-11-25" },
      { id: "staged", hospitalId: "hospital-2", status: "ACTIVE", attestedAt: "2026-11-25" },
    ],
    benchmarks: [{ hospitalId: "hospital-2", service: "INPATIENT" }],
  } });
  assert.deepEqual(result.claim203Snapshot, { claimId: "CLM-2026-000203", hospital: "hospital-2", attested: true, active: ["staged"] });
  assert.equal(result.policies[0].waitingEnd, "2026-11-25");
  assert.equal(result.policies[0].graceEnd, "2027-01-08");
  assert.deepEqual(result.runningOrder.find(step => step.step === "12: Start Oracle processing").claims, ["CLM-2026-000203"]);
  assert.deepEqual(result.runningOrder.find(step => step.step === "Panel fallback").claims, ["STAGED-PANEL"]);
});

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { common, peer } = require("@hyperledger/fabric-protos");

function benchmarkEnvelope(chaincode, args) {
  const input = new peer.ChaincodeInput();
  input.setArgsList(args.map(value => Buffer.from(value)));
  const id = new peer.ChaincodeID();
  id.setName(chaincode);
  const spec = new peer.ChaincodeSpec();
  spec.setChaincodeId(id);
  spec.setInput(input);
  const invocation = new peer.ChaincodeInvocationSpec();
  invocation.setChaincodeSpec(spec);
  const proposal = new peer.ChaincodeProposalPayload();
  proposal.setInput(invocation.serializeBinary());
  const actionPayload = new peer.ChaincodeActionPayload();
  actionPayload.setChaincodeProposalPayload(proposal.serializeBinary());
  const action = new peer.TransactionAction();
  action.setPayload(actionPayload.serializeBinary());
  const transaction = new peer.Transaction();
  transaction.addActions(action);
  const channel = new common.ChannelHeader();
  channel.setType(common.HeaderType.ENDORSER_TRANSACTION);
  const header = new common.Header();
  header.setChannelHeader(channel.serializeBinary());
  const payload = new common.Payload();
  payload.setHeader(header);
  payload.setData(transaction.serializeBinary());
  const envelope = new common.Envelope();
  envelope.setPayload(payload.serializeBinary());
  return envelope.serializeBinary();
}

test("a valid private benchmark registration is found even when no episode uses it", async () => {
  const info = new common.BlockchainInfo();
  info.setHeight(2);
  const data = new common.BlockData();
  data.setDataList([
    benchmarkEnvelope("insurance-contract", ["RegisterMedicalOracleBenchmark", "hospital-2", "DIAGNOSTIC"]),
    benchmarkEnvelope("insurance-contract", ["RegisterMedicalOracleBenchmark", "hospital-2", "SURGERY"]),
    benchmarkEnvelope("other-contract", ["RegisterMedicalOracleBenchmark", "hospital-2", "INPATIENT"]),
    benchmarkEnvelope("insurance-contract", ["OtherTransaction", "hospital-2", "CONSULTATION"]),
  ]);
  const metadata = new common.BlockMetadata();
  metadata.setMetadataList([Buffer.alloc(0), Buffer.alloc(0), Buffer.from([0, 11, 0, 0])]);
  const block = new common.Block();
  block.setData(data);
  block.setMetadata(metadata);
  const evaluate = async (name, ...args) => {
    assert.equal(args[0], "insurance-dev-lite-190");
    if (name === "GetChainInfo") return info.serializeBinary();
    assert.deepEqual([name, ...args.slice(1)], ["GetBlockByNumber", "1"]);
    return block.serializeBinary();
  };
  assert.deepEqual(await readRegisteredBenchmarks(evaluate, "insurance-dev-lite-190", "insurance-contract"),
    [{ hospitalId: "hospital-2", service: "DIAGNOSTIC" }]);
});
