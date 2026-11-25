import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { createFeed, recordProof, signRecord, verifyAbsentRecord, verifyFeed, verifyRecord, verifyRecordProof, verifySigned } from "../feed.mjs";
import { fixture } from "../fixtures/generate.mjs";
import { createFeedStore, mirrorFeeds } from "../store.mjs";
import { issuers, listenAdapters } from "../server.mjs";
import { fetchPinnedFeed, proveAbsence } from "../../../oracle-worker/src/v2/sources.mjs";

async function removeTestDirectory(root) {
  const resolved = await realpath(root);
  if (dirname(resolved) !== await realpath(tmpdir()) || !basename(resolved).startsWith("oracle-v2-")) {
    throw new Error("Unexpected adapter test output directory");
  }
  await rm(resolved, { recursive: true, force: true });
}

function makeFeed(version, privateKey, issuerId = "S-A") {
  const input = fixture(42).versions[version - 1];
  const records = input.records[issuerId].map(record => signRecord({ issuerId, keyVersion: 1, ...record }, privateKey));
  return createFeed({ issuerId, keyVersion: 1, feedVersion: version, records, ...input.coverage }, privateKey);
}

test("record signatures and inclusion proofs fail closed on tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const feed = makeFeed(2, privateKey);
  assert.ok(verifyFeed(feed, publicKey));
  for (const [index, record] of feed.records.entries()) {
    const proof = recordProof(feed.records, index);
    assert.ok(verifyRecord(record, publicKey));
    assert.ok(verifyRecordProof(record, proof, feed.merkleRoot));
    const altered = { ...record, payload: { ...record.payload, billMinor: 0 } };
    assert.equal(verifyRecord(altered, publicKey), false);
    assert.equal(verifyRecordProof(altered, proof, feed.merkleRoot), false);
    assert.equal(verifyRecordProof(record, { ...proof, siblings: [...proof.siblings, feed.merkleRoot] }, feed.merkleRoot), false);
  }
});

test("coverage proves absence only for signed, pinned, complete intervals", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const feed = makeFeed(1, privateKey);
  const pin = { issuerId: feed.issuerId, keyVersion: feed.keyVersion, feedVersion: feed.feedVersion, root: feed.merkleRoot };
  const date = "2026-11-12T00:00:00.000Z";
  assert.ok(verifyAbsentRecord(feed.coverage, publicKey, pin, "absent-42", date));
  assert.equal(verifyAbsentRecord(feed.coverage, publicKey, pin, feed.records[0].recordId, date), false);
  assert.equal(verifyAbsentRecord(feed.coverage, publicKey, pin, "absent-42", "2026-11-26T00:00:00.000Z"), false);
  assert.equal(verifyAbsentRecord({ ...feed.coverage, recordIds: [] }, publicKey, pin, "absent-42", date), false);
  assert.equal(verifyAbsentRecord(feed.coverage, publicKey, { ...pin, root: "0".repeat(64) }, "absent-42", date), false);
});

test("immutable chronological feed publication and stale mirror", async () => {
  const root = await mkdtemp(join(tmpdir(), "oracle-v2-adapters-"));
  try {
    const keys = generateKeyPairSync("ed25519");
    const issuerKeys = { "S-A": keys.publicKey };
    const direct = createFeedStore(join(root, "source"), issuerKeys);
    const mirror = createFeedStore(join(root, "mirror"), issuerKeys);
    const first = makeFeed(1, keys.privateKey);
    const second = makeFeed(2, keys.privateKey);
    await assert.rejects(direct.append(second), /next feed version/);
    await direct.append(first);
    await assert.rejects(direct.append(first), /next feed version|already stored/);
    await direct.append(second);
    assert.equal(await mirrorFeeds(direct, mirror, ["S-A"], 1), 1);
    assert.equal((await mirror.latest("S-A")).merkleRoot, first.merkleRoot);
    assert.equal(await mirror.read("S-A", 2), null);
    assert.equal(await mirrorFeeds(direct, mirror, ["S-A"], 2), 1);
    assert.equal((await mirror.latest("S-A")).merkleRoot, second.merkleRoot);
  } finally {
    await removeTestDirectory(root);
  }
});

test("four listeners bind retrieval receipts to the authenticated Oracle and detect stale versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "oracle-v2-ports-"));
  const keys = Object.fromEntries(Object.keys(issuers).map(issuerId => [issuerId, generateKeyPairSync("ed25519")]));
  const issuerKeys = Object.fromEntries(Object.entries(keys).map(([issuerId, key]) => [issuerId, key.publicKey]));
  const store = createFeedStore(root, issuerKeys);
  const listener = await listenAdapters({ store, receiptKeys: keys, ports: Object.fromEntries(Object.keys(issuers).map(id => [id, 0])),
    tokens: { oracle1: "test-token-1".repeat(3), oracle2: "test-token-2".repeat(3), oracle3: "test-token-3".repeat(3) } });
  try {
    assert.equal(new Set(Object.values(listener.urls)).size, 4);
    const headers = { authorization: "Bearer " + "test-token-2".repeat(3) };
    for (const [issuerId, url] of Object.entries(listener.urls)) {
      await store.append(makeFeed(1, keys[issuerId].privateKey, issuerId));
      assert.equal((await fetch(url + "/feed/latest")).status, 401);
      const feed = await (await fetch(url + "/feed/latest", { headers })).json();
      assert.equal(feed.issuerId, issuerId);
      assert.ok(verifyFeed(feed, keys[issuerId].publicKey));
      const stale = await fetch(url + "/feed/2", { headers });
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).code, "FEED_NOT_AVAILABLE");
      const issuer = { issuerId, ...issuers[issuerId], keyVersion: 1, status: "ACTIVE", validFrom: "2026-11-01T00:00:00.000Z",
        validUntil: "2030-01-01T00:00:00.000Z", ed25519PublicKey: keys[issuerId].publicKey.export({ type: "spki", format: "der" }).toString("base64url") };
      const checkpoint = { issuerId, keyVersion: 1, feedVersion: 1, root: feed.merkleRoot, effectiveAt: feed.issuedAt,
        anchoredAt: "2026-11-19T00:01:00.000Z" };
      const clientOptions = { baseUrl: url, token: "test-token-2".repeat(3), checkpoint, issuer, requestedAt: "2026-11-20T00:00:00.000Z" };
      const pinned = await fetchPinnedFeed(clientOptions);
      assert.equal(pinned.status, "VERIFIED");
      assert.ok(proveAbsence(pinned.feed, checkpoint, issuer, clientOptions.requestedAt, "missing", "SYNTHETIC_CLAIMS", "2026-11-17T00:00:00.000Z"));
      assert.equal((await fetchPinnedFeed({ ...clientOptions, checkpoint: { ...checkpoint, feedVersion: 2 } })).status, "STALE_MIRROR");
      const recordId = feed.records[0].recordId;
      const result = await (await fetch(url + "/record/" + recordId + "?version=1", { headers })).json();
      assert.ok(verifyRecordProof(result.record, result.proof, feed.merkleRoot));
      assert.equal((await (await fetch(url + "/coverage/1", { headers })).json()).root, feed.merkleRoot);
      const requestId = "test-request-42";
      const send = oracleId => fetch(url + "/retrieval-receipt", { method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ requestId, oracleId, feedVersion: 1, root: feed.merkleRoot }) });
      assert.equal((await send("oracle1")).status, 403);
      const signed = await (await send("oracle2")).json();
      const { signature, ...body } = signed.receipt;
      assert.equal(body.oracleId, "oracle2");
      assert.ok(verifySigned("oracle-v2:retrieval", body, signature, keys[issuerId].publicKey));
    }
    const memory = process.memoryUsage();
    console.info(JSON.stringify({ adapterRssBytes: memory.rss, adapterHeapUsedBytes: memory.heapUsed }));
  } finally {
    await listener.close();
    await removeTestDirectory(root);
  }
});

test("seeded fixture includes effective-dated licence and tariff changes with receipt lineage", () => {
  const generated = fixture(42);
  assert.deepEqual(generated, fixture(42));
  assert.notDeepEqual(generated, fixture(43));
  const [first, second] = generated.versions;
  assert.ok(first.records["S-B"].some(record => record.payload.kind === "LICENCE" && record.payload.status === "SUSPENDED"));
  assert.ok(second.records["S-B"].some(record => record.payload.supersedes));
  assert.ok(second.records["S-C"].every(record => record.derivedFrom.length === 1));
});
