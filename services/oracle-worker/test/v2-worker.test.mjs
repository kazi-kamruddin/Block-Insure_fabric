import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { createFeed, signRecord } from "../../integrations/source-adapters/feed.mjs";
import { digest } from "../src/v2/canonical.mjs";
import { assessV2Request } from "../src/v2/worker.mjs";
import { assessE3Request } from "../src/e3-worker.mjs";
import { evaluatorE3Hash } from "../src/e3-release.mjs";
import { parseFactVector } from "../src/v2/fact-vector.mjs";
import { claim as fixtureClaim, source } from "./fixtures/xgboost-inputs.mjs";

test("E2 dispatch verifies signed pins and compares the restricted receipt across retrieval paths", async () => {
  const now = "2026-06-15T01:00:00.000Z";
  const at = "2026-06-14T01:00:00.000Z";
  const current = { ...source, treatmentType: "DIAGNOSTIC", serviceDate: fixtureClaim.incidentDate, associationStatus: "VERIFIED" };
  const claim = { ...fixtureClaim, id: "test-claim", version: 1 };
  const matching = { claimId: claim.id, claimVersion: claim.version, hospitalId: claim.hospitalId, service: current.treatmentType,
    serviceDate: current.serviceDate, billMinor: current.amountMinor, invoiceNumber: "INVOICE-1" };
  const invoice = { ...matching, kind: "INVOICE", invoiceHash: current.invoiceHash, invoiceDate: current.invoiceDate,
    admissionDate: current.admissionDate, dischargeDate: current.dischargeDate, diagnosisCode: current.diagnosisCode };
  const regulated = { hospitalId: claim.hospitalId, service: "DIAGNOSTIC", validFrom: "2026-06-01", validUntil: "2026-07-01" };
  const kinds = [
    ["source-a", "HOSPITAL_HIS", ["invoiceIssued"], [["invoice-row", invoice, []]]],
    ["source-b", "REGULATOR", ["licenceActiveOnServiceDate", "serviceAccredited", "tariffBand"], [
      ["licence", { ...regulated, kind: "LICENCE", status: "ACTIVE" }, []],
      ["accreditation", { ...regulated, kind: "ACCREDITATION", status: "ACCREDITED" }, []],
      ["tariff", { ...regulated, kind: "TARIFF", bandMinMinor: current.expectedMinMinor, bandMaxMinor: current.expectedMaxMinor }, []],
    ]],
    ["source-c", "CLAIMANT_RECEIPT", ["receiptConsistent"], [
      ["receipt-row", { ...matching, kind: "RECEIPT", invoiceRecordId: "invoice-row" }, ["invoice-row"]],
    ]],
  ];
  const stores = {}, anchors = {}, issuers = {};
  const pins = kinds.map(([issuerId, kind, authorizedFacts, rows]) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const ed25519PublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    issuers[issuerId] = { issuerId, kind, authorizedFacts, controlDomain: issuerId, keyVersion: 1, ed25519PublicKey,
      validFrom: "2026-06-01T00:00:00.000Z", validUntil: "2026-07-01T00:00:00.000Z", status: "ACTIVE" };
    const records = rows.map(([recordId, payload, derivedFrom]) => signRecord({
      issuerId, recordId, keyVersion: 1, originId: `origin-${recordId}`, derivedFrom, effectiveAt: at, payload,
    }, privateKey));
    const feed = createFeed({ issuerId, keyVersion: 1, feedVersion: 1, records, issuedAt: at, from: at, through: at }, privateKey);
    const pin = { issuerId, keyVersion: 1, feedVersion: 1, root: feed.merkleRoot, effectiveAt: at, anchoredAt: now };
    stores[issuerId] = feed;
    anchors[issuerId] = { ...pin, signature: feed.anchorSignature };
    return pin;
  });
  const manifest = { schema: "oracle-v2-source-manifest-v1", requestedAt: now, pins };
  const request = { id: "request-one", manifest, requestedAt: now, manifestHash: digest("oracle-v2:manifest", manifest) };
  const receipt = { derivedFrom: "invoice-row", hospitalId: claim.hospitalId, serviceDate: current.serviceDate,
    amountMinor: current.amountMinor, invoiceNumber: matching.invoiceNumber };
  const evaluate = async (name, id) => {
    if (name === "ReadMedicalOracleSourcesForRequest") return { current, priors: [], receipt };
    if (name === "ReadSourceIssuer") return issuers[id];
    if (name === "ReadSourceFeed") return anchors[id];
    throw new Error("unexpected query");
  };
  const config = { token: "placeholder-for-fetch-stub", endpoint: issuer => `http://localhost/${issuer}`,
    fetcher: async url => Response.json(stores[url.pathname.split("/")[1]]) };
  const verify = oracleId => assessV2Request({ request, claim, evaluate, config, oracleId, log: () => {} });
  const [direct, mirror, ownPeer] = await Promise.all(["oracle1", "oracle2", "oracle3"].map(verify));
  assert.equal(direct.vectorHash, mirror.vectorHash);
  assert.equal(direct.vectorHash, ownPeer.vectorHash);
  assert.equal(new Set([direct.diagnosticsHash, mirror.diagnosticsHash, ownPeer.diagnosticsHash]).size, 3);
  assert.equal(parseFactVector(direct.encoded).receiptCheck, "MATCH");
  const token = digest("test:scoped-patient-token", ["test-claim", 1]);
  const e3 = await assessE3Request({ request: { ...request, patientTokenKeyVersion: 1 }, claim, config, oracleId: "oracle1", log: () => {},
    evaluate: (name, id) => name === "ReadMedicalOracleE3SourcesForRequest"
      ? { current: { ...current, digestVersion: 2, patientReferenceHash: token }, priors: [], receipt }
      : evaluate(name, id) });
  assert.equal(e3.vectorHash, direct.vectorHash);
  assert.equal(e3.diagnostics.evaluatorHash, evaluatorE3Hash);
  assert.notEqual(e3.diagnosticsHash, direct.diagnosticsHash);
  receipt.invoiceNumber = "INVOICE-2";
  const mismatch = await verify("oracle3");
  assert.equal(parseFactVector(mismatch.encoded).receiptCheck, "MISMATCH");
  assert.equal(mismatch.decision, "PANEL_REVIEW");
});
