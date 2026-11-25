import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "vitest";
import { common, ledger, peer } from "@hyperledger/fabric-protos";
import { decodeDossierTransaction, readDossierLedgerEvidence, recomputePayoutBreakdown } from "./dossier-ledger-evidence.mjs";

const require = createRequire(import.meta.url);
const { Timestamp } = require("google-protobuf/google/protobuf/timestamp_pb.js");
const identity = { txId: "tx-42", channel: "test-channel", chaincode: "insurance-contract" };

function encodeProcessedTransaction(validation, { txId = identity.txId,
  args = ["RevealOracleResult", "req-42"], value = { id: "req-42:oracle1" } } = {}) {
  const chaincodeId = new peer.ChaincodeID();
  chaincodeId.setName(identity.chaincode);
  const input = new peer.ChaincodeInput();
  input.setArgsList(args.map(item => Buffer.from(item)));
  const chaincodeSpec = new peer.ChaincodeSpec();
  chaincodeSpec.setChaincodeId(chaincodeId);
  chaincodeSpec.setInput(input);
  const invocation = new peer.ChaincodeInvocationSpec();
  invocation.setChaincodeSpec(chaincodeSpec);
  const proposal = new peer.ChaincodeProposalPayload();
  proposal.setInput(invocation.serializeBinary());

  const write = new ledger.rwset.kvrwset.KVWrite();
  write.setKey(`\0oracleResult\0${value.id}\0`);
  write.setValue(Buffer.from(JSON.stringify(value)));
  const kv = new ledger.rwset.kvrwset.KVRWSet();
  kv.setWritesList([write]);
  const namespace = new ledger.rwset.NsReadWriteSet();
  namespace.setNamespace(identity.chaincode);
  namespace.setRwset(kv.serializeBinary());
  const rwset = new ledger.rwset.TxReadWriteSet();
  rwset.setNsRwsetList([namespace]);
  const chaincodeAction = new peer.ChaincodeAction();
  chaincodeAction.setResults(rwset.serializeBinary());
  const response = new peer.ProposalResponsePayload();
  // The generated setter uses a suffix to avoid jspb.Message.setExtension.
  response.setExtension$(chaincodeAction.serializeBinary());
  const endorsed = new peer.ChaincodeEndorsedAction();
  endorsed.setProposalResponsePayload(response.serializeBinary());
  const actionPayload = new peer.ChaincodeActionPayload();
  actionPayload.setAction(endorsed);
  actionPayload.setChaincodeProposalPayload(proposal.serializeBinary());
  const action = new peer.TransactionAction();
  action.setPayload(actionPayload.serializeBinary());
  const transaction = new peer.Transaction();
  transaction.setActionsList([action]);

  const timestamp = new Timestamp();
  timestamp.setSeconds(Date.parse("2026-11-25T01:02:03Z") / 1_000);
  timestamp.setNanos(123_400);
  const channelHeader = new common.ChannelHeader();
  channelHeader.setType(common.HeaderType.ENDORSER_TRANSACTION);
  channelHeader.setChannelId(identity.channel);
  channelHeader.setTxId(txId);
  channelHeader.setTimestamp(timestamp);
  const header = new common.Header();
  header.setChannelHeader(channelHeader.serializeBinary());
  const payload = new common.Payload();
  payload.setHeader(header);
  payload.setData(transaction.serializeBinary());
  const envelope = new common.Envelope();
  envelope.setPayload(payload.serializeBinary());
  const processed = new peer.ProcessedTransaction();
  processed.setTransactionenvelope(envelope);
  processed.setValidationcode(validation);
  return processed.serializeBinary();
}

test("dossier reads committed invocation and write set from the selected channel", () => {
  const bytes = encodeProcessedTransaction(peer.TxValidationCode.VALID);
  assert.deepEqual(decodeDossierTransaction(bytes, identity), {
    timestamp: "2026-11-25T01:02:03.0001234Z",
    records: [{ assetType: "oracleResult", value: { id: "req-42:oracle1" }, args: ["RevealOracleResult", "req-42"] }],
  });
  assert.throws(() => decodeDossierTransaction(bytes, { ...identity, channel: "other" }), /channel or type differs/);
  assert.throws(() => decodeDossierTransaction(encodeProcessedTransaction(peer.TxValidationCode.MVCC_READ_CONFLICT), identity),
    /not valid/);
});

test("dossier opens both reveals when Fabric returns newest history first", async () => {
  const requestId = "req-42", digest = "a".repeat(64), modelHash = "b".repeat(64);
  const results = ["oracle1", "oracle2"].map(oracleId => ({
    id: `${requestId}:${oracleId}`, oracleId, requestId, verified: true, verificationCode: "VERIFIED",
    claimVersion: 1, registryVersion: 1, modelVersion: "model-v1", recordHash: digest, resultHash: digest,
  }));
  const transmissions = Object.fromEntries(results.map((result, index) => [`tx-${index}`,
    encodeProcessedTransaction(peer.TxValidationCode.VALID, { txId: `tx-${index}`, value: result,
      args: ["RevealOracleResult", requestId, "true", "VERIFIED", digest, digest, "1", "1", "model-v1", modelHash, digest],
    }),
  ]));
  const report = await readDossierLedgerEvidence({
    ...identity,
    contract: { evaluateTransaction: async () => Buffer.from(JSON.stringify([
      { txId: "tx-1", value: { revealCount: 2 } }, { txId: "tx-0", value: { revealCount: 1 } },
    ])) },
    qscc: { evaluateTransaction: async (_fn, _channel, txId) => transmissions[txId] },
  }, { claim: { id: "claim-42" }, history: [], oracleRequests: [{ id: requestId, modelHash }],
    oracleResults: results, approvalCertificate: null });
  assert.deepEqual(report.oracleReveals.map(reveal => reveal.oracleId), ["oracle1", "oracle2"]);
});

test("dossier reproduces the chaincode's capped and floored payout in minor units", () => {
  const termsHash = "f".repeat(64);
  const certificate = { packageId: "package", rulesVersion: 1, termsHash, amountMinor: 3000 };
  const policy = { coverageLimitMinor: 50_000, termsHash };
  const quote = { billedMinor: 5000, eligibleMinor: 4999, deductibleMinor: 400, insurerShareMinor: 3679,
    remainingCoverMinor: 3000, payableMinor: 3000 };
  const rules = { packageId: "package", version: 1, termsHash, serviceSublimitMinor: 4999,
    deductibleBps: 1000, deductibleCapMinor: 400, insurerShareBps: 8000 };
  const statementHash = "a".repeat(64);
  const inputs = { certificate, policy, quote, rules, statementHash, statementVersion: 1 };
  const expected = {
    eligibleMinor: 4999, deductibleMinor: 400, insurerShareMinor: 3679, payableMinor: 3000,
  };
  assert.deepEqual(recomputePayoutBreakdown(inputs).values, expected);
  assert.throws(() => recomputePayoutBreakdown({ ...inputs, quote: { ...quote, deductibleMinor: 401 } }),
    /differ from the accepted statement/);
});
