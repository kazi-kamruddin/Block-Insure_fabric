import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const digestPattern = /^[a-f0-9]{64}$/;

async function readRecord(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function persistRecord(file, value, keepExisting) {
  const temporary = path.join(path.dirname(file), `.ledger-instance-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value) + "\n");
      await handle.sync();
    } finally { await handle.close(); }
    if (keepExisting) {
      try { await fs.link(temporary, file); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    } else {
      await fs.rename(temporary, file);
    }
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}

export async function selectLedgerInstance(profileRoot, channel, blockOne, ledgerMarker = "") {
  if (!/^[a-z][a-z0-9.-]{0,248}$/.test(channel)) throw new Error("Invalid Fabric channel name");
  if (!(blockOne instanceof Uint8Array) || blockOne.length === 0) throw new Error("Block 1 is required to select an application-state directory");
  if (ledgerMarker && !digestPattern.test(ledgerMarker)) throw new Error("Invalid on-ledger provisioning marker");
  const blockOneId = createHash("sha256").update(blockOne).digest("hex");
  const provisioningId = ledgerMarker || blockOneId;
  // Pin the existing profile layout to the first verified ledger it serves.
  const legacy = path.join(profileRoot, `ledger-${channel}.legacy.json`);
  let anchor = await readRecord(legacy);
  if (!anchor) {
    await persistRecord(legacy, { channel, provisioningId, blockOneId }, true);
    anchor = await readRecord(legacy);
  }
  if (!anchor || anchor.channel !== channel || !digestPattern.test(anchor.provisioningId)) throw new Error("Invalid legacy ledger-instance cache");
  const appStateRoot = blockOneId === (anchor.blockOneId ?? anchor.provisioningId)
    ? profileRoot : path.join(profileRoot, "instances", blockOneId.slice(0, 32));
  if (appStateRoot !== profileRoot) {
    await fs.mkdir(appStateRoot, { recursive: true });
    const identity = path.join(appStateRoot, "ledger-instance.json");
    await persistRecord(identity, { channel, provisioningId: blockOneId }, true);
    const instance = await readRecord(identity);
    if (instance?.channel !== channel || instance?.provisioningId !== blockOneId) {
      throw new Error("Application-state directory is bound to a different ledger");
    }
  }
  const active = path.join(profileRoot, `ledger-${channel}.json`);
  const selection = { channel, provisioningId, appStateRoot };
  const previous = await readRecord(active);
  if (previous?.provisioningId !== provisioningId || previous?.appStateRoot !== appStateRoot || previous?.channel !== channel) {
    await persistRecord(active, selection, false);
  }
  return selection;
}
