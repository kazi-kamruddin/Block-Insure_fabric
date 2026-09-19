import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { eventProjectionRoot } from "./location";
import { applyFabricEvent, emptyEventProjection, type BankCommunication, type EventProjection, type IndexedFabricEvent } from "./projection";
import { persistJsonFile } from "./state-file";

let writeQueue = Promise.resolve();

function projectionPath() {
  return path.join(eventProjectionRoot(/* turbopackIgnore: true */), "projection.json");
}

export async function readEventProjection(): Promise<EventProjection> {
  try {
    const stored = JSON.parse(await fs.readFile(projectionPath(), "utf8")) as EventProjection & { communications?: BankCommunication[] };
    return { ...stored, schemaVersion: 2, communications: stored.communications ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyEventProjection();
    throw error;
  }
}

export function updateProjectedCommunication(id: string, patch: Partial<Pick<BankCommunication, "status" | "adapter" | "recipient" | "messageId" | "error" | "deliveredAt">>) {
  const operation = writeQueue.then(async () => {
    const current = await readEventProjection();
    const communications = current.communications.map((item) => item.id === id ? { ...item, ...patch } : item);
    const next = { ...current, updatedAt: new Date().toISOString(), communications };
    await persistJsonFile(projectionPath(), next);
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function appendProjectedEvent(event: IndexedFabricEvent) {
  const operation = writeQueue.then(async () => {
    const current = await readEventProjection();
    const next = applyFabricEvent(current, event, new Date().toISOString());
    if (next === current) return current;
    await persistJsonFile(projectionPath(), next);
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
