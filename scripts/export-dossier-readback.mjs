import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { devLiteProfile, withDevLitePeer } from "./dev-lite-gateway.mjs";
import { readDossierLedgerEvidence, readDossierR2Evidence } from "../apps/web/lib/audit/dossier-ledger-evidence.mjs";
import { buildEvidenceMerkleTree, evidenceLeafHash } from "../apps/web/lib/evidence/merkle.ts";
import { redactVoteTallies, visibleDecisions } from "../apps/web/lib/fabric/vote-visibility.ts";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { common } = requireFromWeb("@hyperledger/fabric-protos");
const { channel, chaincodeName: chaincode } = devLiteProfile;

export async function readClaimDossierAnchor({ network, contract }, claimId) {
  const qscc = network.getContract("qscc");
  const readTip = async () => {
    const info = common.BlockchainInfo.deserializeBinary(await qscc.evaluateTransaction("GetChainInfo", channel));
    const blockHeight = info.getHeight();
    const blockHash = Buffer.from(info.getCurrentblockhash_asU8()).toString("hex");
    if (!Number.isSafeInteger(blockHeight) || blockHeight < 1 || blockHash.length !== 64) {
      throw new Error("Peer chain tip is unavailable");
    }
    return { blockHeight, blockHash };
  };
  const tip = await readTip();
  const evaluate = async (name, ...args) =>
    JSON.parse(Buffer.from(await contract.evaluateTransaction(name, ...args)).toString("utf8"));
  const claim = await evaluate("ReadClaim", claimId);
  if (claim.id !== claimId || !claim.episodeId) throw new Error("Expected a medical claim on the selected dev-lite channel");
  const [
    history, allEvidence, allBatches, allAccess, allGrants, allVerifications, allDecisions, allReviews,
    allAppeals, allFraud, allRequests, allCommitments, allResults, allSnapshots, approvalCertificate, settlement,
  ] = await Promise.all([
    evaluate("GetClaimHistory", claimId),
    evaluate("ListEvidenceReferences"),
    evaluate("ListEvidenceMerkleBatches"),
    evaluate("ListEvidenceAccessRecords"),
    evaluate("ListEvidenceAccessGrants"),
    evaluate("ListHospitalVerifications"),
    evaluate("ListAuditorDecisions"),
    evaluate("ListClaimReviews"),
    evaluate("ListClaimAppeals"),
    evaluate("ListFraudAssessments"),
    evaluate("ListOracleRequests"),
    evaluate("ListOracleCommitments"),
    evaluate("ListOracleResults"),
    evaluate("ListOracleRegistrySnapshots"),
    ["APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"].includes(claim.status)
      ? evaluate("ReadMedicalApprovalCertificate", claimId, String(claim.version)) : null,
    claim.medicalSettlementId ? evaluate("ReadSettlement", claim.medicalSettlementId) : null,
  ]);
  const inClaim = (row) => row.claimId === claimId;
  const evidence = allEvidence.filter(inClaim);
  const evidenceById = new Map(allEvidence.map((item) => [item.id, item]));
  const claimEvidenceIds = new Set(evidence.map((item) => item.id));
  const evidenceMerkle = allBatches.filter((batch) => batch.evidenceIds.some((id) => claimEvidenceIds.has(id)))
    .map((batch) => {
      const tree = buildEvidenceMerkleTree(batch.evidenceIds.map((id) => {
        const leaf = evidenceById.get(id);
        if (!leaf) throw new Error("Peer readback is missing one or more batch leaves");
        return leaf;
      }));
      if (tree.rootHash !== batch.rootHash) throw new Error("One or more peer batch roots differ");
      const proofs = evidence.filter((leaf) => batch.evidenceIds.includes(leaf.id)).map((leaf) => ({
        evidenceId: leaf.id, leafHash: evidenceLeafHash(leaf), proof: tree.proofFor(leaf.id),
      }));
      return { batch, proofs };
    });
  const oracleRequests = allRequests.filter(inClaim);
  const oracleResults = allResults.filter(inClaim);
  const proof = await readDossierLedgerEvidence({ contract, qscc, channel, chaincode },
    { claim, history, oracleRequests, oracleResults, approvalCertificate });
  const reviewRounds = allReviews.filter(inClaim);
  const r2 = await readDossierR2Evidence(evaluate, claim, reviewRounds, oracleRequests, approvalCertificate);
  const viewer = { role: "insurerAdmin" };
  const end = await readTip();
  if (end.blockHeight !== tip.blockHeight || end.blockHash !== tip.blockHash) {
    throw new Error("Peer advanced during readback. Repeat the export at a quiescent ledger.");
  }
  return {
    schema: "dossier-peer-readback-v1", readAt: new Date().toISOString(), channel, chaincode, ...tip,
    sections: {
      claim, history, evidence, evidenceMerkle, oracleRequests, oracleResults, approvalCertificate, settlement,
      evidenceAccess: allAccess.filter(inClaim),
      evidenceGrants: allGrants.filter(inClaim),
      hospitalVerification: allVerifications.find((item) => item.id === claim.hospitalVerificationId) ?? null,
      hospitalVerifications: allVerifications.filter(inClaim),
      oracleCommitments: allCommitments.filter(inClaim),
      oracleRegistrySnapshots: allSnapshots.filter((row) => oracleRequests.some((request) => request.registrySnapshotId === row.id)),
      auditorDecisions: visibleDecisions(allDecisions.filter(inClaim), allReviews, viewer),
      reviewRounds: reviewRounds.map((row) => redactVoteTallies(row, viewer)),
      appeals: allAppeals.filter(inClaim),
      fraudAssessments: allFraud.filter(inClaim),
      ...proof,
      ...r2,
    },
  };
}

async function main(args) {
  const [claimId, option, output] = args;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(claimId ?? "") ||
      (args.length !== 1 && (args.length !== 3 || option !== "--output" || !output))) {
    throw new Error("Usage: node scripts/export-dossier-readback.mjs <claim-id> [--output <file>]");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = output ?? fileURLToPath(new URL(`../data/dev-lite/dossier-readback/${claimId}-${stamp}.json`, import.meta.url));
  const report = await withDevLitePeer("insurer", (connection) => readClaimDossierAnchor(connection, claimId))
    .catch((error) => {
      const summary = "Peer advanced during readback. Repeat the export at a quiescent ledger.";
      throw new Error(error instanceof Error && error.message === summary ? summary :
        "Insurer peer dossier readback was incomplete. Check the selected dev-lite channel, claim and ledger availability.");
    });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Read back claim ${claimId} from the Insurer peer at height ${report.blockHeight}. Wrote ${file}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
