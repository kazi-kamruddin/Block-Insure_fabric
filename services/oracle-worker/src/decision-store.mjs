import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const authenticate = (body, key) => createHmac("sha256", key).update(JSON.stringify(body)).digest();

// Immutable, deployment-qualified decisions: commit/reveal must never recompute
// from changed live inputs after a restart. Corruption fails closed, not reset.
export async function pinnedDecision({ directory, identity, key, existingCommitment, allowLegacyAdoption = false, create }) {
  const identityHash = digest(identity);
  const filename = path.join(directory, `${identityHash}.json`);
  async function read() {
    const stored = JSON.parse(await fs.readFile(filename, "utf8"));
    const expected = authenticate(stored.body, key);
    const supplied = Buffer.from(String(stored.mac), "hex");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied) ||
        stored.body.version !== 1 || stored.body.identityHash !== identityHash) {
      throw new Error("Pinned Oracle decision authentication failed");
    }
    if (existingCommitment && stored.body.decision.commitmentHash !== existingCommitment.commitmentHash) {
      throw new Error("Pinned Oracle decision differs from ledger commitment");
    }
    return stored.body.decision;
  }
  try { return await read(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existingCommitment && !allowLegacyAdoption) throw new Error("Pinned Oracle decision missing for existing commitment; restore task state");
  const decision = await create();
  if (!decision || typeof decision.commitmentHash !== "string") throw new Error("Cannot persist an incomplete Oracle decision");
  if (existingCommitment && decision.commitmentHash !== existingCommitment.commitmentHash) throw new Error("Legacy decision cannot reproduce ledger commitment");
  const body = { version: 1, identityHash, decision };
  await fs.mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await fs.open(filename, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") return read();
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ body, mac: authenticate(body, key).toString("hex") })}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  return read();
}

export function decisionIdentity(config, identityFingerprint, request) {
  return {
    channel: config.fabric.channelName, chaincode: config.fabric.chaincodeName,
    oracle: config.oracleId, certificate: identityFingerprint,
    request: Object.fromEntries(["id", "claimId", "queryHash", "claimVersion", "hospitalVerificationId",
      "appealId", "appealCommitmentHash", "registrySnapshotId", "registryVersion", "registryRootHash",
      "rulesVersion", "rulesHash", "modelVersion", "modelHash", "privacyPresentationId",
      "privacyPresentationHash", "privacyProtocolVersion"].map((name) => [name, request[name] ?? ""])),
  };
}
