import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { persistJsonFile } from "../src/state-file.mjs";

test("a locked target remains readable while a synced replacement is retried", async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-replace-"));
  context.after(() => fs.rm(root, { force: true, recursive: true }));
  const target = path.join(root, "state.json");
  await fs.writeFile(target, '{"previous":true}');
  let attempts = 0;
  await persistJsonFile(target, { current: true }, { pause: async () => {}, replace: async (from, to) => {
    assert.deepEqual(JSON.parse(await fs.readFile(from, "utf8")), { current: true });
    assert.deepEqual(JSON.parse(await fs.readFile(to, "utf8")), { previous: true });
    if (++attempts <= 4) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
    await fs.rename(from, to);
  } });
  assert.equal(attempts, 5);
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { current: true });
  assert.deepEqual(await fs.readdir(root), ["state.json"]);
});

test("an immutable decision is published once under concurrent writers", async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-publish-"));
  context.after(() => fs.rm(root, { force: true, recursive: true }));
  const target = path.join(root, "decision.json");
  const writes = await Promise.allSettled([1, 2].map(value => persistJsonFile(target, { value }, { exclusive: true })));
  assert.equal(writes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(writes.find(result => result.status === "rejected").reason.code, "EEXIST");
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { value: writes[0].status === "fulfilled" ? 1 : 2 });
  assert.deepEqual(await fs.readdir(root), ["decision.json"]);
});
