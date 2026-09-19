import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canonicalProtocolHash } from "./protocol.mjs";
import { registryRootHash, validateRegistrySnapshot } from "./registry.mjs";

export const HYBRID_TRANSFORMATION_VERSION = "block-insure-hybrid-oracle-v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireText(record, field) {
  const value = String(record[field] ?? "").trim();
  if (!value) throw new Error(`Hybrid record ${record.recordId ?? "<unknown>"} is missing ${field}`);
  return value;
}

function normalizeInvoiceHash(value) {
  const hash = String(value ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Hybrid invoiceHash must contain 32 bytes");
  return hash;
}

function isoDate(record, field) {
  const value = requireText(record, field).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Hybrid ${field} must contain an ISO date`);
  }
  return value;
}

function amountMinor(record, field, fallback) {
  const divisor = Number(record.amountNormalizationDivisor ?? 1);
  const normalized = Number(record[field]);
  const value = Number.isFinite(normalized) && Number.isFinite(divisor)
    ? Math.round(normalized * divisor * 100)
    : Math.round(Number(fallback) * 100);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Hybrid ${field} cannot be converted to minor units`);
  return value;
}

export function hybridDescriptionHash(record) {
  return canonicalProtocolHash(
    `${HYBRID_TRANSFORMATION_VERSION}:description`,
    requireText(record, "treatmentType"),
    requireText(record, "diagnosisCode"),
    String(record.sourceProcedureCode ?? ""),
  );
}

export function hybridRecordToRegistryRecord(record) {
  const expected = Math.max(0, Number(record.sourceClaimAmountUsd ?? 0));
  const minimumAmountMinor = amountMinor(record, "expectedBillMin", expected);
  const maximumAmountMinor = amountMinor(record, "expectedBillMax", expected);
  const isValid = String(record.recordStatus).toUpperCase() === "VALID"
    && String(record.invoiceStatus).toUpperCase() === "VALID"
    && String(record.licenseStatus).toUpperCase() === "ACTIVE";
  return {
    lookupHash: normalizeInvoiceHash(record.invoiceHash),
    hospitalId: requireText(record, "hospitalId"),
    treatmentCode: requireText(record, "treatmentType"),
    minimumAmountMinor,
    maximumAmountMinor: Math.max(minimumAmountMinor, maximumAmountMinor),
    validFrom: isoDate(record, "admissionDate"),
    validThrough: isoDate(record, "dischargeDate"),
    descriptionHash: hybridDescriptionHash(record),
    status: isValid ? "VALID" : "INVALID",
  };
}

export function buildHybridRegistryReplica(records, {
  oracleId,
  snapshotId = "registry-hybrid-v1",
  version = 1,
  datasetId = "healthcare-provider-fraud-kaggle",
  datasetVersion = "blockinsure-hybrid-v1.2.0",
  inputSha256,
  generatedAt = new Date().toISOString(),
  corruptFirstRecord = false,
} = {}) {
  if (!/^oracle[123]$/.test(String(oracleId))) throw new Error("oracleId must be oracle1, oracle2, or oracle3");
  const mapped = records.map(hybridRecordToRegistryRecord);
  if (corruptFirstRecord && mapped.length > 0) {
    mapped[0] = { ...mapped[0], status: mapped[0].status === "VALID" ? "INVALID" : "VALID" };
  }
  const rulesVersion = HYBRID_TRANSFORMATION_VERSION;
  const rulesHash = canonicalProtocolHash(
    `${HYBRID_TRANSFORMATION_VERSION}:rules`, datasetId, datasetVersion, inputSha256,
  );
  const snapshot = {
    sourceId: `${oracleId}-${datasetVersion}`,
    snapshotId,
    version,
    rulesVersion,
    rulesHash,
    provenance: {
      datasetId,
      datasetVersion,
      inputSha256,
      transformationVersion: HYBRID_TRANSFORMATION_VERSION,
      generatedAt,
    },
    records: mapped,
  };
  const validated = validateRegistrySnapshot(snapshot);
  return { ...snapshot, rootHash: registryRootHash(validated) };
}

export async function buildHybridRegistryReplicas({
  inputPath,
  outputDirectory,
  snapshotId,
  version = 1,
  datasetId,
  datasetVersion,
  includeCorruptReplica = true,
}) {
  const input = await fs.readFile(inputPath);
  const records = input.toString("utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL record at line ${index + 1}: ${error.message}`); }
  });
  if (records.length === 0) throw new Error("Hybrid JSONL input is empty");
  const inputSha256 = sha256(input);
  const generatedAt = new Date().toISOString();
  const common = { snapshotId, version, datasetId, datasetVersion, inputSha256, generatedAt };
  const replicas = ["oracle1", "oracle2", "oracle3"].map((oracleId) => buildHybridRegistryReplica(records, { ...common, oracleId }));
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const [index, replica] of replicas.entries()) {
    await fs.writeFile(path.join(outputDirectory, `oracle${index + 1}-hybrid-v${version}.json`), `${JSON.stringify(replica, null, 2)}\n`);
  }
  let corruptReplica = null;
  if (includeCorruptReplica) {
    corruptReplica = buildHybridRegistryReplica(records, { ...common, oracleId: "oracle2", corruptFirstRecord: true });
    await fs.writeFile(path.join(outputDirectory, `oracle2-hybrid-corrupt-v${version}.json`), `${JSON.stringify(corruptReplica, null, 2)}\n`);
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    inputPath: path.resolve(inputPath),
    inputSha256,
    recordCount: records.length,
    snapshotId: replicas[0].snapshotId,
    version,
    rulesVersion: replicas[0].rulesVersion,
    rulesHash: replicas[0].rulesHash,
    baselineRootHash: replicas[0].rootHash,
    replicaRoots: Object.fromEntries(replicas.map((item) => [item.sourceId.split("-")[0], item.rootHash])),
    corruptRootHash: corruptReplica?.rootHash ?? null,
  };
  await fs.writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
