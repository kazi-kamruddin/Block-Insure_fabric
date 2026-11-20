import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { confirmWithApproval, parseSigningRequest } from "./confirmation.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const grpc = require("@grpc/grpc-js");
const { connect, hash, signers } = require("@hyperledger/fabric-gateway");
const channel = "insurance-dev-lite-190";
const decodeResult = bytes => JSON.parse(Buffer.from(bytes).toString("utf8"));
const deadline = seconds => () => ({ deadline: Date.now() + seconds * 1000 });

async function main() {
  const [requestFile, certificateFile, privateKeyFile, peerTLSFile, ...extra] = process.argv.slice(2);
  if (!requestFile || !certificateFile || !privateKeyFile || !peerTLSFile || extra.length || !stdin.isTTY) {
    throw new Error("Use an interactive terminal: node tools/bank-signer/confirm-dev-lite.mjs REQUEST_JSON BANK_CERT BANK_KEY DEV_LITE_BANK_PEER_TLS_CA");
  }
  const request = parseSigningRequest(JSON.parse(await readFile(requestFile, "utf8")));
  const [certificate, privateKey, tlsCA] = await Promise.all(
    [certificateFile, privateKeyFile, peerTLSFile].map(file => readFile(file)),
  );
  const signer = signers.newPrivateKeySigner(createPrivateKey(privateKey));
  const host = "peer0.bank.blockinsure.test";
  const client = new grpc.Client("localhost:31351", grpc.credentials.createSsl(tlsCA), {
    "grpc.ssl_target_name_override": host, "grpc.default_authority": host,
  });
  const gateway = connect({
    client, identity: { mspId: "BankMSP", credentials: certificate }, hash: hash.sha256,
    evaluateOptions: deadline(20), endorseOptions: deadline(45),
    submitOptions: deadline(15), commitStatusOptions: deadline(90),
  });
  try {
    const contract = gateway.getNetwork(channel).getContract("insurance-contract");
    const ready = contract.newProposal("ReadSettlement", {
      arguments: [request.settlementId],
    });
    if (typeof gateway.newSignedProposal !== "function" || typeof gateway.newSignedTransaction !== "function" ||
        typeof gateway.newSignedCommit !== "function" || typeof ready.getDigest !== "function") {
      throw new Error("Installed Fabric Gateway lacks the required external signing interfaces.");
    }
    const signProposal = async proposal => gateway.newSignedProposal(
      proposal.getBytes(), await signer(proposal.getDigest()),
    );
    const result = await confirmWithApproval({
      request,
      evaluate: async (name, ...args) => {
        const proposal = await signProposal(contract.newProposal(name, { arguments: args }));
        return decodeResult(await proposal.evaluate());
      },
      approve: async review => {
        stdout.write(JSON.stringify(review, null, 2) + "\n");
        const terminal = createInterface({ input: stdin, output: stdout });
        try {
          return await terminal.question(`Type APPROVE ${review.settlementId} to confirm this payout: `) ===
            `APPROVE ${review.settlementId}`;
        } finally {
          terminal.close();
        }
      },
      submit: async ({ settlementId, transferId, bankReferenceHash }, review) => {
        const proposal = await signProposal(contract.newProposal("ConfirmSettlement", {
          arguments: [settlementId, transferId, bankReferenceHash],
          endorsingOrganizations: ["BankMSP", "InsurerMSP"],
        }));
        const transaction = await proposal.endorse();
        const outcome = decodeResult(transaction.getResult());
        if (outcome.id !== settlementId || outcome.claimId !== review.claimId ||
            outcome.approvalCertificateHash !== review.certificateHash || outcome.currency !== review.currency ||
            outcome.amountMinor !== review.amountMinor || outcome.transferId !== transferId || outcome.status !== "CONFIRMED") {
          throw new Error("Endorsed confirmation does not match the reviewed payout.");
        }
        const signed = gateway.newSignedTransaction(transaction.getBytes(), await signer(transaction.getDigest()));
        const submitted = await signed.submit();
        const commit = gateway.newSignedCommit(submitted.getBytes(), await signer(submitted.getDigest()));
        const status = await commit.getStatus();
        if (!status.successful) throw new Error(`Confirmation ${status.transactionId} failed validation with code ${status.code}.`);
        return { settlementId, transferId, transactionId: status.transactionId, status: outcome.status };
      },
    });
    stdout.write(JSON.stringify(result) + "\n");
  } finally {
    gateway.close();
    client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
