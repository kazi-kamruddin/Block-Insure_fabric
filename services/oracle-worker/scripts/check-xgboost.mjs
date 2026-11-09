import { readFile, writeFile } from "node:fs/promises";
import { evaluatorVersion, evaluatorHash, adapterContract } from "../src/xgboost.mjs";
const files = [new URL("../frozen/evaluator.json", import.meta.url), new URL("../../../apps/web/lib/oracle/evaluator.json", import.meta.url)];
const expected = { evaluatorVersion, evaluatorHash, adapterContract };
for (const file of files) {
  if (process.argv.includes("--write")) await writeFile(file, `${JSON.stringify(expected, null, 2)}\n`);
  const actual = JSON.parse(await readFile(file, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Evaluator identity changed; review source then regenerate with --write");
}
console.log(JSON.stringify({ status: "PASSED", evaluatorVersion, evaluatorHash }));
