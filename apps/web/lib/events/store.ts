import "server-only";

import { createHash } from "node:crypto";
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

type DeliveryPatch = Partial<Pick<BankCommunication,
  "status" | "adapter" | "recipient" | "messageId" | "error" | "deliveredAt" | "deliveryAttempts" | "nextAttemptAt">>;

export function updateProjectedCommunication(id: string, patch: DeliveryPatch) {
  const operation = writeQueue.then(async () => {
    const current = await readEventProjection();
    const communications = current.communications.map((item) => item.id === id ? { ...item, ...patch } : item);
    const failed = communications.find((item) => item.id === id && item.status === "FAILED" && patch.status === "FAILED");
    if (failed) {
      const key = createHash("sha256").update(JSON.stringify([failed.eventId, failed.recipientSubject, failed.policyId])).digest("hex");
      await persistJsonFile(path.join(path.dirname(projectionPath()), "dead-letter", `${key}.json`), {
        id: failed.id, eventId: failed.eventId, assetId: failed.assetId, status: failed.status,
        deliveryAttempts: failed.deliveryAttempts, error: failed.error, failedAt: new Date().toISOString(),
      });
    }
    const next = { ...current, updatedAt: new Date().toISOString(), communications };
    await persistJsonFile(projectionPath(), next);
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function appendProjectedEvents(events: IndexedFabricEvent[]) {
  const operation = writeQueue.then(async () => {
    const current = await readEventProjection();
    const updatedAt = new Date().toISOString();
    const next = events.reduce((projection, event) => applyFabricEvent(projection, event, updatedAt), current);
    if (next === current) return current;
    await persistJsonFile(projectionPath(), next);
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function appendProjectedEvent(event: IndexedFabricEvent) {
  return appendProjectedEvents([event]);
}
