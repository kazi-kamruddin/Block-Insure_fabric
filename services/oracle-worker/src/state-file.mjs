import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const transientReplaceErrors = new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]);

export async function persistJsonFile(filePath, value, {
  replace = fs.rename, pause = delay, exclusive = false,
} = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Immutable files use a hard-link publication so concurrent writers
    // cannot replace a decision that has already been used to commit.
    const publish = exclusive ? fs.link : replace;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await publish(temporary, filePath);
        return;
      } catch (error) {
        if (attempt === 5 || (exclusive && error.code === "EEXIST") ||
            !transientReplaceErrors.has(error?.code)) throw error;
        await pause(25 * 2 ** attempt);
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
