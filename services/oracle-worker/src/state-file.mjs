import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const transientReplaceErrors = new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]);

export async function persistJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  let lastError;
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(temporary, filePath);
        return;
      } catch (error) {
        if (!transientReplaceErrors.has(error?.code)) throw error;
        lastError = error;
        if (attempt >= 2) {
          try { await fs.rm(filePath, { force: true }); }
          catch (removeError) {
            if (!transientReplaceErrors.has(removeError?.code) && removeError?.code !== "ENOENT") throw removeError;
          }
        }
        await delay(25 * (attempt + 1));
      }
    }
    throw lastError;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
