import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const issuerIds = ["S-A", "S-B", "S-C", "S-D"];
const start = "2026-11-01T00:00:00.000Z";
const date = day => `2026-11-${String(day).padStart(2, "0")}`;
const beginning = day => date(day) + "T00:00:00.000Z";
const end = day => date(day) + "T23:59:59.999Z";
const record = (recordId, originId, effectiveAt, payload, derivedFrom = []) => ({ recordId, originId, derivedFrom, effectiveAt, payload });

function rng(seed) {
  let state = seed >>> 0;
  return limit => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

function coverage(lastDay) {
  return { from: start, through: end(lastDay), issuedAt: beginning(lastDay + 1) };
}

export function fixture(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be an unsigned 32-bit integer");
  const integer = rng(seed);
  const first = Object.fromEntries(issuerIds.map(id => [id, []]));
  const next = Object.fromEntries(issuerIds.map(id => [id, []]));
  const hospitals = ["hospital-synthetic-1", "hospital-synthetic-2"];
  const services = ["DIAGNOSTIC", "INPATIENT"];

  for (const [index, hospitalId] of hospitals.entries()) {
    const suffix = index + 1;
    first["S-B"].push(record(`licence-${suffix}-1`, `licence-origin-${suffix}`, start, {
      kind: "LICENCE", hospitalId, validFrom: date(1), validUntil: date(30), status: index === 0 ? "ACTIVE" : "SUSPENDED",
    }));
    for (const service of services) {
      first["S-B"].push(record(`accredit-${suffix}-${service}`, `accreditation-origin-${suffix}-${service}`, start,
        { kind: "ACCREDITATION", hospitalId, service, validFrom: date(1), validUntil: date(30), status: "ACCREDITED" }));
      first["S-B"].push(record(`tariff-${suffix}-${service}-1`, `tariff-origin-${suffix}-${service}-1`, start, {
        kind: "TARIFF", hospitalId, service, validFrom: date(1), validUntil: date(30), bandMinMinor: 800_000, bandMaxMinor: 3_200_000,
      }));
    }
  }

  next["S-B"].push(record("tariff-1-DIAGNOSTIC-2", "tariff-origin-1-DIAGNOSTIC-2", beginning(20), {
    kind: "TARIFF", hospitalId: hospitals[0], service: "DIAGNOSTIC", validFrom: date(20), validUntil: date(30),
    bandMinMinor: 900_000, bandMaxMinor: 3_500_000, supersedes: "tariff-1-DIAGNOSTIC-1",
  }, ["tariff-1-DIAGNOSTIC-1"]));

  for (const [index, day] of [10, 13, 16, 21].entries()) {
    const target = day <= 18 ? first : next;
    const hospitalId = hospitals[index % hospitals.length];
    const service = services[index % services.length];
    const claimId = `synthetic-${seed}-${index + 1}`;
    const claimVersion = 1;
    const serviceDate = date(day);
    const billMinor = 1_050_000 + 1_000 * integer(1_800);
    const invoiceId = `${claimId}-his`;
    const invoiceOrigin = `${claimId}-invoice-origin`;
    target["S-A"].push(record(invoiceId, invoiceOrigin, beginning(day), {
      kind: "INVOICE", hospitalId, service, serviceDate, claimId, claimVersion, billMinor,
      intakeDate: serviceDate, dischargeDate: serviceDate, invoiceDate: serviceDate, diagnosisCode: "SYNTHETIC",
    }));
    target["S-C"].push(record(`${claimId}-receipt`, `${claimId}-receipt-copy`, beginning(day), {
      kind: "RECEIPT", hospitalId, serviceDate, claimId, claimVersion, billMinor, invoiceRecordId: invoiceId,
    }, [invoiceId]));
    target["S-D"].push(record(`${claimId}-payment`, `${claimId}-bank-origin`, beginning(day), {
      kind: "PAYMENT", claimId, claimVersion, paidMinor: index === 3 ? billMinor - 100_000 : billMinor,
      hospitalId, status: "OCCURRED", paymentDate: serviceDate,
    }));
  }

  const second = Object.fromEntries(issuerIds.map(id => [id, [...first[id], ...next[id]]]));
  return { seed, hospitals, services, versions: [{ coverage: coverage(18), records: first }, { coverage: coverage(24), records: second }] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { seed: { type: "string", default: "42" } } });
  if (!/^\d+$/.test(values.seed)) throw new Error("Seed must be an unsigned 32-bit integer");
  process.stdout.write(JSON.stringify(fixture(Number(values.seed)), null, 2) + "\n");
}
