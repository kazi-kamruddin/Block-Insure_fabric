import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createFeed, recordProof, signRecord } from "../../integrations/source-adapters/feed.mjs";
import { fixture } from "../../integrations/source-adapters/fixtures/generate.mjs";
import { decide, diagnosticPolicy } from "../src/v2/decision.mjs";
import { factsFromSources } from "../src/v2/evidence-policy.mjs";
import { fetchPinnedFeed, independentEvidence, pinManifest, proveAbsence, verifyFeed, verifyFeedMembership } from "../src/v2/sources.mjs";

const requestedAt = "2026-11-25T10:00:00.000Z";
const claims = fixture(42);
const second = claims.versions[1];
const kinds = {
  "S-A": ["HOSPITAL_HIS", ["invoiceIssued"]],
  "S-B": ["REGULATOR", ["licenceActiveOnServiceDate", "serviceAccredited", "tariffBand"]],
  "S-C": ["CLAIMANT_RECEIPT", ["receiptConsistent"]],
  "S-D": ["PAYMENT", ["paymentOccurred"]],
};
const issuers = new Map();
const feeds = new Map();
const checkpoints = [];
for (const [issuerId, [kind, authorizedFacts]] of Object.entries(kinds)) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  issuers.set(issuerId, { issuerId, kind, keyVersion: 1, authorizedFacts, controlDomain: issuerId, status: "ACTIVE",
    validFrom: "2026-11-01T00:00:00.000Z", validUntil: "2026-12-01T00:00:00.000Z",
    ed25519PublicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64url") });
  const records = second.records[issuerId].map(record => signRecord({ ...record, issuerId, keyVersion: 1 }, privateKey));
  const feed = createFeed({ issuerId, keyVersion: 1, feedVersion: 2, records, ...second.coverage }, privateKey);
  feeds.set(issuerId, feed);
  checkpoints.push({ issuerId, keyVersion: 1, feedVersion: 2, root: feed.merkleRoot, effectiveAt: feed.issuedAt, anchoredAt: feed.issuedAt });
}
const issuerKeys = new Map([...issuers].map(([id, issuer]) => [`${id}:1`, issuer]));
const manifest = pinManifest({ requestedAt, requiredIssuers: [...issuers.values()], issuerKeys, checkpoints });
const records = new Map([...feeds.values()].flatMap(feed => feed.records).map(row => [row.recordId, row]));

test("pinned feeds establish integrity and scoped, signed absence", () => {
  const feed = feeds.get("S-A");
  const issuer = issuers.get("S-A");
  const checkpoint = checkpoints[0];
  assert.equal(verifyFeed(feed, checkpoint, issuer, requestedAt), true);
  assert.equal(verifyFeed({ ...feed, signature: feed.anchorSignature }, checkpoint, issuer, requestedAt), false);
  assert.equal(verifyFeed(feed, { ...checkpoint, anchoredAt: "2026-11-26T00:00:00.000Z" }, issuer, requestedAt), false);
  assert.equal(verifyFeed(feed, checkpoint, { ...issuer, status: "REVOKED" }, requestedAt), false);
  const record = feed.records[0];
  const proof = recordProof(feed.records, 0);
  assert.equal(verifyFeedMembership(record, proof, feed.merkleRoot), true);
  assert.equal(verifyFeedMembership({ ...record, originId: "unbound-origin" }, proof, feed.merkleRoot), false);
  assert.equal(proveAbsence(feed, checkpoint, issuer, requestedAt, "non-present", "SYNTHETIC_CLAIMS", record.effectiveAt), true);
  assert.equal(proveAbsence(feed, checkpoint, issuer, requestedAt, record.recordId, "SYNTHETIC_CLAIMS", record.effectiveAt), false);
  assert.equal(proveAbsence(feed, checkpoint, issuer, requestedAt, "non-present", "DIFFERENT_SCOPE", record.effectiveAt), false);
});

test("selects the newest eligible pin and distinguishes staleness, missing feed and transport timeout", async () => {
  const checkpoint = checkpoints[0];
  const late = { ...checkpoint, feedVersion: 3, anchoredAt: "2026-11-26T00:00:00.000Z" };
  assert.deepEqual(pinManifest({ requestedAt, requiredIssuers: [...issuers.values()], issuerKeys,
    checkpoints: [...checkpoints, late] }), manifest);
  const receive = fetcher => fetchPinnedFeed({ baseUrl: "http://127.0.0.1:1", token: "synthetic-token",
    checkpoint, issuer: issuers.get("S-A"), requestedAt, fetcher });
  assert.equal((await receive(async () => Response.json(feeds.get("S-A")))).status, "VERIFIED");
  assert.deepEqual(await receive(async () => Response.json({ code: "FEED_NOT_AVAILABLE", latestFeedVersion: 1 }, { status: 409 })),
    { status: "STALE_MIRROR" });
  assert.deepEqual(await receive(async () => new Response(null, { status: 404 })), { status: "PINNED_FEED_UNAVAILABLE" });
  assert.deepEqual(await receive(async () => { throw new DOMException("timeout", "TimeoutError"); }), { status: "TIMEOUT" });
});

function vectorFor(id, policy = diagnosticPolicy, inputRecords = records) {
  const { claimId, claimVersion, hospitalId, service, serviceDate, billMinor } = records.get(`${id}-his`).payload;
  return factsFromSources({ claim: { id: claimId, version: claimVersion, hospitalId, service, serviceDate, billMinor },
    policy, modelAdvice: "AUTO", manifestHash: manifest.manifestHash, records: inputRecords, issuers });
}

test("uses authority, lineage and effective dates before the deterministic decision", () => {
  assert.equal(decide(vectorFor("synthetic-42-1")), "AUTO_APPROVE");
  assert.equal(decide(vectorFor("synthetic-42-2")), "INTEGRITY_FAIL");
  const fourth = vectorFor("synthetic-42-4");
  assert.deepEqual(fourth.facts.tariffBand.evidence, ["tariff-2-INPATIENT-1"]);
  const payment = { ...diagnosticPolicy, requiredFacts: [...diagnosticPolicy.requiredFacts, "paymentOccurred"] };
  assert.equal(vectorFor("synthetic-42-4", payment).facts.paymentOccurred.status, "CONTRADICTED");
  const invoice = records.get("synthetic-42-1-his");
  const licence = records.get("licence-1-1");
  assert.equal(independentEvidence(invoice, licence, { records, issuers }, "invoiceIssued", "licenceActiveOnServiceDate"), true);
  for (const dependent of [{ ...licence, derivedFrom: [invoice.recordId] }, { ...licence, derivedFrom: ["unknown"] },
    { ...licence, derivedFrom: [licence.recordId] }]) {
    const lineage = new Map(records).set(licence.recordId, dependent);
    assert.equal(independentEvidence(invoice, dependent, { records: lineage, issuers }, "invoiceIssued", "licenceActiveOnServiceDate"), false);
    assert.equal(decide(vectorFor("synthetic-42-1", diagnosticPolicy, lineage)), "PANEL_REVIEW");
  }
  assert.equal(independentEvidence(invoice, records.get("synthetic-42-1-receipt"), { records, issuers },
    "invoiceIssued", "invoiceIssued"), false);
});
