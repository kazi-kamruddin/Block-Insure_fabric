import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ledger } from "@/lib/fabric/ledger";
import type { HospitalInvoice } from "@/lib/fabric/types";
import { persistJsonFile } from "@/lib/events/state-file";

const protocolVersion = "block-insure-oracle-v1";
const rulesVersion = "hospital-invoice-rules-v1";

export type HospitalRegistryRecord = {
  lookupHash: string;
  hospitalId: string;
  treatmentCode: string;
  minimumAmountMinor: number;
  maximumAmountMinor: number;
  validFrom: string;
  validThrough: string;
  descriptionHash: string;
  status: "VALID";
};

export type HospitalRegistrySnapshotFile = {
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

function recordHash(record: HospitalRegistryRecord) {
  return canonicalHash(
    `${protocolVersion}:registry-record`, record.lookupHash, record.hospitalId,
    record.treatmentCode, record.minimumAmountMinor, record.maximumAmountMinor,
    record.validFrom, record.validThrough, record.descriptionHash, record.status,
  );
}

function oracleStateRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.ORACLE_STATE_ROOT?.trim() || "../../data/oracle");
}

function snapshotPath(id: string) {
  return path.join(oracleStateRoot(), "registries", `${id}.json`);
}

function recordsFromInvoices(invoices: HospitalInvoice[]) {
  const records = invoices.filter((invoice) => invoice.status === "FINALIZED")
    .sort((left, right) => left.invoiceReferenceHash.localeCompare(right.invoiceReferenceHash))
    .map((invoice): HospitalRegistryRecord => ({
      lookupHash: invoice.invoiceReferenceHash.toLowerCase(),
      hospitalId: invoice.hospitalId,
      treatmentCode: "HOSPITAL_INVOICE",
      minimumAmountMinor: invoice.amountMinor,
      maximumAmountMinor: invoice.amountMinor,
      validFrom: invoice.admissionDate,
      validThrough: invoice.dischargeDate,
      descriptionHash: invoice.treatmentHash.toLowerCase(),
      status: "VALID",
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

export async function refreshHospitalRegistrySnapshot() {
  const [invoices, published] = await Promise.all([ledger.listHospitalInvoices(), ledger.listOracleRegistrySnapshots()]);
  const records = recordsFromInvoices(invoices);
  if (records.length === 0) return null;
  const version = published.filter((item) => item.id.startsWith("registry-hospital-v"))
    .reduce((maximum, item) => Math.max(maximum, item.version), 0) + 1;
  const snapshotId = `registry-hospital-v${version}`;
  const rulesHash = createHash("sha256").update("Finalized Hospital invoice: exact hospital, amount, treatment hash, and admission/discharge window.").digest("hex");
  const rootHash = canonicalHash(
    `${protocolVersion}:registry`, version, rulesVersion, rulesHash,
    ...records.map(recordHash).sort((left, right) => left.localeCompare(right)),
  );
  const snapshot: HospitalRegistrySnapshotFile = {
    sourceId: "fabric-hospital-invoice-register", snapshotId, version,
    rulesVersion, rulesHash, rootHash, records,
  };
  await persistJsonFile(snapshotPath(snapshotId), snapshot);
  await ledger.publishOracleRegistrySnapshot({ id: snapshotId, version, rootHash, rulesVersion, rulesHash, recordCount: records.length });
  return snapshot;
}

export async function readHospitalRegistrySnapshot(id: string) {
  if (!/^registry-hospital-v[1-9][0-9]*$/.test(id)) throw new Error("Invalid Hospital registry snapshot ID");
  return JSON.parse(await fs.readFile(snapshotPath(id), "utf8")) as HospitalRegistrySnapshotFile;
}
