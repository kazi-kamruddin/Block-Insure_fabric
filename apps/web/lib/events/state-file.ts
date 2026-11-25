import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const transientReplaceErrors = new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]);

export async function persistJsonFile(filePath: string, value: unknown) {
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
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(temporary, filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt === 5 || !transientReplaceErrors.has(code)) throw error;
        await delay(25 * (attempt + 1));
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
