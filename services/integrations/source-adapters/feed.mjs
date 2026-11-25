import { sign, verify } from "node:crypto";
import { digest } from "../../oracle-worker/src/v2/canonical.mjs";

const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const rootPattern = /^[a-f0-9]{64}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;
const coverageScope = "SYNTHETIC_CLAIMS";
const validId = value => typeof value === "string" && identityPattern.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validHash = value => typeof value === "string" && rootPattern.test(value);
const leaf = record => digest("oracle-v2:leaf", record);
const node = (left, right) => digest("oracle-v2:node", [left, right]);

export function signBody(domain, body, key) {
  return sign(null, Buffer.from(digest(domain, body), "hex"), key).toString("base64url");
}

export function verifySigned(domain, body, signature, key) {
  if (typeof signature !== "string" || !signaturePattern.test(signature)) return false;
  try {
    const bytes = Buffer.from(signature, "base64url");
    return bytes.toString("base64url") === signature && verify(null, Buffer.from(digest(domain, body), "hex"), key, bytes);
  } catch {
    return false;
  }
}

function validRecord(body) {
  return validId(body.recordId) && validId(body.issuerId) && positiveInteger(body.keyVersion) &&
    validId(body.originId) && Array.isArray(body.derivedFrom) && body.derivedFrom.every(validId) &&
    new Set(body.derivedFrom).size === body.derivedFrom.length && !body.derivedFrom.includes(body.recordId) &&
    validDate(body.effectiveAt) && body.payload && typeof body.payload === "object" && !Array.isArray(body.payload);
}

export function signRecord(body, privateKey) {
  if (!validRecord(body) || Object.hasOwn(body, "signature")) throw new Error("Invalid source record");
  return { ...body, signature: signBody("oracle-v2:record", body, privateKey) };
}

export function verifyRecord(record, publicKey) {
  if (!record || typeof record !== "object") return false;
  const { signature, ...body } = record;
  return Boolean(validRecord(body)) && verifySigned("oracle-v2:record", body, signature, publicKey);
}

function merkleLevels(records) {
  const levels = [records.map(leaf)];
  while (levels.at(-1).length > 1) {
    const row = levels.at(-1);
    const parents = [];
    for (let index = 0; index < row.length; index += 2) parents.push(node(row[index], row[index + 1] ?? row[index]));
    levels.push(parents);
  }
  return levels;
}

export function merkleRoot(records) {
  return merkleLevels(records).at(-1)[0] ?? digest("oracle-v2:empty", []);
}

export function recordProof(records, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= records.length) throw new Error("Record index outside feed");
  const siblings = [];
  let position = index;
  for (const level of merkleLevels(records).slice(0, -1)) {
    siblings.push(level[position % 2 === 0 ? position + 1 : position - 1] ?? level[position]);
    position = Math.floor(position / 2);
  }
  return { index, size: records.length, siblings };
}

export function verifyRecordProof(record, proof, root) {
  if (!proof || !positiveInteger(proof.size) || !Number.isSafeInteger(proof.index) || proof.index < 0 || proof.index >= proof.size ||
      !Array.isArray(proof.siblings) || !proof.siblings.every(validHash) || !validHash(root)) return false;
  let position = proof.index;
  let remaining = proof.size;
  let hash;
  try { hash = leaf(record); }
  catch { return false; }
  for (const sibling of proof.siblings) {
    if (remaining <= 1 || (position % 2 === 0 && position === remaining - 1 && sibling !== hash)) return false;
    hash = position % 2 === 0 ? node(hash, sibling) : node(sibling, hash);
    position = Math.floor(position / 2);
    remaining = Math.ceil(remaining / 2);
  }
  return remaining === 1 && hash === root;
}

function validCoverage(body) {
  return validId(body.issuerId) && positiveInteger(body.keyVersion) && positiveInteger(body.feedVersion) && validHash(body.root) &&
    body.scope === coverageScope && validDate(body.from) && validDate(body.through) && body.from <= body.through &&
    Array.isArray(body.recordIds) && body.recordIds.every((id, index) => validId(id) && (index === 0 || body.recordIds[index - 1] < id));
}

export function verifyCoverage(coverage, publicKey) {
  if (!coverage || typeof coverage !== "object") return false;
  const { signature, ...body } = coverage;
  return validCoverage(body) && verifySigned("oracle-v2:coverage", body, signature, publicKey);
}

export function verifyAbsentRecord(coverage, publicKey, pin, recordId, effectiveAt) {
  return Boolean(pin) && validId(recordId) && validDate(effectiveAt) && verifyCoverage(coverage, publicKey) &&
    ["issuerId", "keyVersion", "feedVersion", "root"].every(field => coverage[field] === pin[field]) &&
    effectiveAt >= coverage.from && effectiveAt <= coverage.through && !coverage.recordIds.includes(recordId);
}

function feedAnchor(header) {
  const { signature: _coverageSignature, ...coverage } = header.coverage;
  return {
    issuerId: header.issuerId, keyVersion: header.keyVersion, feedVersion: header.feedVersion,
    root: header.merkleRoot, effectiveAt: header.issuedAt, coverageHash: digest("oracle-v2:coverage", coverage),
  };
}

export function createFeed({ issuerId, keyVersion, feedVersion, records, issuedAt, from, through }, privateKey) {
  const ordered = [...records].sort((first, second) => first.recordId < second.recordId ? -1 : Number(first.recordId > second.recordId));
  const root = merkleRoot(ordered);
  const coverageBody = { issuerId, keyVersion, feedVersion, root, scope: coverageScope, from, through, recordIds: ordered.map(record => record.recordId) };
  if (!validCoverage(coverageBody) || !validDate(issuedAt) || issuedAt < through || ordered.some(record =>
    record.issuerId !== issuerId || record.keyVersion !== keyVersion || record.effectiveAt < from || record.effectiveAt > through)) {
    throw new Error("Invalid feed coverage or record binding");
  }
  const coverage = { ...coverageBody, signature: signBody("oracle-v2:coverage", coverageBody, privateKey) };
  const header = { issuerId, keyVersion, feedVersion, merkleRoot: root, coverage, issuedAt };
  return { ...header, records: ordered, signature: signBody("oracle-v2:feed", header, privateKey),
    anchorSignature: signBody("oracle-v2:anchor", feedAnchor(header), privateKey) };
}

export function verifyFeed(feed, publicKey) {
  if (!feed || typeof feed !== "object") return false;
  const { records, signature, anchorSignature, ...header } = feed;
  const { issuerId, keyVersion, feedVersion, merkleRoot: root, coverage, issuedAt } = header;
  return verifyCoverage(coverage, publicKey) && coverage.issuerId === issuerId && coverage.keyVersion === keyVersion &&
    coverage.feedVersion === feedVersion && coverage.root === root && validDate(issuedAt) && issuedAt >= coverage.through &&
    Array.isArray(records) && records.length === coverage.recordIds.length && records.every((record, index) =>
      verifyRecord(record, publicKey) && record.recordId === coverage.recordIds[index] && record.issuerId === issuerId &&
      record.keyVersion === keyVersion && record.effectiveAt >= coverage.from && record.effectiveAt <= coverage.through) &&
    merkleRoot(records) === root && verifySigned("oracle-v2:feed", header, signature, publicKey) &&
    verifySigned("oracle-v2:anchor", feedAnchor(header), anchorSignature, publicKey);
}
