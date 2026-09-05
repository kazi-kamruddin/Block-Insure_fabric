import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const standaloneRoot = resolve(root, ".next", "standalone");

if (!existsSync(resolve(standaloneRoot, "server.js"))) {
  throw new Error("Next.js standalone output is missing. Run this script after next build.");
}

function replaceDirectory(source, destination) {
  if (!existsSync(source)) return;
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

replaceDirectory(resolve(root, ".next", "static"), resolve(standaloneRoot, ".next", "static"));
replaceDirectory(resolve(root, "public"), resolve(standaloneRoot, "public"));

console.log("Prepared standalone Next.js runtime assets.");
