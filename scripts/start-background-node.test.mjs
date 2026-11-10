import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

test("background launcher returns while owned child lives, routes logs to files and releases it through its unique fixture", async () => {
  const root = path.resolve(".local-reference/background-launch-tests", randomUUID()); mkdirSync(root, { recursive: true });
  const output = path.join(root, "child.out.log"), errors = path.join(root, "child.err.log"), stop = path.join(root, "stop");
  const fixture = path.join(root, "fixture.mjs");
  writeFileSync(fixture, `import {existsSync} from 'node:fs'; console.log('running'); setInterval(()=>{if(existsSync(${JSON.stringify(stop)})){console.log('stopped');process.exit(0)}},20);`);
  try {
    const result = JSON.parse(execFileSync(process.execPath, [path.resolve("scripts/start-background-node.mjs"), "--directory", root, "--stdout", output, "--stderr", errors, "--", fixture], { encoding: "utf8", timeout: 10000 }));
    assert.ok(Number.isInteger(result.id));
    for(let n=0;n<100 && !readFileSync(output,"utf8").includes("running");n++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.match(readFileSync(output,"utf8"), /running/);
    assert.doesNotThrow(()=>process.kill(result.id,0));
    assert.equal(readFileSync(errors,"utf8"), "");
  } finally {
    // Never kill a guessed/recycled PID. Only this unique fixture watches this file.
    writeFileSync(stop, "stop");
    for(let n=0;n<100 && (!existsSync(output) || !readFileSync(output,"utf8").includes("stopped"));n++) await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.match(readFileSync(output,"utf8"), /stopped/);
});
