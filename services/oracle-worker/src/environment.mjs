import { readFileSync } from "node:fs";
import path from "node:path";

export function loadEnvironmentFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  let contents;
  try {
    contents = readFileSync(resolved, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Oracle environment file does not exist: ${resolved}`);
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`Invalid Oracle environment entry in ${resolved}`);
    if (process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

export function environmentFileArgument(arguments_ = process.argv.slice(2)) {
  const entry = arguments_.find((value) => value.startsWith("--env="));
  return entry ? entry.slice("--env=".length) : process.env.ORACLE_ENV_FILE;
}
