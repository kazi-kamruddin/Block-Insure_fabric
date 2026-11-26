import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const digest = value => createHash("sha256").update(value).digest("hex");
const snapshotSchema = "fabric-registry-archive-v1";

function archivePath(directory, rootHash) {
  if (!/^[a-f0-9]{64}$/.test(rootHash)) throw new Error("Expected a lowercase SHA-256 registry root");
  return path.join(directory, rootHash + ".json");
}

function inputHashes(snapshot) {
  return {
    rulesHash: snapshot.rulesHash,
    recordsSha256: digest(JSON.stringify(snapshot.records)),
    modelContextSha256: snapshot.modelContext ? digest(JSON.stringify(snapshot.modelContext)) : null,
  };
}

async function writeOnce(file, contents, onExisting) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // Create the destination atomically and never replace an existing name.
      await link(temporary, file);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await onExisting(await readFile(file, "utf8"));
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function archiveRegistrySnapshot(directory, snapshot) {
  const file = archivePath(directory, snapshot.rootHash);
  const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
  const archive = {
    schema: snapshotSchema, capturedAt: new Date().toISOString(),
    rootHash: snapshot.rootHash, inputHashes: inputHashes(snapshot),
    snapshotSha256: digest(bytes), snapshotBytes: Buffer.from(bytes, "utf8").toString("base64"),
  };
  await writeOnce(file, `${JSON.stringify(archive, null, 2)}\n`, existing => {
    const previous = JSON.parse(existing);
    if (previous.schema !== archive.schema || previous.rootHash !== archive.rootHash || previous.snapshotBytes !== archive.snapshotBytes ||
      previous.snapshotSha256 !== archive.snapshotSha256 ||
      JSON.stringify(previous.inputHashes) !== JSON.stringify(archive.inputHashes)) {
      throw new Error("Registry archive already contains a different snapshot");
    }
  });
  return bytes;
}

export async function restoreArchivedRegistrySnapshot({ rootHash, archive, registry, computeRoot }) {
  const bundle = JSON.parse(await readFile(archivePath(archive, rootHash), "utf8"));
  if (bundle.schema !== snapshotSchema || bundle.rootHash !== rootHash || typeof bundle.snapshotBytes !== "string") {
    throw new Error("Registry archive metadata does not match the requested root");
  }
  const bytes = Buffer.from(bundle.snapshotBytes, "base64").toString("utf8");
  if (digest(bytes) !== bundle.snapshotSha256) throw new Error("Registry archive snapshot bytes do not match their digest");
  const snapshot = JSON.parse(bytes);
  if (!/^registry-hospital-v[1-9]\d*$/.test(snapshot.snapshotId) || snapshot.snapshotId !== `registry-hospital-v${snapshot.version}` ||
    snapshot.rootHash !== rootHash || await computeRoot(snapshot) !== rootHash ||
    JSON.stringify(inputHashes(snapshot)) !== JSON.stringify(bundle.inputHashes)) {
    throw new Error("Archived registry inputs do not reproduce the requested root");
  }
  const target = path.join(registry, snapshot.snapshotId + ".json");
  await writeOnce(target, bytes, existing => {
    if (existing !== bytes) throw new Error("Working registry already contains a different snapshot");
  });
  return target;
}
