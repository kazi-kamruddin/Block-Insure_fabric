import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ledger } from "@/lib/fabric/ledger";
import type { HospitalInvoice } from "@/lib/fabric/types";
import { persistJsonFile } from "@/lib/events/state-file";
import { loadFabricConfig } from "@/lib/fabric/config";
import { isMedicalChannel, medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { archiveRegistrySnapshot } from "./registry-archive.mjs";
import { canonicalRegistryJson, computeHospitalRegistryRoot, registryRulesVersion as rulesVersion,
  type HospitalRegistryRecord, type HospitalRegistrySnapshotFile } from "./registry-manifest";

export const registryDigest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function oracleStateRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.ORACLE_STATE_ROOT?.trim() || "../../data/oracle");
}

function snapshotPath(id: string) {
  return path.join(oracleStateRoot(), "registries", `${id}.json`);
}

const maxModelContextRecords = 10_000;

async function saveSnapshot(snapshot: HospitalRegistrySnapshotFile, channel: string) {
  const registryRoot = oracleStateRoot();
  const profileRoot = channel === medicalDevLiteChannel ? path.dirname(registryRoot) : registryRoot;
  await archiveRegistrySnapshot(path.join(profileRoot, "registry-archive"), snapshot);
  await persistJsonFile(snapshotPath(snapshot.snapshotId), snapshot);
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

async function publishHospitalRegistrySnapshot(hospitalScope?: string) {
  const channel = loadFabricConfig().channelName;
  const medical = isMedicalChannel(channel);
  if ((channel === medicalDevLiteChannel) !== Boolean(hospitalScope)) throw new Error("Dev-lite registry proposals require one hospital scope");
  if (medical && process.env.FABRIC_XGBOOST_ENABLED !== "true") throw new Error("Medical snapshots require the frozen evaluator and private Oracle access");
  const [legacyInvoices, allMedicalSources, published] = await Promise.all([
    medical ? Promise.resolve([]) : ledger.listHospitalInvoices(),
    medical ? ledger.listMedicalOracleSources() : Promise.resolve([]),
    ledger.listOracleRegistrySnapshots(),
  ]);
  const medicalSources = hospitalScope ? allMedicalSources.filter(source => source.invoice.hospitalId === hospitalScope) : allMedicalSources;
  const invoices = medical ? medicalSources.map(source => source.invoice).filter(invoice => invoice.status === "FINALIZED") : legacyInvoices;
  const records = recordsFromInvoices(invoices);
  if (records.length === 0) return null;
  const latest = published.filter((item) => /^registry-hospital-v[1-9][0-9]*$/.test(item.id) && item.hospitalId === hospitalScope)
    .reduce<(typeof published)[number] | undefined>((previous, item) => !previous || item.version > previous.version ? item : previous, undefined);
  const version = (hospitalScope ? Math.max(0, ...published.map(snapshot => snapshot.version)) : latest?.version ?? 0) + 1;
  const snapshotId = `registry-hospital-v${version}`;
  const rulesHash = createHash("sha256").update("Hospital invoice v2: finalized source, invoice ID, hospital and patient binding; positive claim up to invoice total within admission/discharge dates; narrative is not a treatment identifier.").digest("hex");
  let modelContext: HospitalRegistrySnapshotFile["modelContext"];
  if (process.env.FABRIC_XGBOOST_ENABLED === "true") {
    if ((process.env.ORACLE_REGISTRY_API_TOKEN ?? "").length < 32) throw new Error("Private model context requires a configured Oracle registry token");
    const modelRecords: unknown[] = [];
    const incompleteInvoiceIds = medicalSources.filter(source => !source.complete).map(source => source.invoice.id).sort();
    const medicalFacts = new Map(medicalSources.filter(source => source.complete).map(source => [source.invoice.id, source]));
    for (const invoice of [...invoices].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      try {
        const source = medicalFacts.get(invoice.id);
        if (medical && !source) continue;
        const facts = source?.facts ?? await ledger.readHospitalModelFacts(invoice.id);
        modelRecords.push({ ...facts, ...(source ? { benchmarkHash: source.benchmarkHash } : {}), invoiceHash: invoice.invoiceReferenceHash.toLowerCase(),
          hospitalMsp: "HospitalMSP", hospitalId: invoice.hospitalId, patientIssuerMsp: "InsurerMSP",
          patientReferenceHash: invoice.patientReferenceHash.toLowerCase(), treatmentHash: invoice.treatmentHash.toLowerCase(),
          amountMinor: invoice.amountMinor, admissionDate: invoice.admissionDate, dischargeDate: invoice.dischargeDate,
          invoiceStatus: invoice.status === "FINALIZED" ? "VALID" : "CANCELLED", recordStatus: invoice.status === "FINALIZED" ? "VALID" : "INVALID" });
      } catch (error) {
        if (!String(error).includes("does not exist")) throw error;
        incompleteInvoiceIds.push(invoice.id);
      }
      if (modelRecords.length > maxModelContextRecords) {
        throw new Error("The model context exceeds the 10,000-record limit. Use medical review for this claim.");
      }
    }
    modelContext = { records: modelRecords, incompleteInvoiceIds, snapshotTimestamp: new Date().toISOString() };
    if (latest) {
      const previous = await readHospitalRegistrySnapshot(latest.id).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
      if (previous?.modelContext && canonicalRegistryJson(previous.modelContext.records) === canonicalRegistryJson(modelRecords) &&
          canonicalRegistryJson(previous.modelContext.incompleteInvoiceIds) === canonicalRegistryJson(incompleteInvoiceIds)) modelContext.snapshotTimestamp = previous.modelContext.snapshotTimestamp;
    }
  }
  const rootForVersion = (value: number) => computeHospitalRegistryRoot({
    version: value, rulesVersion, rulesHash, records, modelContext,
  }, registryDigest);
  // Reuse unchanged facts instead of adding a ledger transaction for every
  // processing click. Recreate the local file if it was lost on restart.
  if (latest && latest.rootHash === await rootForVersion(latest.version)) {
    const snapshot: HospitalRegistrySnapshotFile = {
      sourceId: "fabric-hospital-invoice-register", snapshotId: latest.id,
      version: latest.version, rulesVersion, rulesHash, rootHash: latest.rootHash, records, ...(modelContext ? { modelContext } : {}),
    };
    await saveSnapshot(snapshot, channel);
    return snapshot;
  }
  const rootHash = await rootForVersion(version);
  const snapshot: HospitalRegistrySnapshotFile = {
    sourceId: "fabric-hospital-invoice-register", snapshotId, version,
    rulesVersion, rulesHash, rootHash, records, ...(modelContext ? { modelContext } : {}),
  };
  await saveSnapshot(snapshot, channel);
  const proposal = { id: snapshotId, version, rootHash, rulesVersion, rulesHash, recordCount: records.length };
  if (hospitalScope) await ledger.proposeMedicalRegistrySnapshot({ ...proposal, hospitalId: hospitalScope });
  else await ledger.publishOracleRegistrySnapshot(proposal);
  return snapshot;
}

let publicationQueue = Promise.resolve();

export function refreshHospitalRegistrySnapshot(hospitalScope?: string) {
  // Concurrent Hospital edits and insurer requests share a version allocator.
  // Always read the ledger after the preceding publication has committed.
  const operation = publicationQueue.then(() => publishHospitalRegistrySnapshot(hospitalScope));
  publicationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function currentAttestedMedicalSnapshot(hospitalId: string, invoiceId: string) {
  const snapshots = await ledger.listOracleRegistrySnapshots();
  const active = snapshots.filter(snapshot => snapshot.status === "ACTIVE" && snapshot.hospitalId === hospitalId)
    .sort((a, b) => b.version - a.version)[0];
  if (!active) throw new Error("Ask the assigned Hospital to attest a registry proposal before starting verification");
  const snapshot = await readHospitalRegistrySnapshot(active.id);
  if (snapshot.rootHash !== active.rootHash || !snapshot.records.some(record => record.invoiceId === invoiceId)) {
    throw new Error("The current episode revision needs a new Hospital-attested registry proposal");
  }
  return snapshot;
}

export async function readHospitalRegistrySnapshot(id: string) {
  if (!/^registry-hospital-v[1-9][0-9]*$/.test(id)) throw new Error("Invalid Hospital registry snapshot ID");
  return JSON.parse(await fs.readFile(snapshotPath(id), "utf8")) as HospitalRegistrySnapshotFile;
}
