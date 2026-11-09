import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ledger } from "@/lib/fabric/ledger";
import type { HospitalInvoice } from "@/lib/fabric/types";
import { persistJsonFile } from "@/lib/events/state-file";

const protocolVersion = "block-insure-oracle-v1";
const rulesVersion = "hospital-invoice-rules-v2";

export type HospitalRegistryRecord = {
  invoiceId: string;
  patientReferenceHash: string;
  lookupHash: string;
  hospitalId: string;
  treatmentCode: string;
  minimumAmountMinor: number;
  maximumAmountMinor: number;
  validFrom: string;
  validThrough: string;
  descriptionHash: string;
  status: "VALID" | "INVALID";
};

export type HospitalRegistrySnapshotFile = {
  modelContext?: { records: unknown[]; snapshotTimestamp: string; incompleteInvoiceIds: string[] };
  sourceId: "fabric-hospital-invoice-register";
  snapshotId: string;
  version: number;
  rulesVersion: typeof rulesVersion;
  rulesHash: string;
  rootHash: string;
  records: HospitalRegistryRecord[];
};

function canonicalHash(domain: string, ...values: Array<string | number | boolean>) {
  const parts = [domain, ...values.map((raw) => {
    const value = String(raw);
    return `${Buffer.byteLength(value, "utf8")}:${value}`;
  })];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function recordHash(record: HospitalRegistryRecord) {
  return canonicalHash(
    `${protocolVersion}:registry-record-v2`, record.lookupHash, record.hospitalId,
    record.treatmentCode, record.minimumAmountMinor, record.maximumAmountMinor,
    record.validFrom, record.validThrough, record.descriptionHash, record.status,
    record.invoiceId, record.patientReferenceHash,
  );
}

function oracleStateRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.ORACLE_STATE_ROOT?.trim() || "../../data/oracle");
}

function snapshotPath(id: string) {
  return path.join(oracleStateRoot(), "registries", `${id}.json`);
}

function recordsFromInvoices(invoices: HospitalInvoice[]) {
  const records = [...invoices]
    .sort((left, right) => left.invoiceReferenceHash.localeCompare(right.invoiceReferenceHash))
    .map((invoice): HospitalRegistryRecord => ({
      invoiceId: invoice.id,
      patientReferenceHash: invoice.patientReferenceHash.toLowerCase(),
      lookupHash: invoice.invoiceReferenceHash.toLowerCase(),
      hospitalId: invoice.hospitalId,
      treatmentCode: "HOSPITAL_INVOICE",
      minimumAmountMinor: 1,
      maximumAmountMinor: invoice.amountMinor,
      validFrom: invoice.admissionDate,
      validThrough: invoice.dischargeDate,
      descriptionHash: invoice.treatmentHash.toLowerCase(),
      status: invoice.status === "FINALIZED" ? "VALID" : "INVALID",
    }));

  // Replayed/idempotent Hospital imports can describe the same invoice facts
  // more than once. Collapse those safely, but quarantine a lookup hash when
  // different Hospitals or facts claim it: an Oracle must never choose an
  // arbitrary record from an ambiguous identifier.
  const unique = new Map<string, HospitalRegistryRecord>();
  const ambiguous = new Set<string>();
  for (const record of records) {
    const existing = unique.get(record.lookupHash);
    if (!existing) {
      unique.set(record.lookupHash, record);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(record)) ambiguous.add(record.lookupHash);
  }
  return [...unique.values()]
    .filter((record) => !ambiguous.has(record.lookupHash))
    .sort((left, right) => left.lookupHash.localeCompare(right.lookupHash));
}

async function publishHospitalRegistrySnapshot() {
  const [invoices, published] = await Promise.all([ledger.listHospitalInvoices(), ledger.listOracleRegistrySnapshots()]);
  const records = recordsFromInvoices(invoices);
  if (records.length === 0) return null;
  const latest = published.filter((item) => /^registry-hospital-v[1-9][0-9]*$/.test(item.id))
    .reduce<(typeof published)[number] | undefined>((previous, item) => !previous || item.version > previous.version ? item : previous, undefined);
  const version = (latest?.version ?? 0) + 1;
  const snapshotId = `registry-hospital-v${version}`;
  const rulesHash = createHash("sha256").update("Hospital invoice v2: finalized source, invoice ID, hospital and patient binding; positive claim up to invoice total within admission/discharge dates; narrative is not a treatment identifier.").digest("hex");
  let modelContext: HospitalRegistrySnapshotFile["modelContext"];
  if (process.env.FABRIC_XGBOOST_ENABLED === "true") {
    if ((process.env.ORACLE_REGISTRY_API_TOKEN ?? "").length < 32) throw new Error("Private model context requires a configured Oracle registry token");
    const modelRecords: unknown[] = [];
    const incompleteInvoiceIds: string[] = [];
    for (const invoice of [...invoices].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      try {
        const facts = await ledger.readHospitalModelFacts(invoice.id);
        modelRecords.push({ ...facts, invoiceHash: invoice.invoiceReferenceHash.toLowerCase(),
          hospitalMsp: "HospitalMSP", hospitalId: invoice.hospitalId, patientIssuerMsp: "InsurerMSP",
          patientReferenceHash: invoice.patientReferenceHash.toLowerCase(), treatmentHash: invoice.treatmentHash.toLowerCase(),
          amountMinor: invoice.amountMinor, admissionDate: invoice.admissionDate, dischargeDate: invoice.dischargeDate,
          invoiceStatus: invoice.status === "FINALIZED" ? "VALID" : "CANCELLED", recordStatus: invoice.status === "FINALIZED" ? "VALID" : "INVALID" });
      } catch (error) {
        if (!String(error).includes("does not exist")) throw error;
        incompleteInvoiceIds.push(invoice.id);
      }
    }
    modelContext = { records: modelRecords, incompleteInvoiceIds, snapshotTimestamp: new Date().toISOString() };
    if (latest) {
      const previous = await readHospitalRegistrySnapshot(latest.id).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
      if (previous?.modelContext && canonicalJson(previous.modelContext.records) === canonicalJson(modelRecords) &&
          canonicalJson(previous.modelContext.incompleteInvoiceIds) === canonicalJson(incompleteInvoiceIds)) modelContext.snapshotTimestamp = previous.modelContext.snapshotTimestamp;
    }
  }
  const rootForVersion = (value: number) => canonicalHash(
    `${protocolVersion}:registry`, value, rulesVersion, rulesHash,
    ...records.map(recordHash).sort((left, right) => left.localeCompare(right)),
    ...(modelContext ? [createHash("sha256").update(canonicalJson(modelContext)).digest("hex")] : []),
  );
  // Reuse unchanged facts instead of adding a ledger transaction for every
  // processing click. Recreate the local file if it was lost on restart.
  if (latest && latest.rootHash === rootForVersion(latest.version)) {
    const snapshot: HospitalRegistrySnapshotFile = {
      sourceId: "fabric-hospital-invoice-register", snapshotId: latest.id,
      version: latest.version, rulesVersion, rulesHash, rootHash: latest.rootHash, records, ...(modelContext ? { modelContext } : {}),
    };
    await persistJsonFile(snapshotPath(snapshot.snapshotId), snapshot);
    return snapshot;
  }
  const rootHash = rootForVersion(version);
  const snapshot: HospitalRegistrySnapshotFile = {
    sourceId: "fabric-hospital-invoice-register", snapshotId, version,
    rulesVersion, rulesHash, rootHash, records, ...(modelContext ? { modelContext } : {}),
  };
  await persistJsonFile(snapshotPath(snapshotId), snapshot);
  await ledger.publishOracleRegistrySnapshot({ id: snapshotId, version, rootHash, rulesVersion, rulesHash, recordCount: records.length });
  return snapshot;
}

let publicationQueue = Promise.resolve();

export function refreshHospitalRegistrySnapshot() {
  // Concurrent Hospital edits and insurer requests share a version allocator.
  // Always read the ledger after the preceding publication has committed.
  const operation = publicationQueue.then(publishHospitalRegistrySnapshot);
  publicationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function readHospitalRegistrySnapshot(id: string) {
  if (!/^registry-hospital-v[1-9][0-9]*$/.test(id)) throw new Error("Invalid Hospital registry snapshot ID");
  return JSON.parse(await fs.readFile(snapshotPath(id), "utf8")) as HospitalRegistrySnapshotFile;
}
