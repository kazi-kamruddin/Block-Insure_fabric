import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function unpack(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const files = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const text = (a, b) => header.subarray(a, b).toString().split("\0")[0];
    const size = parseInt(text(124, 136).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error("Invalid tar size");
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join("/").replace(/^\.\//, "");
    if (header[156] === 0 || header[156] === 48) files.set(name, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
const filename = process.argv[2];
if (!filename) throw new Error("Usage: node scripts/audit-source-package.mjs <package.tar.gz>");
const bytes = readFileSync(filename);
const outer = unpack(bytes);
const metadata = JSON.parse(outer.get("metadata.json").toString());
const files = unpack(outer.get("code.tar.gz"));
const contractRoot = path.resolve("chaincode/insurance-contract");
const sourceFiles = ["go.mod", "go.sum", ...readdirSync(contractRoot).filter((name) => name.endsWith(".go") && !name.endsWith("_test.go")),
  ...readdirSync(path.join(contractRoot, "src")).filter((name) => name.endsWith(".go") && !name.endsWith("_test.go")).map((name) => `src/${name}`)];
const matches = [], differences = [];
for (const relative of sourceFiles) {
  const packaged = files.get(relative) ?? files.get(`src/${relative}`);
  const current = readFileSync(path.join(contractRoot, relative));
  (packaged && sha(packaged) === sha(current) ? matches : differences).push(relative);
}
console.log(JSON.stringify({ status: differences.length ? "DIFFERENT" : "MATCHED", package: path.basename(filename),
  packageId: `${metadata.label}:${sha(bytes)}`, metadata, matches, differences,
  interpretation: "Offline archive comparison only; not installed/committed peer identity evidence" }, null, 2));
