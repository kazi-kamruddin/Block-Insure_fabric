import { createPublicKey, verify } from "node:crypto";
import { digest } from "./canonical.mjs";
import { identifier, sha256Hex } from "./fact-vector.mjs";

export const factAuthorities = Object.freeze({
  invoiceIssued: "HOSPITAL_HIS",
  licenceActiveOnServiceDate: "REGULATOR",
  serviceAccredited: "REGULATOR",
  tariffBand: "REGULATOR",
  receiptConsistent: "CLAIMANT_RECEIPT",
  paymentOccurred: "PAYMENT",
});

const maxRecords = 10_000;
const publicKeyPattern = /^[A-Za-z0-9_-]+$/;

export function authorizedFor(issuer, fact) {
  return Boolean(issuer && Object.hasOwn(factAuthorities, fact) &&
    issuer.kind === factAuthorities[fact] && issuer.authorizedFacts?.includes(fact));
}

function verifyEnvelope(domain, envelope, issuer) {
  try {
    const { signature, ...body } = envelope;
    if (typeof signature !== "string" || signature.length !== 86 || !publicKeyPattern.test(signature) ||
        typeof issuer.ed25519PublicKey !== "string" || !publicKeyPattern.test(issuer.ed25519PublicKey)) return false;
    const key = createPublicKey({ key: Buffer.from(issuer.ed25519PublicKey, "base64url"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signed = Buffer.from(signature, "base64url");
    return signed.toString("base64url") === signature && verify(null, Buffer.from(digest(domain, body), "hex"), key, signed);
  } catch {
    return false;
  }
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN;
}

function activeKey(issuer, requestedAt) {
  const requested = instant(requestedAt);
  return issuer.status === "ACTIVE" && requested >= instant(issuer.validFrom) && requested < instant(issuer.validUntil);
}

export function verifyRecord(record, issuer, requestedAt) {
  if (!record || !issuer || record.issuerId !== issuer.issuerId || record.keyVersion !== issuer.keyVersion ||
      !activeKey(issuer, requestedAt) || !identifier.test(record.recordId) || !identifier.test(record.originId) ||
      !Array.isArray(record.derivedFrom) || record.derivedFrom.length > maxRecords ||
      record.derivedFrom.some(id => typeof id !== "string" || !identifier.test(id)) ||
      !(instant(record.effectiveAt) <= instant(requestedAt))) return false;
  return verifyEnvelope("oracle-v2:record", record, issuer);
}

const leaf = record => digest("oracle-v2:leaf", record);
const pair = (left, right) => digest("oracle-v2:node", [left, right]);

export function merkleRoot(records) {
  if (!records.length) return digest("oracle-v2:empty", []);
  let layer = records.map(leaf);
  while (layer.length > 1) {
    const upper = [];
    for (let index = 0; index < layer.length; index += 2) upper.push(pair(layer[index], layer[index + 1] ?? layer[index]));
    layer = upper;
  }
  return layer[0];
}

export function verifyFeedMembership(record, proof, root) {
  if (!proof || !Number.isSafeInteger(proof.index) || !Number.isSafeInteger(proof.size) ||
      proof.index < 0 || proof.index >= proof.size || proof.size > maxRecords ||
      !Array.isArray(proof.siblings) || proof.siblings.length !== Math.ceil(Math.log2(proof.size)) ||
      proof.siblings.some(sibling => !sha256Hex.test(sibling))) return false;
  let node = leaf(record);
  let width = proof.size;
  let index = proof.index;
  for (const sibling of proof.siblings) {
    if (width % 2 && index === width - 1 && sibling !== node) return false;
    node = index % 2 ? pair(sibling, node) : pair(node, sibling);
    width = Math.ceil(width / 2);
    index = Math.floor(index / 2);
  }
  return node === root;
}

export function verifyFeed(feed, checkpoint, issuer, requestedAt) {
  if (!feed || !checkpoint || !issuer || !activeKey(issuer, requestedAt) ||
      !(instant(checkpoint.anchoredAt) <= instant(requestedAt)) ||
      !(instant(checkpoint.effectiveAt) <= instant(checkpoint.anchoredAt)) ||
      !(instant(feed.issuedAt) <= instant(checkpoint.anchoredAt)) ||
      checkpoint.issuerId !== issuer.issuerId || checkpoint.keyVersion !== issuer.keyVersion ||
      feed.issuerId !== checkpoint.issuerId || feed.keyVersion !== checkpoint.keyVersion ||
      feed.feedVersion !== checkpoint.feedVersion || feed.merkleRoot !== checkpoint.root ||
      !Array.isArray(feed.records) || feed.records.length > maxRecords) return false;
  const { records, anchorSignature, ...signedManifest } = feed;
  const coverage = feed.coverage;
  if (!coverage || coverage.issuerId !== feed.issuerId || coverage.keyVersion !== feed.keyVersion ||
      coverage.feedVersion !== feed.feedVersion || coverage.root !== feed.merkleRoot ||
      !Array.isArray(coverage.recordIds) || coverage.recordIds.length !== records.length ||
      !records.every((record, index) =>
        record?.recordId === coverage.recordIds[index] && (index === 0 || coverage.recordIds[index - 1] < record.recordId) &&
        instant(coverage.from) <= instant(record.effectiveAt) && instant(record.effectiveAt) <= instant(coverage.through) &&
        verifyRecord(record, issuer, requestedAt)) ||
      new Set(coverage.recordIds).size !== records.length || !(instant(coverage.from) <= instant(coverage.through)) ||
      !(instant(coverage.through) <= instant(feed.issuedAt))) return false;
  const { signature: _coverageSignature, ...coverageBody } = coverage;
  const anchor = { issuerId: checkpoint.issuerId, keyVersion: checkpoint.keyVersion, feedVersion: checkpoint.feedVersion,
    root: checkpoint.root, effectiveAt: checkpoint.effectiveAt, coverageHash: digest("oracle-v2:coverage", coverageBody), signature: anchorSignature };
  return merkleRoot(records) === checkpoint.root &&
    verifyEnvelope("oracle-v2:feed", signedManifest, issuer) &&
    verifyEnvelope("oracle-v2:coverage", coverage, issuer) &&
    verifyEnvelope("oracle-v2:anchor", anchor, issuer);
}

export function proveAbsence(feed, checkpoint, issuer, requestedAt, recordId, scope, effectiveAt) {
  if (!verifyFeed(feed, checkpoint, issuer, requestedAt)) return false;
  const { coverage } = feed;
  const time = instant(effectiveAt);
  return coverage.scope === scope && time >= instant(coverage.from) && time <= instant(coverage.through) &&
    !coverage.recordIds.includes(recordId);
}

export function pinManifest({ requestedAt, requiredIssuers, issuerKeys, checkpoints }) {
  const pins = requiredIssuers.map(({ issuerId, kind }) => {
    const candidates = checkpoints.filter(checkpoint => {
      const issuer = issuerKeys.get(`${issuerId}:${checkpoint.keyVersion}`);
      return checkpoint.issuerId === issuerId && issuer?.kind === kind && activeKey(issuer, requestedAt) &&
        Number.isSafeInteger(checkpoint.feedVersion) && checkpoint.feedVersion > 0 && sha256Hex.test(checkpoint.root) &&
        instant(checkpoint.effectiveAt) <= instant(checkpoint.anchoredAt) && instant(checkpoint.anchoredAt) <= instant(requestedAt);
    }).sort((left, right) => instant(right.anchoredAt) - instant(left.anchoredAt) || right.feedVersion - left.feedVersion);
    if (!candidates.length) throw new Error("Required source checkpoint unavailable");
    const { keyVersion, feedVersion, root, effectiveAt, anchoredAt } = candidates[0];
    return { issuerId, keyVersion, feedVersion, root, effectiveAt, anchoredAt };
  }).sort((left, right) => left.issuerId < right.issuerId ? -1 : Number(left.issuerId > right.issuerId));
  if (new Set(pins.map(pin => pin.issuerId)).size !== pins.length) throw new Error("Duplicate source issuer requirement");
  const manifest = { schema: "oracle-v2-source-manifest-v1", requestedAt, pins };
  return { manifest, manifestHash: digest("oracle-v2:manifest", manifest) };
}

export async function fetchPinnedFeed({ baseUrl, token, checkpoint, issuer, requestedAt, timeoutMs = 2_000, fetcher = fetch }) {
  const url = new URL(`feed/${checkpoint.feedVersion}`, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  let response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { status: error.name === "TimeoutError" || error.name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE" };
  }
  if (response.status === 409) {
    const status = await response.json().catch(() => null);
    if (status?.code === "FEED_NOT_AVAILABLE" && Number.isSafeInteger(status.latestFeedVersion) &&
        status.latestFeedVersion < checkpoint.feedVersion) return { status: "STALE_MIRROR" };
  }
  if (response.status === 404) return { status: "PINNED_FEED_UNAVAILABLE" };
  if (!response.ok) return { status: "UNAVAILABLE" };
  try {
    const feed = await response.json();
    if (Number.isSafeInteger(feed?.feedVersion) && feed.feedVersion < checkpoint.feedVersion) return { status: "STALE_MIRROR" };
    return verifyFeed(feed, checkpoint, issuer, requestedAt) ? { status: "VERIFIED", feed } : { status: "INVALID_EVIDENCE" };
  } catch (error) {
    return { status: error.name === "TimeoutError" || error.name === "AbortError" ? "TIMEOUT" : "INVALID_EVIDENCE" };
  }
}

export function originClosure(record, records) {
  if (!record) return null;
  const visiting = new Set();
  const complete = new Set();
  const origins = new Set();
  const pending = [{ record, entered: false }];
  while (pending.length) {
    const step = pending.pop();
    const row = step.record;
    if (!row || !identifier.test(row.recordId ?? "") || !identifier.test(row.originId ?? "") || !Array.isArray(row.derivedFrom)) return null;
    if (step.entered) {
      visiting.delete(row.recordId);
      complete.add(row.recordId);
      continue;
    }
    if (complete.has(row.recordId)) continue;
    if (visiting.has(row.recordId) || visiting.size + complete.size >= maxRecords) return null;
    visiting.add(row.recordId);
    origins.add(row.originId);
    pending.push({ record: row, entered: true });
    for (const parent of row.derivedFrom) pending.push({ record: records.get(parent), entered: false });
  }
  return origins;
}

export function independentEvidence(left, right, { records, issuers }, leftFact = left?.payload?.fact, rightFact = right?.payload?.fact) {
  if (!left || !right || left.recordId === right.recordId) return false;
  const leftIssuer = issuers.get(left.issuerId);
  const rightIssuer = issuers.get(right.issuerId);
  if (!authorizedFor(leftIssuer, leftFact) || !authorizedFor(rightIssuer, rightFact) ||
      !leftIssuer.controlDomain || !rightIssuer.controlDomain || leftIssuer.controlDomain === rightIssuer.controlDomain ||
      (leftIssuer.keyVersion !== undefined && leftIssuer.keyVersion !== left.keyVersion) ||
      (rightIssuer.keyVersion !== undefined && rightIssuer.keyVersion !== right.keyVersion)) return false;
  const leftOrigins = originClosure(left, records);
  const rightOrigins = originClosure(right, records);
  return Boolean(leftOrigins && rightOrigins && ![...leftOrigins].some(origin => rightOrigins.has(origin)));
}
