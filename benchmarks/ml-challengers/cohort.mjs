import { createHash } from "node:crypto";
import { inferContext } from "../../services/oracle-worker/src/xgboost.mjs";

export const protocol = Object.freeze({
  version: "fabric-challengers-synthetic-v1",
  reviewCapacity: 0.20,
  seed: 11926,
  bootstrapDraws: 1000,
  splits: { train: 12, calibration: 8, primary: 10, sealed: 14 },
  casesPerProvider: 24,
  peerMinimum: 8,
  scoreScale: 1_000_000_000,
});
export const commonFeatures = [
  "relativeCharge", "stayDays", "history_similar", "history_patient14", "history_provider30",
  "graph_edge_repeat_share", "temporal_provider7", "history_available",
];
export const rankFeatures = [...commonFeatures, "peerExcess", "overlap14"];

const services = ["SURGERY", "DIAGNOSTIC", "CONSULTATION"];
const trainFamilies = ["high-in-range", "short-overlap", "repeated-itemization"];
const sealedFamilies = ["distributed-overlap", "sparse-peer-drift"];
const controlFamilies = ["routine", "benign-repeat", "ordinary-follow-up"];
const dayMs = 86_400_000;
const origin = Date.parse("2026-09-01");
const date = (day) => new Date(origin + day * dayMs).toISOString().slice(0, 10);
const sha = (id) => createHash("sha256").update(id).digest("hex");

export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function makeRecord({ id, provider, patient, service, day, span, value }) {
  return {
    invoiceId: id, invoiceHash: sha(id), hospitalId: provider, hospitalMsp: "HospitalMSP",
    patientReferenceHash: sha(patient), patientIssuerMsp: "InsurerMSP",
    treatmentType: service, diagnosisCode: "SYNTHETIC-FOLLOWUP",
    amountMinor: Math.round(value), expectedMinMinor: 22000, expectedMaxMinor: 85000,
    admissionDate: date(day - span), dischargeDate: date(day), invoiceDate: date(day),
    invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE",
  };
}

export function generateCohort(split) {
  const index = Object.keys(protocol.splits).indexOf(split);
  if (index < 0) throw new Error("Unknown synthetic split");
  const rnd = random(protocol.seed + 101 * index);
  const records = [], cases = [];
  for (let p = 0; p < protocol.splits[split]; p++) {
    const provider = `${split}-facility-${p}`;
    const service = services[p % services.length];
    const profile = 40000 + rnd() * 17000;
    for (let j = 0; j < 12; j++) {
      records.push(makeRecord({ id: `${provider}-reference-${j}`, provider, patient: `${provider}-reference-${j}`,
        service: j === 0 && p < 3 ? "OTHER" : service, day: -57 + j, span: 1, value: profile + (rnd() - 0.5) * 18000 }));
    }
    const order = Array.from({ length: protocol.casesPerProvider }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const actions = new Map(order.slice(0, 4).map((index, i) => [index, i]));
    for (let n = 0; n < protocol.casesPerProvider; n++) {
      const id = `${provider}-case-${n}`, patient = `${id}-patient`;
      const label = Number(actions.has(n));
      const positiveFamilies = split === "sealed" ? sealedFamilies : trainFamilies;
      const family = label ? positiveFamilies[(actions.get(n) + p) % positiveFamilies.length] : controlFamilies[(n + p) % controlFamilies.length];
      const treatment = family === "sparse-peer-drift" || n % 11 === 0 ? "OTHER" : service;
      const day = 2 * (n % 12);
      const noisyCharge = profile + (rnd() - 0.5) * 24000;
      const lift = { "high-in-range": 14000, "short-overlap": 2000, "repeated-itemization": 5500,
        "distributed-overlap": 5000, "sparse-peer-drift": 13000, "ordinary-follow-up": 4500 }[family] ?? 0;
      const span = 1 + Math.floor(rnd() * 4) + Number(family === "short-overlap" || family === "distributed-overlap");
      const charge = (n + p) % 17 === 0 ? 102500 : noisyCharge + lift;
      const target = makeRecord({ id, provider, patient, service: treatment, day, span, value: charge });
      records.push(target);
      cases.push({ id, provider, patient, label, family, record: target });
      const visits = { routine: 0, "benign-repeat": 3, "ordinary-follow-up": 1, "high-in-range": 1,
        "short-overlap": 3, "repeated-itemization": 4, "distributed-overlap": 3, "sparse-peer-drift": 2 }[family];
      for (let j = 0; j < visits; j++) {
        const near = family === "short-overlap" || family === "distributed-overlap" || (family === "benign-repeat" && p % 3 === 0);
        const lag = near ? 1 + j : 4 + 2 * j;
        records.push(makeRecord({ id: `${id}-prior-${j}`, provider, patient, service: treatment,
          day: day - lag, span: 1 + (j % 2), value: noisyCharge + (rnd() - 0.5) * 13000 }));
      }
    }
  }
  return { records, cases };
}

const percentile90 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.9) - 1];

export function fitPeers(trainingRecords) {
  const archive = trainingRecords.filter((row) => row.invoiceDate < date(-30));
  const amounts = (service) => archive.filter((row) => !service || row.treatmentType === service).map((row) => row.amountMinor);
  const cuts = {};
  for (const service of [...services, "OTHER"]) {
    const subset = amounts(service);
    if (subset.length >= protocol.peerMinimum) cuts[service] = percentile90(subset);
  }
  return { cuts, pooled: percentile90(amounts()), cutoff: date(-30), referenceCount: archive.length };
}

export function peerHistoryFeatures(record, records, cutoff, peers) {
  const start = new Date(Date.parse(cutoff) - 14 * dayMs).toISOString().slice(0, 10);
  const bound = peers.cuts[record.treatmentType] ?? peers.pooled;
  if (!Number.isFinite(bound) || bound <= 0) throw new Error("Peer reference archive is missing");
  const count = records.filter((prior) => prior.invoiceDate >= start && prior.invoiceDate < cutoff
    && prior.patientIssuerMsp === record.patientIssuerMsp && prior.patientReferenceHash === record.patientReferenceHash
    && prior.treatmentType === record.treatmentType && prior.dischargeDate >= record.admissionDate).length;
  return { peerExcess: Math.max(0, record.amountMinor / bound - 1), overlap14: Math.log1p(count) };
}

export function scoreCohort({ records, cases }, peers) {
  return cases.map(({ record, id, provider, patient, label, family }) => {
    const available = records.filter((row) => row.invoiceDate <= record.invoiceDate);
    const { assessment, prepared } = inferContext({
      records: available, snapshotTimestamp: record.invoiceDate + "T18:00:00.000Z",
      claim: { hospitalInvoiceId: id, hospitalId: provider, hospitalMsp: "HospitalMSP", claimantId: patient,
        claimantMsp: "InsurerMSP", createdAt: record.invoiceDate + "T18:00:00.000Z",
        invoiceHash: record.invoiceHash, amountMinor: record.amountMinor, incidentDate: record.dischargeDate, treatmentType: record.treatmentType },
    });
    const features = challengerFeatures(record, available, prepared, peers);
    return { id, provider, patient, label, family, features, mandatory: prepared.observation.mandatory,
      pooledPeer: peers.cuts[record.treatmentType] === undefined, frozen: assessment.riskScoreUnits,
      frozenRouted: assessment.recommendation === "REVIEW_RECOMMENDED" };
  });
}

export function challengerFeatures(record, records, prepared, peers) {
  const observed = { ...prepared.observation.features, relativeCharge: record.amountMinor / record.expectedMaxMinor,
    stayDays: (Date.parse(record.dischargeDate) - Date.parse(record.admissionDate)) / dayMs,
    ...peerHistoryFeatures(record, records, prepared.cutoff.slice(0, 10), peers) };
  return Object.fromEntries(rankFeatures.map((name) => [name, observed[name]]));
}
