import { createHash } from "node:crypto";
import { common, ledger, peer } from "@hyperledger/fabric-protos";

const hex = /^[a-f0-9]{64}$/i;
const utf8 = (bytes) => Buffer.from(bytes).toString("utf8");
const json = (bytes) => JSON.parse(utf8(bytes));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relevantWrites = new Set([
  "oracleResult", "medicalApprovalCertificate", "medicalHeldReplacementCertificate", "medicalAuditSelection",
]);

export function canonicalProtocolHash(domain, ...values) {
  return sha256(domain + values.map((value) => {
    const text = String(value);
    return `|${Buffer.byteLength(text)}:${text}`;
  }).join(""));
}

export function decodeDossierTransaction(bytes, { txId, channel, chaincode }) {
  const processed = peer.ProcessedTransaction.deserializeBinary(bytes);
  const envelope = processed.getTransactionenvelope();
  if (!envelope || processed.getValidationcode() !== peer.TxValidationCode.VALID) {
    throw new Error("Dossier transaction was not valid");
  }
  const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
  const header = common.ChannelHeader.deserializeBinary(payload.getHeader().getChannelHeader_asU8());
  if (header.getType() !== common.HeaderType.ENDORSER_TRANSACTION ||
      header.getTxId() !== txId || header.getChannelId() !== channel) {
    throw new Error("Dossier transaction ID, channel or type differs");
  }
  const txTimestamp = header.getTimestamp();
  if (!txTimestamp) throw new Error("Dossier transaction timestamp is missing");
  const seconds = new Date(txTimestamp.getSeconds() * 1_000).toISOString().slice(0, -5);
  const nanos = String(txTimestamp.getNanos()).padStart(9, "0").replace(/0+$/, "");
  const timestamp = `${seconds}${nanos ? `.${nanos}` : ""}Z`;
  const records = [];
  const transaction = peer.Transaction.deserializeBinary(payload.getData_asU8());
  for (const action of transaction.getActionsList()) {
    const actionPayload = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8());
    const endorsed = actionPayload.getAction();
    if (!endorsed) continue;
    const proposal = peer.ChaincodeProposalPayload.deserializeBinary(actionPayload.getChaincodeProposalPayload_asU8());
    const spec = peer.ChaincodeInvocationSpec.deserializeBinary(proposal.getInput_asU8()).getChaincodeSpec();
    if (spec?.getChaincodeId()?.getName() !== chaincode) continue;
    const args = spec.getInput().getArgsList_asU8().map(utf8);
    const response = peer.ProposalResponsePayload.deserializeBinary(endorsed.getProposalResponsePayload_asU8());
    const result = peer.ChaincodeAction.deserializeBinary(response.getExtension_asU8());
    const writes = ledger.rwset.TxReadWriteSet.deserializeBinary(result.getResults_asU8()).getNsRwsetList()
      .filter((row) => row.getNamespace() === chaincode)
      .flatMap((row) => ledger.rwset.kvrwset.KVRWSet.deserializeBinary(row.getRwset_asU8()).getWritesList());
    for (const write of writes) {
      const [, assetType] = write.getKey().split("\0");
      if (!write.getIsDelete() && relevantWrites.has(assetType)) {
        records.push({ assetType, value: json(write.getValue_asU8()), args });
      }
    }
  }
  return { timestamp, records };
}

export function recomputePayoutBreakdown({ certificate, policy, quote, rules, statementHash, statementVersion }) {
  const inputs = {
    packageId: rules.packageId,
    rulesVersion: rules.version,
    termsHash: rules.termsHash,
    billedMinor: quote.billedMinor,
    serviceSublimitMinor: rules.serviceSublimitMinor,
    deductibleBps: rules.deductibleBps,
    deductibleCapMinor: rules.deductibleCapMinor,
    insurerShareBps: rules.insurerShareBps,
    coverageLimitMinor: policy.coverageLimitMinor,
    remainingCoverMinor: quote.remainingCoverMinor,
  };
  const numbers = Object.values(inputs).slice(3);
  if (!numbers.every((value) => Number.isSafeInteger(value) && value >= 0) ||
      inputs.deductibleBps > 10_000 || inputs.insurerShareBps > 10_000 ||
      inputs.remainingCoverMinor > inputs.coverageLimitMinor) {
    throw new Error("Invalid payout breakdown inputs");
  }
  const rate = (amount, bps) => Number(BigInt(amount) * BigInt(bps) / 10_000n);
  const eligibleMinor = Math.min(inputs.billedMinor, inputs.serviceSublimitMinor);
  const deductibleMinor = Math.min(rate(eligibleMinor, inputs.deductibleBps), inputs.deductibleCapMinor);
  const insurerShareMinor = rate(eligibleMinor - deductibleMinor, inputs.insurerShareBps);
  const payableMinor = Math.min(inputs.remainingCoverMinor, insurerShareMinor);
  const values = { eligibleMinor, deductibleMinor, insurerShareMinor, payableMinor };
  if (!Object.entries(values).every(([name, value]) => quote[name] === value) ||
      payableMinor !== certificate.amountMinor ||
      inputs.packageId !== certificate.packageId || inputs.rulesVersion !== certificate.rulesVersion ||
      inputs.termsHash !== certificate.termsHash || inputs.termsHash !== policy.termsHash) {
    throw new Error("Payout amounts or terms differ from the accepted statement and certificate");
  }
  const breakdownHash = canonicalProtocolHash("fabric-medical-breakdown-v1", statementHash,
    inputs.billedMinor, inputs.serviceSublimitMinor, eligibleMinor, inputs.deductibleCapMinor, deductibleMinor,
    inputs.insurerShareBps, insurerShareMinor, inputs.coverageLimitMinor, inputs.remainingCoverMinor, payableMinor);
  return { inputs, values, statementHash, statementVersion, breakdownHash };
}

export async function readDossierLedgerEvidence({ contract, qscc, channel, chaincode },
  { claim, history, oracleRequests, oracleResults, approvalCertificate }) {
  const evaluate = async (name, ...args) => json(await contract.evaluateTransaction(name, ...args));
  const transactions = new Map();
  const getTransaction = async (txId) => {
    if (!transactions.has(txId)) {
      const bytes = await qscc.evaluateTransaction("GetTransactionByID", channel, txId);
      transactions.set(txId, decodeDossierTransaction(bytes, { txId, channel, chaincode }));
    }
    return transactions.get(txId);
  };
  const oracleReveals = [];
  const requestIdsWithResults = new Set(oracleResults.map(({ requestId }) => requestId));
  for (const requestId of requestIdsWithResults) {
    const requestHistory = await evaluate("GetOracleRequestHistory", requestId);
    for (const item of requestHistory) {
      const count = item.value?.revealCount;
      // Fabric's history may return newest first. Only the committed write
      // set identifies which transaction added each result.
      if (typeof count !== "number" || count <= 0) continue;
      const transaction = await getTransaction(item.txId);
      for (const record of transaction.records) {
        if (record.assetType !== "oracleResult" || record.value.requestId !== requestId) continue;
        const result = oracleResults.find(({ id }) => id === record.value.id);
        if (!result) continue;
        const [name, id, verified, code, recordHash, resultHash, claimVersion, registryVersion, modelVersion, modelHash, salt] = record.args;
        const request = oracleRequests.find((row) => row.id === requestId);
        if (request?.protocolVersion === "v2") {
          const [action, reqId, facts, decision, saltV2, diagnostics] = record.args;
          if (action !== "RevealOracleResultV2" || reqId !== requestId || facts !== result.factVectorJSON ||
              decision !== result.decision || diagnostics !== result.workerDiagnosticsHash || !hex.test(saltV2)) {
            throw new Error("Committed Oracle v2 reveal differs from its result");
          }
          oracleReveals.push({ resultId: result.id, requestId, oracleId: result.oracleId, txId: item.txId, salt: saltV2 });
          continue;
        }
        if (name !== "RevealOracleResult" || id !== requestId || verified !== String(result.verified) ||
            code.trim().toUpperCase() !== result.verificationCode || recordHash.toLowerCase() !== result.recordHash ||
            resultHash.toLowerCase() !== result.resultHash || Number(claimVersion) !== result.claimVersion ||
            Number(registryVersion) !== result.registryVersion || modelVersion !== result.modelVersion ||
            modelHash.toLowerCase() !== request?.modelHash || !hex.test(salt)) {
          throw new Error("Committed reveal input differs from its result");
        }
        oracleReveals.push({ resultId: result.id, requestId, oracleId: result.oracleId, txId: item.txId, salt: salt.toLowerCase() });
      }
    }
  }
  if (new Set(oracleReveals.map(({ resultId }) => resultId)).size !== oracleResults.length ||
      oracleReveals.length !== oracleResults.length) {
    throw new Error("One or more committed Oracle reveal inputs are unavailable");
  }
  // Retain the same ordering as the separately evaluated result list.
  const revealsById = new Map(oracleReveals.map((item) => [item.resultId, item]));

  let certificateWrite = null;
  const sampledVersions = new Map();
  const pendingAuditVersions = new Set(history.filter(item => item.value?.status === "MEDICAL_AUDIT_PENDING").map(item => item.value.version));
  for (const item of history) {
    const version = item.value?.version;
    const afterSampling = pendingAuditVersions.has(version) &&
      item.value?.status !== "MEDICAL_AUDIT_PENDING" && !sampledVersions.has(version);
    const possibleWrite = approvalCertificate && version === approvalCertificate.claimVersion &&
      item.value?.status === "APPROVED" && !certificateWrite;
    if (!possibleWrite && !afterSampling) continue;
    const transaction = await getTransaction(item.txId);
    for (const { assetType, value } of transaction.records) {
      if (assetType === "medicalAuditSelection" && value.claimId === claim.id && value.version === version) {
        sampledVersions.set(version, value);
      }
      if ((assetType === "medicalApprovalCertificate" || assetType === "medicalHeldReplacementCertificate") &&
          value.claimId === claim.id && value.hash === approvalCertificate?.hash) {
        const bytes = await qscc.evaluateTransaction("GetBlockByTxID", channel, item.txId);
        const blockNumber = common.Block.deserializeBinary(bytes).getHeader()?.getNumber();
        if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) throw new Error("Missing certificate write block");
        certificateWrite = { transactionId: item.txId, issuedAt: transaction.timestamp, blockNumber, blockHash: sha256(bytes),
          approvalTimeLabel: approvalCertificate.path === "ORACLE_AUTO" ? "Oracle finalised at" : "Panel closed at" };
      }
    }
  }
  if (approvalCertificate && !certificateWrite) throw new Error("Certificate write transaction is unavailable");
  const auditSampling = [];
  for (const request of oracleRequests.filter((item) => item.auditPeriodId)) {
    const period = await evaluate("ReadMedicalAuditPeriod", request.auditPeriodId);
    const selection = sampledVersions.get(request.claimVersion);
    auditSampling.push({ requestId: request.id, period,
      selection: selection && selection.resultHash === request.resultHash && selection.periodId === period.id ? selection : null });
  }

  let payoutBreakdown = null;
  if (approvalCertificate?.breakdownHash) {
    const [quote, rules, policy] = await Promise.all([
      evaluate("ReadMedicalStatement", claim.id, String(claim.version)),
      evaluate("ReadMedicalRules", approvalCertificate.packageId),
      evaluate("ReadPolicy", claim.policyId),
    ]);
    if (quote.statementHash !== approvalCertificate.statementHash) throw new Error("Current statement differs from the certificate");
    // A clarification successor retains its original terms commitment. Check
    // earlier version statements from actual claim history for that commitment.
    const earlier = history.filter((item) => item.value?.version < claim.version &&
      hex.test(item.value?.descriptionHash)).map(({ value }) => [value.version, value.descriptionHash]).reverse();
    const plainStatement = canonicalProtocolHash("fabric-medical-statement-v1", policy.id, policy.termsHash,
      approvalCertificate.episodeRevisionHash, approvalCertificate.episodeRevision, quote.payableMinor, quote.remainingCoverMinor);
    // A corrected appeal commits the plain quote into the payout breakdown
    // before wrapping the statement in the appeal successor commitment.
    const statements = [[claim.version, quote.statementHash], [claim.version, plainStatement], ...earlier];
    for (const [statementVersion, statementHash] of statements) {
      const candidate = recomputePayoutBreakdown({ certificate: approvalCertificate, policy, quote, rules,
        statementVersion, statementHash });
      if (candidate.breakdownHash === approvalCertificate.breakdownHash) {
        payoutBreakdown = candidate;
        break;
      }
    }
    if (!payoutBreakdown) throw new Error("Payout breakdown does not reproduce the certificate commitment");
  }
  const pins = oracleRequests.filter(request => request.protocolVersion === "v2").flatMap(request => request.manifest.pins);
  async function readPinned(versionField, transaction) {
    const keys = new Map(pins.map(pin => [`${pin.issuerId}:${pin[versionField]}`, pin]));
    return Promise.all([...keys.values()].map(pin => evaluate(transaction, pin.issuerId, String(pin[versionField]))));
  }
  const sourceEvidence = pins.length ? {
    oracleSourceIssuers: await readPinned("keyVersion", "ReadSourceIssuer"),
    oracleSourceFeeds: await readPinned("feedVersion", "ReadSourceFeed"),
  } : {};
  return { oracleReveals: oracleResults.map(({ id }) => revealsById.get(id)), certificateWrite, auditSampling, payoutBreakdown, ...sourceEvidence };
}
