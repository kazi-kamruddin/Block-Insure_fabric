import { createHash, createPrivateKey } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { freemem } from "node:os";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const requireFromWeb = createRequire(path.join(projectRoot, "apps", "web", "package.json"));
const grpc = requireFromWeb("@grpc/grpc-js");
const fabricGateway = requireFromWeb("@hyperledger/fabric-gateway");

// The local defence profile samples the Windows host around endorsement and
// submission. Metrics contain transaction identity and status only.
export async function submitGuardedOracleTransaction(contract, method, args, report, availableMemory = freemem) {
  const started = performance.now();
  const record = fields => report({ method, elapsedMs: Math.round(performance.now() - started), ...fields });
  const guard = () => {
    if (availableMemory() < 700 * 1024 * 1024) {
      record({ refusal: "MEMORY_GUARD" });
      throw Object.assign(new Error("Oracle submission requires 700 MB available"), { code: "ORACLE_MEMORY_FLOOR" });
    }
  };
  let transaction;
  try {
    guard();
    transaction = await contract.newProposal(method, { arguments: args }).endorse();
  } catch (error) {
    if (error.code !== "ORACLE_MEMORY_FLOOR") {
      const details = (error.details ?? []).map(value => value.message).join(" ");
      record({ refusal: /disseminat/i.test(details) ? "DISSEMINATION_REFUSAL" : "ENDORSEMENT_REFUSAL" });
    }
    throw error;
  }
  guard();
  const submitted = await transaction.submit();
  let status;
  try {
    status = await submitted.getStatus();
  } catch (error) {
    record({ transactionId: submitted.getTransactionId(), status: "UNKNOWN_AFTER_SUBMIT" });
    throw error;
  }
  record({ transactionId: status.transactionId, blockNumber: String(status.blockNumber), code: status.code });
  if (!status.successful) {
    throw new fabricGateway.CommitError({
      message: `Oracle transaction ${status.transactionId} committed with status ${status.code}`,
      transactionId: status.transactionId, code: status.code,
    });
  }
  return submitted.getResult();
}

async function findSingleCredential(directory) {
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  if (entries.length !== 1) throw new Error(`Expected exactly one credential in ${directory}; found ${entries.length}`);
  return entries[0];
}

export async function connectOracleGateway(config) {
  const [tlsRootCertificate, certificatePath, privateKeyPath] = await Promise.all([
    fs.readFile(config.fabric.tlsCertificatePath),
    findSingleCredential(path.join(config.fabric.userMspPath, "signcerts")),
    findSingleCredential(path.join(config.fabric.userMspPath, "keystore")),
  ]);
  const [certificate, privateKey] = await Promise.all([fs.readFile(certificatePath), fs.readFile(privateKeyPath)]);
  const client = new grpc.Client(
    config.fabric.peerEndpoint,
    grpc.credentials.createSsl(tlsRootCertificate),
    {
      "grpc.ssl_target_name_override": config.fabric.peerHostAlias,
      "grpc.default_authority": config.fabric.peerHostAlias,
    },
  );
  const gateway = fabricGateway.connect({
    client,
    identity: { mspId: config.fabric.mspId, credentials: certificate },
    signer: fabricGateway.signers.newPrivateKeySigner(createPrivateKey(privateKey)),
    hash: fabricGateway.hash.sha256,
    evaluateOptions: () => ({ deadline: new Date(Date.now() + 5_000) }),
    endorseOptions: () => ({ deadline: new Date(Date.now() + 15_000) }),
    submitOptions: () => ({ deadline: new Date(Date.now() + 5_000) }),
    commitStatusOptions: () => ({ deadline: new Date(Date.now() + 60_000) }),
  });
  const network = gateway.getNetwork(config.fabric.channelName);
  return {
    gateway,
    network,
    contract: network.getContract(config.fabric.chaincodeName),
    privateKey,
    identityFingerprint: createHash("sha256").update(certificate).digest("hex"),
    close() {
      gateway.close();
      client.close();
    },
  };
}
