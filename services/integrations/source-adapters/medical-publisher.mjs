import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { digest } from "../../oracle-worker/src/v2/canonical.mjs";
import { createFeed, signRecord } from "./feed.mjs";

const hospitalId = "hospital-2";
const claimIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const maxFeedRecords = 10_000;
const sourceError = code => Object.assign(new Error(code), { sourceCode: code });
const publicationKey = (claimId, version) => createHash("sha256").update(claimId + ":" + version).digest("hex");
const effectiveAtDate = date => new Date(date + "T00:00:00+06:00").toISOString();

export function hospitalInvoiceRecordId(claimId, version) {
  return "his-" + publicationKey(claimId, version);
}

function invoiceRecord(source, existing) {
  const { claimId, claimVersion, service, serviceDate, invoiceDate, admissionDate, dischargeDate,
    diagnosisCode, billMinor, invoiceHash, invoiceNumber } = source;
  const recordId = hospitalInvoiceRecordId(claimId, claimVersion);
  if (existing && existing.recordId !== recordId) throw sourceError("HISTORICAL_SOURCE_REQUIRES_MANUAL_PROCESSING");
  return { recordId, originId: recordId, derivedFrom: [], effectiveAt: effectiveAtDate(invoiceDate),
    payload: { kind: "INVOICE", hospitalId, claimId, claimVersion, service, serviceDate, invoiceDate, admissionDate,
      dischargeDate, diagnosisCode, billMinor, invoiceHash, invoiceNumber } };
}

function receiptRecord({ claimId, claimVersion, receipt }, invoice) {
  if (!receipt) return null;
  if (receipt.derivedFrom !== invoice.recordId || receipt.hospitalId !== hospitalId) {
    throw sourceError("RECEIPT_SOURCE_LINK_INVALID");
  }
  const recordId = "receipt-" + publicationKey(claimId, claimVersion);
  return { recordId, originId: recordId, derivedFrom: [invoice.recordId],
    effectiveAt: effectiveAtDate(receipt.serviceDate),
    payload: { kind: "RECEIPT", hospitalId, claimId, claimVersion, serviceDate: receipt.serviceDate, billMinor: receipt.amountMinor,
      invoiceRecordId: invoice.recordId, invoiceNumber: receipt.invoiceNumber } };
}

function feedMatchesAnchor(feed, anchor) {
  return anchor?.issuerId === feed.issuerId && anchor.feedVersion === feed.feedVersion &&
    anchor.keyVersion === feed.keyVersion && anchor.root === feed.merkleRoot &&
    anchor.effectiveAt === feed.issuedAt && anchor.signature === feed.anchorSignature;
}

async function reconcileFeed(actor, feed) {
  const anchors = await actor.listAnchors();
  const matching = anchors.find(anchor => anchor.issuerId === feed.issuerId && anchor.feedVersion === feed.feedVersion);
  if (!matching &&
      !anchors.some(anchor => anchor.issuerId === feed.issuerId && anchor.feedVersion > feed.feedVersion)) {
    const anchored = await actor.anchor(feed);
    if (feedMatchesAnchor(feed, anchored)) return anchored;
  } else if (feedMatchesAnchor(feed, matching) &&
      !anchors.some(anchor => anchor.issuerId === feed.issuerId && anchor.feedVersion > feed.feedVersion)) {
    return matching;
  }
  throw sourceError("FEED_ANCHOR_MISMATCH");
}

export function createMedicalPublisher({ store, keys, hospital, insurer, now = () => new Date() }) {
  let queue = Promise.resolve();

  async function readRegulatorAnchor() {
    const anchors = await insurer.listAnchors();
    const anchor = anchors.filter(item => item.issuerId === "S-B").sort((left, right) => right.feedVersion - left.feedVersion)[0];
    if (!anchor) throw sourceError("RETAINED_FEEDS_UNAVAILABLE");
    const feed = await store.read("S-B", anchor.feedVersion);
    if (!feed || !feedMatchesAnchor(feed, anchor)) throw sourceError("FEED_ANCHOR_MISMATCH");
    return anchor;
  }

  async function publishRecord(actor, previous, record) {
    const anchor = await reconcileFeed(actor, previous);
    if (!record) return anchor;
    const signed = signRecord({ issuerId: previous.issuerId, keyVersion: previous.keyVersion, ...record }, keys[previous.issuerId].privateKey);
    const existing = previous.records.find(row => row.recordId === record.recordId);
    if (existing) {
      if (signed.signature !== existing.signature) throw sourceError("SIGNED_RECORD_MISMATCH");
      return anchor;
    }
    if (previous.records.length >= maxFeedRecords) throw sourceError("FEED_CAPACITY_EXHAUSTED");

    const issuedAt = now().toISOString();
    const from = previous.coverage.from < record.effectiveAt ? previous.coverage.from : record.effectiveAt;
    const through = previous.coverage.through > record.effectiveAt ? previous.coverage.through : record.effectiveAt;
    if (issuedAt <= previous.issuedAt || through > issuedAt) throw sourceError("FEED_CLOCK_NOT_READY");
    const feed = createFeed({ issuerId: previous.issuerId, keyVersion: previous.keyVersion, feedVersion: previous.feedVersion + 1,
      records: [...previous.records, signed], from, through, issuedAt }, keys[previous.issuerId].privateKey);
    await store.append(feed);
    return reconcileFeed(actor, feed);
  }

  async function publish({ claimId, claimVersion }) {
    if (!claimIdPattern.test(claimId) || !Number.isSafeInteger(claimVersion) || claimVersion < 1) throw sourceError("INVALID_CLAIM");
    const [source, statement, his, regulatorAnchor, receipts] = await Promise.all([
      hospital.readInvoice(claimId, claimVersion), insurer.readReceipt(claimId, claimVersion),
      store.latest("S-A"), readRegulatorAnchor(), store.latest("S-C"),
    ]);
    if (source.hospitalId !== hospitalId || source.service !== "DIAGNOSTIC") throw sourceError("UNSUPPORTED_HOSPITAL_OR_SERVICE");
    if (source.claimId !== claimId || source.claimVersion !== claimVersion || statement.claimId !== claimId || statement.claimVersion !== claimVersion) {
      throw sourceError("CLAIM_VERSION_CHANGED");
    }
    if (!his || !receipts) throw sourceError("RETAINED_FEEDS_UNAVAILABLE");
    const historical = his.records.find(row => row.payload.claimId === claimId && row.payload.claimVersion === claimVersion);
    const invoice = invoiceRecord(source, historical);
    const receipt = receiptRecord(statement, invoice);
    const hospitalAnchor = await publishRecord(hospital, his, invoice);
    const receiptAnchor = await publishRecord(insurer, receipts, receipt);
    return { claimVersion, pins: [hospitalAnchor, regulatorAnchor, receiptAnchor].map(({ issuerId, feedVersion, root }) => ({ issuerId, feedVersion, root })) };
  }

  return input => {
    const attempt = queue.then(() => publish(input));
    queue = attempt.catch(() => {});
    return attempt;
  };
}

export function createDevLiteMedicalPublisher({ store, keys, withDevLitePeer, log = console.info }) {
  const json = value => JSON.parse(Buffer.from(value).toString("utf8"));
  const validateMemory = () => {
    if (freemem() < 700 * 1024 * 1024) throw sourceError("PUBLISHER_MEMORY_FLOOR");
  };
  const actor = (org, readName) => {
    const run = action => withDevLitePeer(org, action, org === "hospital" ? "hospital2" : undefined);
    const mspId = org === "hospital" ? "HospitalMSP" : "InsurerMSP";
    const read = async (name, ...args) => run(async ({ contract }) => {
      const proposal = contract.newProposal(name, { arguments: args.map(String), endorsingOrganizations: [mspId] });
      return json(await proposal.evaluate());
    });
    return {
      readInvoice: (claimId, claimVersion) => read(readName, claimId, claimVersion),
      readReceipt: (claimId, claimVersion) => read(readName, claimId, claimVersion),
      listAnchors: () => read("ListSourceFeeds"),
      async anchor(feed) {
        return run(async ({ contract }) => {
          validateMemory();
          const { signature: _signature, ...coverage } = feed.coverage;
          const method = "AnchorSourceFeed";
          const arguments_ = [feed.issuerId, feed.keyVersion, feed.feedVersion, feed.merkleRoot, feed.issuedAt,
            digest("oracle-v2:coverage", coverage), feed.anchorSignature].map(String);
          const started = performance.now();
          const proposal = contract.newProposal(method, { arguments: arguments_ });
          const transaction = await proposal.endorse();
          validateMemory();
          const submitted = await transaction.submit();
          const status = await submitted.getStatus();
          log(JSON.stringify({ at: new Date().toISOString(), method, issuerId: feed.issuerId, actor: org,
            transactionId: submitted.getTransactionId(), blockNumber: String(status.blockNumber), code: status.code,
            elapsedMs: Math.round(performance.now() - started) }));
          if (!status.successful) throw sourceError("FEED_ANCHOR_INVALID");
          return json(submitted.getResult());
        });
      },
    };
  };
  return createMedicalPublisher({ store, keys,
    hospital: actor("hospital", "ReadHospitalClaimSource"), insurer: actor("insurer", "ReadMedicalClaimReceiptSource") });
}
