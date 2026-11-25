import { buildResultDigest } from "../../services/oracle-worker/src/protocol.mjs";
import { createHash } from "node:crypto";
import { evaluateThreshold } from "../../services/oracle-worker/src/threshold-model.mjs";
import { digest } from "../../services/oracle-worker/src/v2/canonical.mjs";
import { commitmentHash } from "../../services/oracle-worker/src/v2/commitment-v2.mjs";
import { decide, diagnosticPolicy } from "../../services/oracle-worker/src/v2/decision.mjs";
import { createFactVector, factVectorHash, tariffBandFor } from "../../services/oracle-worker/src/v2/fact-vector.mjs";
import { evaluateV2 } from "../../services/oracle-worker/src/v2/evaluator-v2.mjs";
import { authorizedFor, independentEvidence, verifyFeed, verifyFeedMembership } from "../../services/oracle-worker/src/v2/sources.mjs";
import { createFeed, recordProof, signRecord } from "../../services/integrations/source-adapters/feed.mjs";
import { fixtureKeys, makeCase, phase3Scenarios, scenarios } from "./fixtures.mjs";

export const configurations = Object.freeze([
  { id: "v1-shared", label: "v1 shared Insurer snapshot", sources: 0, dependencyCheck: false, overhead: 0 },
  { id: "v2-single-origin", label: "v2 signed single-origin", sources: 1, dependencyCheck: false, overhead: 1 },
  { id: "v2-multi-source", label: "v2 signed multi-source", sources: 4, dependencyCheck: false, overhead: 2 },
  { id: "v2-provenance-aware", label: "v2 provenance-aware", sources: 4, dependencyCheck: true, overhead: 3 },
]);

const workerIds = ["oracle1", "oracle2", "oracle3"];
const COMMIT_DEADLINE_SECONDS = 60;
const REVEAL_DEADLINE_SECONDS = 120;
const PANEL_REVIEW_SECONDS = 30;
const REQUESTED_AT = "2026-11-25T00:02:00.000Z";
const INVOICE_FACT = "invoiceIssued";
const ACCREDITATION_FACT = "serviceAccredited";
const singleOrigin = {
  version: "diagnostic-single-source-benchmark",
  requiredFacts: [INVOICE_FACT],
  allowAbsentReceipt: true,
};
const paymentPolicy = {
  ...diagnosticPolicy,
  version: "diagnostic-payment-benchmark",
  requiredFacts: [...diagnosticPolicy.requiredFacts, "paymentOccurred"],
};

function signedEvidence(sample, issuers) {
  const allRecords = new Map();
  const checkpoints = [];
  for (const [issuerId, issuer] of issuers) {
    const records = sample.records.filter(record => record.issuerId === issuerId)
      .map(record => signRecord(record, issuer.privateKey));
    if (!records.length) continue;
    const feed = createFeed({
      issuerId, keyVersion: issuer.keyVersion, feedVersion: 2, records,
      issuedAt: "2026-11-25T00:00:00.000Z", from: "2026-11-24T00:00:00.000Z", through: "2026-11-24T23:59:59.000Z",
    }, issuer.privateKey);
    const checkpoint = { issuerId, keyVersion: feed.keyVersion, feedVersion: feed.feedVersion, root: feed.merkleRoot,
      effectiveAt: feed.issuedAt, anchoredAt: "2026-11-25T00:01:00.000Z" };
    if (!verifyFeed(feed, checkpoint, issuer, REQUESTED_AT)) throw new Error("Invalid synthetic feed signature or checkpoint");
    feed.records.forEach((record, index) => {
      const offeredHospitalCopy = sample.scenario === "hospital-payment-copy" && issuer.issuerId === "s-a" && record.payload.fact === "paymentOccurred";
      if ((!offeredHospitalCopy && !authorizedFor(issuer, record.payload.fact)) || !verifyFeedMembership(record, recordProof(feed.records, index), checkpoint.root)) {
        throw new Error("Invalid synthetic source record");
      }
      allRecords.set(record.recordId, record);
    });
    checkpoints.push(checkpoint);
  }
  return { allRecords, checkpoints, issuers };
}

const evidence = (status, row, integrity) => ({ status, evidence: row ? [row.recordId] : [], ...(integrity && { integrity }) });

function assessV2(sample, mode, signed, observation) {
  const { allRecords, checkpoints, issuers } = signed;
  const byFact = new Map(Array.from(allRecords.values(), record => [record.payload.fact, record]));
  const invoice = byFact.get(INVOICE_FACT);
  const invoiceMatches = invoice.payload.amountMinor === sample.billMinor;
  const facts = { [INVOICE_FACT]: evidence(invoiceMatches ? "PASS" : "CONTRADICTED", invoice) };
  let evidenceReason = invoiceMatches ? "PASS" : "INVOICE_MISMATCH";
  let tariffBand = "IN";
  let receiptCheck = "ABSENT";
  const multiSource = mode.sources > 1;
  const policy = multiSource ? (sample.verifyPayment ? paymentPolicy : diagnosticPolicy) : singleOrigin;
  if (!multiSource) facts.receiptConsistent = evidence("INSUFFICIENT");
  if (multiSource) {
    const licence = byFact.get("licenceActiveOnServiceDate");
    const accreditation = byFact.get(ACCREDITATION_FACT);
    const tariff = byFact.get("tariffBand");
    const receipt = byFact.get("receiptConsistent");
    const dependentAccreditation = mode.dependencyCheck && !independentEvidence(invoice, accreditation,
      { records: allRecords, issuers }, INVOICE_FACT, ACCREDITATION_FACT);
    const independent = (row) => !mode.dependencyCheck || independentEvidence(invoice, row, { records: allRecords, issuers });
    const licenceActive = licence.payload.status === "ACTIVE";
    const serviceAccredited = accreditation.payload.status === "ACCREDITED";
    tariffBand = tariffBandFor(sample.billMinor, tariff.payload.minimumMinor, tariff.payload.maximumMinor);
    const tariffPass = tariffBand === "IN" || tariffBand === "BELOW";
    receiptCheck = receipt.payload.amountMinor === invoice.payload.amountMinor ? "MATCH" : "MISMATCH";
    facts.licenceActiveOnServiceDate = licenceActive ? evidence(independent(licence) ? "PASS" : "INSUFFICIENT", licence)
      : evidence("CONTRADICTED", licence, "INACTIVE_LICENCE");
    facts.serviceAccredited = serviceAccredited
      ? evidence(dependentAccreditation ? "INSUFFICIENT" : "PASS", accreditation)
      : evidence("CONTRADICTED", accreditation, "UNACCREDITED_SERVICE");
    facts.tariffBand = evidence(tariffPass ? (independent(tariff) ? "PASS" : "INSUFFICIENT") : "CONTRADICTED", tariff);
    facts.receiptConsistent = evidence(receiptCheck === "MATCH" ? "PASS" : "CONTRADICTED", receipt);
    if (sample.verifyPayment) {
      const copy = allRecords.get(sample.claimId + ".hospital-payment-confirmation");
      const payment = copy
        ? (mode.dependencyCheck ? [...allRecords.values()].find(record => record.payload.fact === "paymentOccurred" &&
            authorizedFor(issuers.get(record.issuerId), record.payload.fact)) ?? copy : copy)
        : byFact.get("paymentOccurred");
      const paid = payment.payload.amountMinor === invoice.payload.amountMinor;
      facts.paymentOccurred = evidence(paid ? (independent(payment) ? "PASS" : "INSUFFICIENT") : "CONTRADICTED", payment);
      if (!paid) evidenceReason = "PAYMENT_CONTRADICTION";
      else if (copy === payment && mode.dependencyCheck) evidenceReason = "DEPENDENT_HOSPITAL_PAYMENT_COPY";
    }
    if (!tariffPass) evidenceReason = "OUTSIDE_REGULATOR_TARIFF";
    if (receiptCheck === "MISMATCH") evidenceReason = "RECEIPT_MISMATCH";
    if (dependentAccreditation) evidenceReason = "DEPENDENT_ACCREDITATION";
    if (!serviceAccredited) evidenceReason = "UNACCREDITED_SERVICE";
    if (!licenceActive) evidenceReason = "INACTIVE_LICENCE";
    if (observation === "STALE") {
      facts.serviceAccredited = evidence("UNVERIFIABLE");
      evidenceReason = "PINNED_CHECKPOINT_UNAVAILABLE";
    }
  } else if (observation === "STALE") {
    facts.invoiceIssued = evidence("UNVERIFIABLE");
    evidenceReason = "PINNED_CHECKPOINT_UNAVAILABLE";
  }
  if (observation === "PROOF_UNAVAILABLE") {
    facts.invoiceIssued = evidence("UNVERIFIABLE", invoice);
    evidenceReason = "INVOICE_PROOF_UNAVAILABLE";
  }
  const vector = createFactVector({
    claimId: sample.claimId, claimVersion: sample.claimVersion, policyVersion: policy.version,
    manifestHash: digest("oracle-v2-benchmark:pinned-manifest", multiSource ? checkpoints : checkpoints.slice(0, 1)),
    facts, tariffBand, receiptCheck, modelAdvice: sample.modelAdvice,
  });
  const route = decide(vector, policy);
  return { route, hash: factVectorHash(vector), evidenceReason };
}

function assessV1(sample, observation) {
  // All v1 workers trust the same synthetic snapshot, except the deliberately
  // stale reader. The snapshot marks these fixtures eligible independently of
  // the ground-truth label, which is used only when counting results.
  const verified = observation === "CURRENT";
  const route = verified ? "AUTO_APPROVE" : "PANEL_REVIEW";
  const hash = buildResultDigest({
    id: sample.claimId + ":request", claimId: sample.claimId,
    claimVersion: sample.claimVersion, queryHash: digest("oracle-v2-benchmark:legacy-query", sample.claimId),
    hospitalVerificationId: sample.claimId + ":verification",
    registrySnapshotId: "shared-insurer-snapshot", registryVersion: verified ? 2 : 1,
    registryRootHash: digest("oracle-v2-benchmark:legacy-root", ["insurer", verified ? 2 : 1]),
    rulesVersion: "offline-fixture-rules", rulesHash: digest("oracle-v2-benchmark:legacy-rules", "offline"),
    modelVersion: "offline-fixture-advice", modelHash: digest("oracle-v2-benchmark:legacy-model", "fixed"),
  }, {
    verified, verificationCode: verified ? "VERIFIED" : observation === "STALE" ? "STALE_REGISTRY" : "SNAPSHOT_READ_INCOMPLETE",
    recordHash: digest("oracle-v2-benchmark:legacy-record", [sample.claimId, sample.billMinor]),
  });
  return { route, hash, evidenceReason: verified ? "SHARED_SNAPSHOT_POSITIVE" : observation };
}

function evaluateReplicaGate(sample, mode, evidenceSet) {
  const copied = sample.scenario === "copied-commitment";
  const offline = sample.scenario === "one-worker-offline";
  const stale = sample.scenario === "stale-mirror";
  const v1 = mode.sources === 0;
  // An analytically supplied duplicate offer is counted at the legacy commit
  // gate, without contributing a third reveal. V2 excludes that offer.
  const acceptedCommitments = workerIds.length - Number(offline) - Number(copied && !v1);
  const jitter = parseInt(sample.entropy.slice(8, 12), 16) % 5;
  const revealStart = acceptedCommitments === workerIds.length ? 4 + mode.overhead : COMMIT_DEADLINE_SECONDS;
  const strategies = new Map();
  const reveals = workerIds.map((oracleSubject, index) => {
    if (index === 2 && (offline || copied)) return null;
    const observation = index === 1 && stale ? "STALE" :
      index === 2 && sample.variant === "STALE_AND_THIRD_DISTINCT_RESULT" ? "PROOF_UNAVAILABLE" : "CURRENT";
    const result = v1 ? assessV1(sample, observation) : assessV2(sample, mode, evidenceSet, observation);
    if (!v1) {
      const commitment = commitmentHash({
        channelId: "synthetic-offline", requestId: sample.claimId + ":request", claimVersion: sample.claimVersion, oracleSubject,
        factVectorHash: result.hash, decision: result.route,
        salt: digest("oracle-v2-benchmark:synthetic-salt", [sample.claimId, oracleSubject]),
      });
      strategies.set(oracleSubject, commitment);
    }
    return index === 2 && sample.variant === "STALE_AND_LATE_REVEAL" ? null : result;
  });
  if (!v1 && new Set(strategies.values()).size !== acceptedCommitments) throw new Error("Distinct synthetic commitments required");
  const responseHashes = [];
  let routingSeconds = REVEAL_DEADLINE_SECONDS;
  let quorum;
  for (const [index, result] of reveals.entries()) {
    if (!result) continue;
    responseHashes.push(result.hash + ":" + result.route);
    quorum = evaluateThreshold({ responses: responseHashes, expectedResponses: 3, requiredConfirmations: 2 });
    if (quorum.status === "CONSENSUS" || quorum.status === "CONFLICT") {
      routingSeconds = revealStart + index + 1 + jitter;
      break;
    }
  }
  quorum ??= evaluateThreshold({ responses: [], expectedResponses: 3, requiredConfirmations: 2 });
  if (quorum.status === "PENDING") {
    quorum = evaluateThreshold({ responses: responseHashes, expectedResponses: 3, requiredConfirmations: 2, deadlineExpired: true });
  }
  const winning = reveals.find(result => result && result.hash + ":" + result.route === quorum.resultHash);
  const availableAgreeingWorkers = winning ? reveals.filter(result => result?.hash === winning.hash && result.route === winning.route).length : 0;
  return {
    route: winning?.route ?? "PANEL_REVIEW", quorum: quorum.status, matchingWorkers: quorum.matchingResponses,
    agreementHash: winning?.hash ?? "", availableAgreeingWorkers,
    evidenceReason: winning?.evidenceReason ?? quorum.status, acceptedCommitments, routingSeconds,
  };
}

function frozenAdvice(sample) {
  const claimantId = sample.claimId + "-member";
  const patientReferenceHash = createHash("sha256").update(claimantId).digest("hex");
  const invoiceHash = digest("oracle-v2-benchmark:frozen-observation", [sample.claimId, sample.billMinor]);
  const hospitalId = "synthetic-hospital";
  const amountMinor = sample.records.find(record => record.payload.fact === INVOICE_FACT).payload.amountMinor;
  const current = {
    invoiceId: sample.claimId + "-invoice", invoiceHash, hospitalId, hospitalMsp: "HospitalMSP",
    patientIssuerMsp: "InsurerMSP", patientReferenceHash, associationStatus: "VERIFIED",
    treatmentType: "DIAGNOSTIC", diagnosisCode: "Z01", amountMinor, expectedMinMinor: 215000, expectedMaxMinor: 500000,
    admissionDate: "2026-11-23", dischargeDate: "2026-11-24", invoiceDate: "2026-11-24",
    licenseStatus: "ACTIVE", recordStatus: "VALID", invoiceStatus: "VALID",
  };
  return evaluateV2({ records: [current], claim: { claimantId, claimantMsp: "InsurerMSP", hospitalId,
    hospitalMsp: "HospitalMSP", hospitalInvoiceId: current.invoiceId, invoiceHash, amountMinor: sample.billMinor,
    descriptionHash: invoiceHash, incidentDate: "2026-11-24", createdAt: REQUESTED_AT, treatmentType: "DIAGNOSTIC" },
  snapshotTimestamp: REQUESTED_AT }).modelAdvice;
}

export function simulate({ seed = 42, perScenario = 24, panelBudgetPercent = 50, extended = false, advice = "fixed-auto" } = {}) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(perScenario) || perScenario < 1 ||
      !Number.isSafeInteger(panelBudgetPercent) || panelBudgetPercent < 0 || panelBudgetPercent > 100 || !["fixed-auto", "frozen"].includes(advice)) {
    throw new TypeError("Seed, sample size and panel budget must be valid integers");
  }
  const keys = fixtureKeys(seed);
  const cases = (extended ? phase3Scenarios : scenarios).flatMap(scenario => Array.from({ length: perScenario }, (_, index) => {
    const sample = makeCase(scenario, index, seed);
    sample.modelAdvice = advice === "frozen" ? frozenAdvice(sample) : "AUTO";
    return { sample, signed: signedEvidence(sample, keys) };
  }));
  const panelCapacity = Math.floor(cases.length * panelBudgetPercent / 100);
  const rows = [];
  for (const mode of configurations) {
    const modeRows = cases.map(({ sample, signed }) => {
      const { claimId, scenario, variant, eligible, billMinor, groundTruthInvoiceMinor } = sample;
      const judged = evaluateReplicaGate(sample, mode, signed);
      return {
        mode: mode.id, claimId, scenario, variant, eligible, billMinor, groundTruthInvoiceMinor, modelAdvice: sample.modelAdvice, ...judged,
        panelStatus: judged.route === "AUTO_APPROVE" ? "NOT_NEEDED" : "WAITLISTED",
        decisionSeconds: judged.route === "AUTO_APPROVE" ? judged.routingSeconds : null,
      };
    });
    const waiting = modeRows.filter(row => row.panelStatus === "WAITLISTED")
      .sort((first, second) => first.routingSeconds - second.routingSeconds || first.claimId.localeCompare(second.claimId, "en"));
    for (const row of waiting.slice(0, panelCapacity)) {
      row.panelStatus = "REVIEWED";
      row.decisionSeconds = row.routingSeconds + PANEL_REVIEW_SECONDS;
    }
    rows.push(...modeRows);
  }
  return { seed, perScenario, panelBudgetPercent, panelCapacity, rows };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

export function summarize(experiment, scope) {
  return configurations.map(({ id: mode, label }) => {
    const rows = experiment.rows.filter(row => row.mode === mode && (!scope || row.scenario === scope));
    const matches = predicate => rows.filter(predicate).length;
    const decisionTimes = rows.flatMap(row => row.decisionSeconds === null ? [] : [row.decisionSeconds]);
    return {
      mode, label, total: rows.length, eligible: matches(row => row.eligible), ineligible: matches(row => !row.eligible),
      automaticApprovals: matches(row => row.route === "AUTO_APPROVE"),
      wrongAutomaticApprovals: matches(row => !row.eligible && row.route === "AUTO_APPROVE"),
      legitimateReferrals: matches(row => row.eligible && row.route !== "AUTO_APPROVE"),
      conflict: matches(row => row.quorum === "CONFLICT"), timeout: matches(row => row.quorum === "TIMEOUT"),
      panelDemand: matches(row => row.route !== "AUTO_APPROVE"), panelReviewed: matches(row => row.panelStatus === "REVIEWED"),
      panelCapacity: experiment.panelCapacity, unresolved: matches(row => row.panelStatus === "WAITLISTED"),
      routingP50: percentile(rows.map(row => row.routingSeconds), 0.50), routingP95: percentile(rows.map(row => row.routingSeconds), 0.95),
      decisionP50: percentile(decisionTimes, 0.50), decisionP95: percentile(decisionTimes, 0.95),
    };
  });
}
