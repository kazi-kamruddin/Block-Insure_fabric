import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { restoreArchivedRegistrySnapshot } from "../apps/web/lib/oracle/registry-archive.mjs";
import { registryRootHash } from "../services/oracle-worker/src/registry.mjs";

const defaultRoot = fileURLToPath(new URL("../data/dev-lite/", import.meta.url));

export function restoreRegistrySnapshot(options) {
  return restoreArchivedRegistrySnapshot({ ...options, computeRoot: registryRootHash });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({
      options: { archive: { type: "string" }, registry: { type: "string" }, help: { type: "boolean" } }, allowPositionals: true,
    });
    const usage = "Usage: node scripts/restore-registry-snapshot.mjs ROOT_SHA256 [--archive DIR] [--registry DIR]";
    if (values.help) console.log(usage);
    else {
      if (positionals.length !== 1) throw new Error(usage);
      const file = await restoreRegistrySnapshot({
        rootHash: positionals[0],
        archive: values.archive ?? path.join(defaultRoot, "registry-archive"),
        registry: values.registry ?? path.join(defaultRoot, "oracle", "registries"),
      });
      console.log(`Verified root and restored ${file}`);
    }
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Registry archive is not valid JSON" : error.message);
    process.exitCode = 1;
  }
}
