import { existsSync } from "node:fs";
import path from "node:path";

export function eventProjectionRoot(
  environment: NodeJS.ProcessEnv = process.env,
  startDirectory = process.cwd(),
) {
  if (environment.EVENT_PROJECTION_ROOT?.trim()) {
    return path.resolve(startDirectory, environment.EVENT_PROJECTION_ROOT);
  }

  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "network", "config", "configtx.yaml"))) {
      return path.join(current, "data", "events");
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(startDirectory, "data", "events");
}
