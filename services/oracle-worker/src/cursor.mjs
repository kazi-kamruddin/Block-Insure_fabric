import { promises as fs } from "node:fs";
import path from "node:path";

export function emptyCursor(startBlock = 0) {
  return { nextBlock: Number(startBlock), transactionId: "" };
}

export async function loadCursor(filePath, identity, startBlock = 0) {
  try {
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (stored.identity !== identity || !Number.isInteger(stored.nextBlock)) return emptyCursor(startBlock);
    return {
      nextBlock: Math.max(Number(startBlock), stored.nextBlock),
      transactionId: String(stored.transactionId ?? ""),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyCursor(startBlock);
    throw error;
  }
}

export async function persistCursor(filePath, identity, cursor) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const payload = { schemaVersion: 1, identity, ...cursor, updatedAt: new Date().toISOString() };
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, filePath);
}
