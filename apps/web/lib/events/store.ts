import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { eventProjectionRoot } from "./location";
import { applyFabricEvent, emptyEventProjection, type EventProjection, type IndexedFabricEvent } from "./projection";

let writeQueue = Promise.resolve();

function projectionPath() {
  return path.join(eventProjectionRoot(/* turbopackIgnore: true */), "projection.json");
}

export async function readEventProjection(): Promise<EventProjection> {
  try {
    return JSON.parse(await fs.readFile(projectionPath(), "utf8")) as EventProjection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyEventProjection();
    throw error;
  }
}

export function appendProjectedEvent(event: IndexedFabricEvent) {
  const operation = writeQueue.then(async () => {
    const current = await readEventProjection();
    const next = applyFabricEvent(current, event, new Date().toISOString());
    if (next === current) return current;
    await fs.mkdir(eventProjectionRoot(/* turbopackIgnore: true */), { recursive: true });
    const temporary = `${projectionPath()}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, projectionPath());
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
