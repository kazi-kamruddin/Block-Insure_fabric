import { sha256Hex } from "@/lib/evidence/browser-crypto";
import { canonicalProtocolInput } from "@/lib/fabric/canonical-protocol";

export const registryRulesVersion = "hospital-invoice-rules-v2";
const protocolVersion = "block-insure-oracle-v1";

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
  rulesVersion: typeof registryRulesVersion;
  rulesHash: string;
  rootHash: string;
  records: HospitalRegistryRecord[];
};

export function canonicalRegistryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRegistryJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalRegistryJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function registryRecordInput(record: HospitalRegistryRecord) {
  return canonicalProtocolInput(
    `${protocolVersion}:registry-record-v2`, record.lookupHash, record.hospitalId,
    record.treatmentCode, record.minimumAmountMinor, record.maximumAmountMinor,
    record.validFrom, record.validThrough, record.descriptionHash, record.status,
    record.invoiceId, record.patientReferenceHash,
  );
}

type RootFields = Pick<HospitalRegistrySnapshotFile, "version" | "rulesVersion" | "rulesHash" | "records" | "modelContext">;
type Digest = (value: string) => string | Promise<string>;
const utf8 = new TextEncoder();
const browserDigest: Digest = value => sha256Hex(utf8.encode(value));

export async function computeHospitalRegistryRoot(snapshot: RootFields, digest: Digest = browserDigest) {
  const hashes: string[] = [];
  // Bound the number of Web Crypto jobs for larger browser manifests.
  for (let start = 0; start < snapshot.records.length; start += 128) {
    hashes.push(...await Promise.all(snapshot.records.slice(start, start + 128).map(record => digest(registryRecordInput(record)))));
  }
  if (snapshot.modelContext) {
    const modelHash = await digest(canonicalRegistryJson(snapshot.modelContext));
    return digest(canonicalProtocolInput(`${protocolVersion}:registry`, snapshot.version, snapshot.rulesVersion, snapshot.rulesHash, ...hashes.sort(), modelHash));
  }
  return digest(canonicalProtocolInput(`${protocolVersion}:registry`, snapshot.version, snapshot.rulesVersion, snapshot.rulesHash, ...hashes.sort()));
}

function byInvoice(value: unknown): value is { invoiceId: string; hospitalId: string } {
  return Boolean(value && typeof value === "object" && "invoiceId" in value && typeof value.invoiceId === "string"
    && "hospitalId" in value && typeof value.hospitalId === "string");
}

function assertHospitalScope(hospitalId: string, snapshot: HospitalRegistrySnapshotFile) {
  if (snapshot.records.some(record => record.hospitalId !== hospitalId) ||
    snapshot.modelContext?.records.some(record => !byInvoice(record) || record.hospitalId !== hospitalId)) {
    throw new Error("Registry contains entries outside the hospital scope");
  }
}

function indexRecords(snapshot: HospitalRegistrySnapshotFile | null, episodeIds: ReadonlyMap<string, string>) {
  const facts = new Map(snapshot?.modelContext?.records.filter(byInvoice).map(record => [record.invoiceId, record]));
  const incomplete = new Set(snapshot?.modelContext?.incompleteInvoiceIds);
  const index = new Map<string, { invoiceId: string; fingerprint: string }>();
  for (const record of snapshot?.records ?? []) {
    const { invoiceId } = record;
    index.set(episodeIds.get(invoiceId) ?? invoiceId, {
      invoiceId, fingerprint: canonicalRegistryJson([record, facts.get(invoiceId) ?? null, incomplete.has(invoiceId)]),
    });
  }
  for (const invoiceId of incomplete) {
    const key = episodeIds.get(invoiceId) ?? invoiceId;
    if (!index.has(key)) index.set(key, { invoiceId, fingerprint: "incomplete" });
  }
  return index;
}

export function buildRegistryManifest(hospitalId: string, snapshot: HospitalRegistrySnapshotFile, previous: HospitalRegistrySnapshotFile | null,
  episodeIds: ReadonlyMap<string, string> = new Map()) {
  assertHospitalScope(hospitalId, snapshot);
  if (previous) assertHospitalScope(hospitalId, previous);
  const before = indexRecords(previous, episodeIds);
  const after = indexRecords(snapshot, episodeIds);
  const added = [...after].filter(([key]) => !before.has(key)).map(([, record]) => record.invoiceId);
  const removed = [...before].filter(([key]) => !after.has(key)).map(([, record]) => record.invoiceId);
  const changed = [...after].flatMap(([key, record]) => {
    const original = before.get(key);
    return original && original.fingerprint !== record.fingerprint ? [{ before: original.invoiceId, after: record.invoiceId }] : [];
  });
  return { hospitalId, snapshot, previousId: previous?.snapshotId ?? null, diff: { added, removed, changed } };
}

export type RegistryManifest = ReturnType<typeof buildRegistryManifest>;

export async function verifyRegistryManifest(manifest: RegistryManifest, proposedRoot: string) {
  const root = await computeHospitalRegistryRoot(manifest.snapshot);
  return { root, canAttest: root === proposedRoot };
}
