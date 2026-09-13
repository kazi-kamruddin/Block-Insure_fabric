import { promises as fs } from "node:fs";
import { canonicalProtocolHash, ORACLE_PROTOCOL_VERSION } from "./protocol.mjs";

function requireHash(name, value) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ""))) {
    throw new Error(`${name} must be a 64-character hexadecimal hash`);
  }
  return String(value).toLowerCase();
}

function requireId(name, value) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(normalized)) {
    throw new Error(`${name} is invalid`);
  }
  return normalized;
}

function requireDate(name, value) {
  const normalized = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${name} must use YYYY-MM-DD`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${name} is not a valid calendar date`);
  }
  return normalized;
}

export function canonicalRecordHash(record) {
  return canonicalProtocolHash(
    `${ORACLE_PROTOCOL_VERSION}:registry-record`,
    requireHash("record.lookupHash", record.lookupHash),
    requireId("record.hospitalId", record.hospitalId),
    requireId("record.treatmentCode", record.treatmentCode),
    Number(record.minimumAmountMinor),
    Number(record.maximumAmountMinor),
    String(record.validFrom),
    String(record.validThrough),
    requireHash("record.descriptionHash", record.descriptionHash),
    String(record.status).toUpperCase(),
  );
}

export function registryRootHash(snapshot) {
  const recordHashes = snapshot.records
    .map(canonicalRecordHash)
    .sort((left, right) => left.localeCompare(right));
  return canonicalProtocolHash(
    `${ORACLE_PROTOCOL_VERSION}:registry`,
    Number(snapshot.version),
    requireId("rulesVersion", snapshot.rulesVersion),
    requireHash("rulesHash", snapshot.rulesHash),
    ...recordHashes,
  );
}

export function appealCommitmentHash(appeal) {
  return canonicalProtocolHash(
    "block-insure-fabric-appeal-v1:commitment",
    appeal.claimId,
    Number(appeal.claimVersion),
    appeal.reasonCategory,
    String(appeal.reasonHash).toLowerCase(),
    String(appeal.descriptionHash).toLowerCase(),
    String(appeal.evidenceHash ?? "").toLowerCase(),
    String(appeal.originalClaimHash).toLowerCase(),
    appeal.proposedHospitalId,
    Number(appeal.proposedAmountMinor),
    appeal.proposedIncidentDate,
    String(appeal.proposedDescriptionHash).toLowerCase(),
    String(appeal.proposedClinicalReferenceHash).toLowerCase(),
  );
}

export function validateAppealBinding({ request, claim, hospitalVerification, appeal }) {
  if (Number(request.claimVersion) <= 1) {
    return !request.appealId && !request.appealCommitmentHash && !hospitalVerification.appealId;
  }
  if (!appeal || appeal.commitmentVersion !== "block-insure-fabric-appeal-v1") return false;
  const computed = appealCommitmentHash(appeal);
  return appeal.id === request.appealId
    && appeal.id === claim.currentAppealId
    && Number(appeal.claimVersion) === Number(request.claimVersion)
    && appeal.commitmentHash === computed
    && request.appealCommitmentHash === computed
    && hospitalVerification.appealId === appeal.id
    && Number(hospitalVerification.claimVersion) === Number(request.claimVersion)
    && appeal.hospitalVerificationId === hospitalVerification.id
    && claim.hospitalId === appeal.proposedHospitalId
    && Number(claim.amountMinor) === Number(appeal.proposedAmountMinor)
    && claim.incidentDate === appeal.proposedIncidentDate
    && String(claim.descriptionHash).toLowerCase() === String(appeal.proposedDescriptionHash).toLowerCase()
    && String(hospitalVerification.clinicalReferenceHash).toLowerCase() === String(appeal.proposedClinicalReferenceHash).toLowerCase();
}

export function validateRegistrySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.records)) {
    throw new Error("Oracle registry snapshot must contain a records array");
  }
  const normalized = {
    sourceId: requireId("sourceId", snapshot.sourceId),
    snapshotId: requireId("snapshotId", snapshot.snapshotId),
    version: Number(snapshot.version),
    rulesVersion: requireId("rulesVersion", snapshot.rulesVersion),
    rulesHash: requireHash("rulesHash", snapshot.rulesHash),
    records: snapshot.records.map((record) => ({
      ...record,
      lookupHash: requireHash("record.lookupHash", record.lookupHash),
      descriptionHash: requireHash("record.descriptionHash", record.descriptionHash),
      hospitalId: requireId("record.hospitalId", record.hospitalId),
      treatmentCode: requireId("record.treatmentCode", record.treatmentCode),
      minimumAmountMinor: Number(record.minimumAmountMinor),
      maximumAmountMinor: Number(record.maximumAmountMinor),
      validFrom: requireDate("record.validFrom", record.validFrom),
      validThrough: requireDate("record.validThrough", record.validThrough),
      status: String(record.status).toUpperCase(),
    })),
  };
  if (!Number.isInteger(normalized.version) || normalized.version < 1) {
    throw new Error("Oracle registry version must be a positive integer");
  }
  const lookupKeys = new Set();
  for (const record of normalized.records) {
    if (lookupKeys.has(record.lookupHash)) throw new Error(`Duplicate registry lookup hash ${record.lookupHash}`);
    lookupKeys.add(record.lookupHash);
    if (!Number.isSafeInteger(record.minimumAmountMinor) || !Number.isSafeInteger(record.maximumAmountMinor) || record.minimumAmountMinor < 0 || record.maximumAmountMinor < record.minimumAmountMinor) {
      throw new Error(`Invalid amount bounds for ${record.lookupHash}`);
    }
    if (record.validThrough < record.validFrom) throw new Error(`Invalid coverage date range for ${record.lookupHash}`);
    if (!["VALID", "INVALID"].includes(record.status)) throw new Error(`Invalid record status for ${record.lookupHash}`);
    canonicalRecordHash(record);
  }
  return {
    ...normalized,
    rootHash: registryRootHash(normalized),
    recordsByLookupHash: new Map(normalized.records.map((record) => [record.lookupHash, record])),
  };
}

export async function loadRegistrySnapshot(filePath) {
  return validateRegistrySnapshot(JSON.parse(await fs.readFile(filePath, "utf8")));
}

export function assessRegistryRecord({ snapshot, request, claim, hospitalVerification, appeal, configuredModelVersion, configuredModelHash }) {
  const record = snapshot.recordsByLookupHash.get(String(hospitalVerification.clinicalReferenceHash).toLowerCase());
  let verificationCode = "VERIFIED";
  if (!validateAppealBinding({ request, claim, hospitalVerification, appeal })) verificationCode = "APPEAL_COMMITMENT_MISMATCH";
  else if (configuredModelVersion !== undefined && (configuredModelVersion !== request.modelVersion || String(configuredModelHash).toLowerCase() !== request.modelHash)) verificationCode = "MODEL_VERSION_MISMATCH";
  else if (snapshot.snapshotId !== request.registrySnapshotId || snapshot.version !== request.registryVersion) verificationCode = "SNAPSHOT_VERSION_MISMATCH";
  else if (snapshot.rootHash !== request.registryRootHash) verificationCode = "REGISTRY_ROOT_MISMATCH";
  else if (snapshot.rulesVersion !== request.rulesVersion || snapshot.rulesHash !== request.rulesHash) verificationCode = "RULES_VERSION_MISMATCH";
  else if (!record) verificationCode = "RECORD_NOT_FOUND";
  else if (record.status !== "VALID") verificationCode = "RECORD_INVALID";
  else if (String(claim.hospitalId) !== record.hospitalId) verificationCode = "HOSPITAL_MISMATCH";
  else if (claim.amountMinor < record.minimumAmountMinor || claim.amountMinor > record.maximumAmountMinor) verificationCode = "AMOUNT_OUT_OF_RANGE";
  else if (claim.incidentDate < record.validFrom || claim.incidentDate > record.validThrough) verificationCode = "INCIDENT_DATE_MISMATCH";
  else if (String(claim.descriptionHash).toLowerCase() !== record.descriptionHash) verificationCode = "DESCRIPTION_MISMATCH";
  return {
    verified: verificationCode === "VERIFIED",
    verificationCode,
    recordHash: record ? canonicalRecordHash(record) : "0".repeat(64),
  };
}
