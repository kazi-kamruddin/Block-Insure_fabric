import { promises as fs } from "node:fs";
import { persistJsonFile } from "./state-file.mjs";

export function emptyCursor(startBlock = 0) {
  return { nextBlock: Number(startBlock), transactionId: "" };
}

export async function loadCursor(filePath, identity, startBlock = 0) {
  try {
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (stored.identity !== identity || !Number.isSafeInteger(stored.nextBlock) || stored.nextBlock < 0) return emptyCursor(startBlock);
    if (stored.nextBlock < Number(startBlock)) return emptyCursor(startBlock);
    return {
      nextBlock: stored.nextBlock,
      transactionId: String(stored.transactionId ?? ""),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyCursor(startBlock);
    throw error;
  }
}

export async function persistCursor(filePath, identity, cursor) {
  const payload = { schemaVersion: 1, identity, ...cursor, updatedAt: new Date().toISOString() };
  await persistJsonFile(filePath, payload);
}
