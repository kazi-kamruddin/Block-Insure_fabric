import { createPrivateKey, createPublicKey, generateKeyPairSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createFeed, recordProof, signBody, signRecord } from "./feed.mjs";
import { fixture } from "./fixtures/generate.mjs";
import { createFeedStore, mirrorFeeds, publishOnce } from "./store.mjs";

export const issuers = Object.freeze({
  "S-A": { kind: "HOSPITAL_HIS", authorizedFacts: ["invoiceIssued"], controlDomain: "synthetic-hospital" },
  "S-B": { kind: "REGULATOR", authorizedFacts: ["licenceActiveOnServiceDate", "serviceAccredited", "tariffBand"], controlDomain: "synthetic-regulator" },
  "S-C": { kind: "CLAIMANT_RECEIPT", authorizedFacts: ["receiptConsistent"], controlDomain: "synthetic-claimant" },
  "S-D": { kind: "PAYMENT", authorizedFacts: ["paymentOccurred"], controlDomain: "synthetic-bank" },
});

const issuerIds = Object.keys(issuers);
const oracleIds = ["oracle1", "oracle2", "oracle3"];
const recordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const validVersion = value => Number.isSafeInteger(value) && value > 0;
const rootPattern = /^[a-f0-9]{64}$/;

function credentials(tokens) {
  const values = oracleIds.map(id => tokens[id]);
  if (values.some(token => typeof token !== "string" || !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) || new Set(values).size !== oracleIds.length) {
    throw new Error("Configure a distinct 32–256 character bearer token for each Oracle subject");
  }
  return oracleIds.map(id => [id, Buffer.from(tokens[id])]);
}

function authenticate(request, subjects) {
  const matched = /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(request.headers.authorization ?? "");
  if (!matched) return null;
  const candidate = Buffer.from(matched[1]);
  let subject = null;
  for (const [id, token] of subjects) {
    if (candidate.length === token.length && timingSafeEqual(candidate, token)) subject = id;
  }
  return subject;
}

async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return null; }
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function handleRequests({ store, issuerId, privateKey, subjects }) {
  async function chooseFeed(response, rawVersion) {
    if (rawVersion === null || rawVersion === "latest") {
      const latest = await store.latest(issuerId);
      if (!latest) send(response, 409, { code: "FEED_NOT_AVAILABLE", latestFeedVersion: 0 });
      return latest;
    }
    const version = Number(rawVersion);
    if (!/^[1-9]\d*$/.test(rawVersion) || !validVersion(version)) {
      send(response, 400, { code: "INVALID_FEED_VERSION" });
      return null;
    }
    const feed = await store.read(issuerId, version);
    if (!feed) {
      const latestFeedVersion = await store.latestVersion(issuerId);
      send(response, version > latestFeedVersion ? 409 : 404, { code: "FEED_NOT_AVAILABLE", latestFeedVersion });
    }
    return feed;
  }

  return async function handle(request, response) {
    const oracle = authenticate(request, subjects);
    if (!oracle) return send(response, 401, { code: "BEARER_REQUIRED" });
    const url = new URL(request.url, "http://127.0.0.1");
    const match = /^\/(feed|coverage|record)\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      const [, endpoint, parameter] = match;
      const version = endpoint === "record" ? url.searchParams.get("version") : parameter;
      if (endpoint === "record" && !recordIdPattern.test(parameter)) return send(response, 400, { code: "INVALID_RECORD_ID" });
      const feed = await chooseFeed(response, version);
      if (!feed) return;
      if (endpoint === "feed") return send(response, 200, feed);
      if (endpoint === "coverage") return send(response, 200, feed.coverage);
      const index = feed.records.findIndex(record => record.recordId === parameter);
      if (index === -1) return send(response, 404, { code: "RECORD_NOT_FOUND" });
      return send(response, 200, { record: feed.records[index], proof: recordProof(feed.records, index), issuerId,
        feedVersion: feed.feedVersion, root: feed.merkleRoot });
    }

    if (request.method === "POST" && url.pathname === "/retrieval-receipt") {
      const body = await jsonBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 4 ||
          typeof body.requestId !== "string" || !recordIdPattern.test(body.requestId) || !validVersion(body.feedVersion) ||
          typeof body.root !== "string" || !rootPattern.test(body.root)) return send(response, 400, { code: "INVALID_RETRIEVAL" });
      if (body.oracleId !== oracle) return send(response, 403, { code: "ORACLE_ID_MISMATCH" });
      const feed = await chooseFeed(response, String(body.feedVersion));
      if (!feed) return;
      if (feed.merkleRoot !== body.root) return send(response, 409, { code: "ROOT_MISMATCH" });
      const receipt = { requestId: body.requestId, oracleId: oracle, feedVersion: body.feedVersion, root: body.root };
      return send(response, 200, { issuerId, receipt: { ...receipt, signature: signBody("oracle-v2:retrieval", receipt, privateKey) } });
    }
    return send(response, 404, { code: "ENDPOINT_NOT_FOUND" });
  };
}

export async function listenAdapters({ store, receiptKeys, ports, tokens }) {
  const subjects = credentials(tokens);
  const servers = [];
  const urls = {};
  const close = () => Promise.all(servers.map(server => new Promise(resolveClosed => server.close(resolveClosed))));

  try {
    for (const issuerId of issuerIds) {
      const privateKey = receiptKeys[issuerId]?.privateKey;
      const port = ports[issuerId];
      if (!privateKey || !Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid adapter listener settings");
      const handle = handleRequests({ store, issuerId, privateKey, subjects });
      const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, (request, response) => {
        handle(request, response).catch(() => {
          if (!response.headersSent && !response.destroyed) send(response, 500, { code: "FEED_UNAVAILABLE" });
          else response.destroy();
        });
      });
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", rejectListen);
          resolveListen();
        });
      });
      servers.push(server);
      urls[issuerId] = `http://127.0.0.1:${server.address().port}`;
    }
    return { urls, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function loadLocalKey(directory, issuerId) {
  const filename = join(directory, `${issuerId}.pem`);
  let pem;
  try { pem = await readFile(filename); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const { privateKey } = generateKeyPairSync("ed25519");
    try { await publishOnce(filename, privateKey.export({ type: "pkcs8", format: "pem" })); }
    catch (conflict) { if (conflict.code !== "EEXIST") throw conflict; }
    pem = await readFile(filename);
  }
  try {
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Invalid source adapter signing key type");
    return { privateKey, publicKey: createPublicKey(privateKey) };
  } finally { pem.fill(0); }
}

async function localKeys(directory) {
  return Object.fromEntries(await Promise.all(issuerIds.map(async issuerId => [issuerId, await loadLocalKey(directory, issuerId)])));
}

const encodeKey = key => key.export({ type: "spki", format: "der" }).toString("base64url");
const decodeKey = value => createPublicKey({ key: Buffer.from(value, "base64url"), type: "spki", format: "der" });

async function retainMetadata(filename, value) {
  const bytes = JSON.stringify(value, null, 2) + "\n";
  try { await publishOnce(filename, bytes); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(filename, "utf8") !== bytes) throw new Error("Existing adapter metadata differs");
  }
}

async function publishFixtures(store, keys, seed) {
  for (const [version, synthetic] of fixture(seed).versions.entries()) {
    for (const issuerId of issuerIds) {
      const { privateKey } = keys[issuerId];
      const records = synthetic.records[issuerId].map(row => signRecord({ issuerId, keyVersion: 1, ...row }, privateKey));
      const feed = createFeed({ issuerId, keyVersion: 1, feedVersion: version + 1, records, ...synthetic.coverage }, privateKey);
      const existing = await store.read(issuerId, feed.feedVersion);
      if (!existing) await store.append(feed);
      else if (existing.signature !== feed.signature) throw new Error("Stored feed differs from the requested fixture seed");
    }
  }
}

async function main() {
  const options = Object.fromEntries(["root", "mirror-from", "through-version", "seed", "port-his", "port-regulator", "port-receipt", "port-payment"]
    .map(name => [name, { type: "string" }]));
  const { values } = parseArgs({ options });
  const mirrorFrom = values["mirror-from"] ? resolve(values["mirror-from"]) : null;
  const defaultRoot = fileURLToPath(new URL("../../../data/dev-lite/source-adapters/", import.meta.url));
  const root = resolve(values.root ?? (mirrorFrom ? join(defaultRoot, "mirror") : defaultRoot));
  if (mirrorFrom && root === mirrorFrom) throw new Error("Mirror requires a separate state directory");
  const throughVersion = Number(values["through-version"] ?? Number.MAX_SAFE_INTEGER);
  if ((values["through-version"] && !mirrorFrom) || !validVersion(throughVersion)) throw new Error("A mirror version cap must be a positive integer");
  const seed = Number(values.seed ?? 42);
  if (!mirrorFrom) fixture(seed);
  const tokens = Object.fromEntries(oracleIds.map(id => [id, process.env[`ORACLE_ADAPTER_TOKEN_${id.toUpperCase()}`]]));
  credentials(tokens);
  const firstPort = mirrorFrom ? 3421 : 3411;
  const portOptions = ["port-his", "port-regulator", "port-receipt", "port-payment"];
  const ports = Object.fromEntries(issuerIds.map((id, index) => [id, Number(values[portOptions[index]] ?? firstPort + index)]));
  if (Object.values(ports).some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535) || new Set(Object.values(ports)).size !== issuerIds.length) {
    throw new Error("Select four distinct listener ports");
  }

  const keys = await localKeys(join(root, "keys"));
  const registry = mirrorFrom ? JSON.parse(await readFile(join(mirrorFrom, "issuer-registry.json"), "utf8")) :
    issuerIds.map(issuerId => ({ issuerId, ...issuers[issuerId], keyVersion: 1, ed25519PublicKey: encodeKey(keys[issuerId].publicKey),
      validFrom: "2026-11-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "ACTIVE" }));
  const publicKeys = Object.fromEntries(registry.map(row => [row.issuerId, decodeKey(row.ed25519PublicKey)]));
  const store = createFeedStore(root, publicKeys);
  await retainMetadata(join(root, "issuer-registry.json"), registry);
  await retainMetadata(join(root, "retrieval-keys.json"), Object.fromEntries(issuerIds.map(id => [id, encodeKey(keys[id].publicKey)])));

  const source = mirrorFrom ? createFeedStore(mirrorFrom, publicKeys) : null;
  if (source) {
    if (values["through-version"] && (await Promise.all(issuerIds.map(id => store.latestVersion(id)))).some(version => version > throughVersion)) {
      throw new Error("A stale mirror needs a new directory when the existing copy already exceeded the requested cap");
    }
    await mirrorFeeds(source, store, issuerIds, throughVersion);
  } else await publishFixtures(store, keys, seed);

  const listener = await listenAdapters({ store, receiptKeys: keys, ports, tokens });
  console.info(JSON.stringify({ mode: source ? "mirror" : "direct", urls: listener.urls, memory: process.memoryUsage() }));
  let stopping = false;
  let timer;
  const refresh = async () => {
    try { await mirrorFeeds(source, store, issuerIds, throughVersion); }
    catch { console.warn("Source adapter mirror refresh failed"); }
    if (!stopping) timer = setTimeout(refresh, 15_000);
  };
  if (source) timer = setTimeout(refresh, 15_000);
  const close = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    void listener.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
