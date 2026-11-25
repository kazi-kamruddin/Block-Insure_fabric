import assert from "node:assert/strict";
import test from "node:test";
import { OrderedEvents } from "../src/ordered-events.mjs";

test("three jobs run concurrently and the cursor stops at the first unfinished event", async () => {
  const checkpointed = [];
  const controls = Array.from({ length: 3 }, () => Promise.withResolvers());
  const started = [];
  const queue = new OrderedEvents(3, async event => {
    started.push(event);
    await controls[event - 1].promise;
  }, async event => { checkpointed.push(event); });
  await queue.offer(1);
  await queue.offer(2);
  await queue.offer(3);
  assert.deepEqual(started, [1, 2, 3]);
  controls[2].resolve();
  controls[1].resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(checkpointed, []);
  controls[0].resolve();
  await queue.finish();
  assert.deepEqual(checkpointed, [1, 2, 3]);
});

test("a failed job remains replayable while earlier completed events are checkpointed", async () => {
  const checkpointed = [];
  const first = Promise.withResolvers();
  const failure = new Error("retry this event");
  let signaled = false;
  const queue = new OrderedEvents(3, async event => {
    if (event === 1) await first.promise;
    else if (event === 2) throw failure;
  }, async event => { checkpointed.push(event); }, () => { signaled = true; });
  await queue.offer(1);
  await queue.offer(2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signaled, true);
  first.resolve();
  await assert.rejects(queue.finish(), failure);
  assert.deepEqual(checkpointed, [1]);
});
