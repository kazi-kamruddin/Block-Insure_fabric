import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../../../oracle-worker/src/v2/canonical.mjs";
import { factsFromSources } from "../../../oracle-worker/src/v2/evidence-policy.mjs";
import { diagnosticPolicy } from "../../../oracle-worker/src/v2/decision.mjs";
import { pinManifest, verifyFeed } from "../../../oracle-worker/src/v2/sources.mjs";
import { createFeed, signRecord } from "../feed.mjs";
import { createMedicalPublisher, hospitalInvoiceRecordId } from "../medical-publisher.mjs";
import { issuers } from "../server.mjs";
import { createFeedStore } from "../store.mjs";

const now = "2026-11-25T09:00:00.000Z";
const firstIssue = "2026-11-24T09:00:00.000Z";
const from = "2026-11-01T00:00:00.000Z";
const claim = { id: "medical-ui-claim", version: 1, hospitalId: "hospital-2", service: "DIAGNOSTIC",
  serviceDate: "2026-11-25", invoiceDate: "2026-11-25", admissionDate: "2026-11-25", dischargeDate: "2026-11-25",
  invoiceHash: "a".repeat(64), diagnosisCode: "", billMinor: 480000 };

async function example(t, receiptAmount, beforeAnchor = () => {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fabric-publisher-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const issuerIds = ["S-A", "S-B", "S-C"];
  const keys = Object.fromEntries(issuerIds.map(id => [id, generateKeyPairSync("ed25519")]));
  const store = createFeedStore(directory, Object.fromEntries(issuerIds.map(id => [id, keys[id].publicKey])));
  const registry = Object.fromEntries(issuerIds.map(id => [id, { ...issuers[id], issuerId: id, keyVersion: 1, status: "ACTIVE", validFrom: from,
    validUntil: "2027-12-31T00:00:00.000Z", ed25519PublicKey: keys[id].publicKey.export({ type: "spki", format: "der" }).toString("base64url") }]));
  const checkpoints = [];
  const writes = [];
  const anchor = actor => async feed => {
    await beforeAnchor(actor, feed);
    writes.push([actor, feed.issuerId, feed.feedVersion]);
    const pin = { issuerId: feed.issuerId, keyVersion: feed.keyVersion, feedVersion: feed.feedVersion,
      root: feed.merkleRoot, effectiveAt: feed.issuedAt, anchoredAt: now };
    const confirmed = { ...pin, signature: feed.anchorSignature };
    checkpoints.push(confirmed);
    return confirmed;
  };
  const regulatorFacts = [
    { kind: "LICENCE", status: "ACTIVE" },
    { kind: "ACCREDITATION", status: "ACCREDITED" },
    { kind: "TARIFF", bandMinMinor: 400000, bandMaxMinor: 500000 },
  ].map((fact, index) => signRecord({ issuerId: "S-B", keyVersion: 1, recordId: "sb-" + index, originId: "sb-origin-" + index,
    derivedFrom: [], effectiveAt: from, payload: { ...fact, hospitalId: claim.hospitalId, service: claim.service, validFrom: "2026-11-01", validUntil: "2027-01-01" } },
  keys["S-B"].privateKey));
  for (const id of issuerIds) {
    const feed = createFeed({ issuerId: id, keyVersion: 1, feedVersion: 1, issuedAt: firstIssue, from, through: firstIssue,
      records: id === "S-B" ? regulatorFacts : [] }, keys[id].privateKey);
    await store.append(feed);
    await anchor("setup")(feed);
  }
  await store.append(createFeed({ issuerId: "S-B", keyVersion: 1, feedVersion: 2, issuedAt: "2026-11-24T09:00:01.000Z",
    from, through: firstIssue, records: regulatorFacts }, keys["S-B"].privateKey));
  writes.length = 0;
  const privateReceipt = { evidenceId: "evidence-one", invoiceNumber: "HIS-4581", amountMinor: receiptAmount,
    serviceDate: claim.serviceDate, hospitalId: claim.hospitalId, derivedFrom: hospitalInvoiceRecordId(claim.id, claim.version) };
  const sourceQueries = [];
  const publish = createMedicalPublisher({ store, keys, now: () => new Date(now), hospital: {
    readInvoice: async (id, version) => {
      sourceQueries.push(["HospitalMSP", id, version]);
      return { ...claim, claimId: id, claimVersion: version, invoiceNumber: "HIS-4581" };
    },
    listAnchors: async () => checkpoints,
    anchor: anchor("HospitalMSP"),
  }, insurer: {
    readReceipt: async (id, version) => {
      sourceQueries.push(["InsurerMSP", id, version]);
      return { claimId: id, claimVersion: version, receipt: privateReceipt };
    },
    listAnchors: async () => checkpoints,
    anchor: anchor("InsurerMSP"),
  } });
  return { keys, registry, store, checkpoints, writes, publish, privateReceipt, sourceQueries };
}

test("a UI-shaped medical claim publishes a complete source manifest and preserves the S-B anchor", async t => {
  const { registry, store, checkpoints, writes, publish, privateReceipt, sourceQueries } = await example(t, claim.billMinor);
  const publication = await publish({ claimId: claim.id, claimVersion: claim.version });
  assert.equal(publication.claimVersion, 1);
  assert.deepEqual(sourceQueries, [["HospitalMSP", claim.id, 1], ["InsurerMSP", claim.id, 1]]);
  assert.deepEqual(writes, [["HospitalMSP", "S-A", 2], ["InsurerMSP", "S-C", 2]]);

  const { manifest, manifestHash } = pinManifest({ requestedAt: now, checkpoints, requiredIssuers: Object.values(registry),
    issuerKeys: new Map(Object.values(registry).map(issuer => [`${issuer.issuerId}:1`, issuer])) });
  assert.deepEqual(manifest.pins.map(pin => [pin.issuerId, pin.feedVersion]), [["S-A", 2], ["S-B", 1], ["S-C", 2]]);
  assert.equal(manifestHash, digest("oracle-v2:manifest", manifest));
  const rows = [];
  for (const pin of manifest.pins) {
    const feed = await store.read(pin.issuerId, pin.feedVersion);
    assert.ok(feed.coverage.through <= feed.issuedAt);
    assert.ok(verifyFeed(feed, pin, registry[pin.issuerId], now));
    rows.push(...feed.records);
  }
  const vector = factsFromSources({ claim, manifestHash, modelAdvice: "AUTO", records: new Map(rows.map(row => [row.recordId, row])),
    issuers: new Map(Object.entries(registry)), policy: { ...diagnosticPolicy, requireReceiptNumber: true }, privateReceipt });
  assert.equal(vector.facts.invoiceIssued.status, "PASS");
  assert.equal(vector.facts.receiptConsistent.status, "PASS");
  await publish({ claimId: claim.id, claimVersion: claim.version });
  assert.equal(writes.length, 2, "repeat clicks reuse the committed feeds");
});

test("publisher keeps a mismatching receipt independent of the hospital invoice", async t => {
  const { store, publish } = await example(t, 530000);
  await publish({ claimId: claim.id, claimVersion: claim.version });
  assert.equal((await store.latest("S-A")).records[0].payload.billMinor, claim.billMinor);
  assert.equal((await store.latest("S-C")).records[0].payload.billMinor, 530000);
});

test("a retry anchors a retained signed receipt version after a pre-submit failure", async t => {
  let refused = false;
  const { store, writes, publish } = await example(t, claim.billMinor, (actor, feed) => {
    if (!refused && actor === "InsurerMSP" && feed.issuerId === "S-C" && feed.feedVersion === 2) {
      refused = true;
      throw new Error("submission refused");
    }
  });
  await assert.rejects(publish({ claimId: claim.id, claimVersion: claim.version }), /submission refused/);
  const pending = await store.latest("S-C");
  assert.equal(pending.feedVersion, 2);
  assert.deepEqual(writes, [["HospitalMSP", "S-A", 2]]);
  await publish({ claimId: claim.id, claimVersion: claim.version });
  assert.deepEqual(await store.latest("S-C"), pending);
  assert.deepEqual(writes, [["HospitalMSP", "S-A", 2], ["InsurerMSP", "S-C", 2]]);
});
