# Event-driven operations and research dashboard

Issue `#10` adds operational projections and descriptive thesis measurements
without moving shared business authority out of Hyperledger Fabric.

## Governed evidence sharing

An `EvidenceAccessGrant` is created and revoked by the policyholder who owns the
claim and evidence reference. A grant is bound to exactly one evidence item and
records the grantee MSP, certificate role, exact `subjectId` (or an explicit
organization-role wildcard), purpose, RFC 3339 expiry, and maximum retrieval
count. Chaincode validates these fields again when it records a grant-backed
access. Revocation is idempotent, access limits are atomically incremented, and
every retrieval retains the grant ID in its immutable access record.

The application continues to support workflow-derived access for a claim owner,
insurer administrator, eligible hospital process, or currently assigned auditor.
Auditor assignment is enforced by chaincode as well as the API. A grant never
reveals or transports an AES passphrase; it governs ciphertext retrieval only.

## Durable Fabric event projection

`POST /api/internal/events/sync` uses the InsurerMSP Gateway identity to request
chaincode events. It resumes from the last committed Fabric block and transaction
ID, writes a bounded local projection, and deduplicates events by block,
transaction, and event name. Replaying the same delivery therefore does not
duplicate counts or inbox items. The route accepts an insurer demo session or an
external scheduler bearer token in `EVENT_WORKER_SECRET`.

The ignored `data/events/projection.json` file is a local development adapter.
Its default location is discovered from the repository root, including when the
Next.js standalone runtime changes its working directory, so production rebuilds
do not erase the checkpoint. Set `EVENT_PROJECTION_ROOT` to select an explicit
deployment location. A synchronization request processes at most 5,000 events,
reports `limitReached` when another catch-up pass is required, and allows ten
seconds by default for historical replay and live delivery. The file contains no
private keys or evidence plaintext. Production should replace it
with a transactional database, single-writer/lease coordination, retention and
backup policy, delivery-lag monitoring, and a supervised continuously running
worker. Fabric is final within this network, so Ethereum confirmation/reorg
rollback logic from the reference project is intentionally not copied.

`npm run events:sync` is the supervised-worker entry point. It authenticates with
the same `EVENT_WORKER_SECRET` configured on the web process, drains consecutive
full batches immediately, polls after reaching the live tip, backs off boundedly
after transient failures, and logs structured JSON without credentials. Use
`--once` for a deployment or demonstration catch-up. The API compares worker
credentials through fixed-length digests, rejects malformed authorization
schemes, and coalesces concurrent in-process synchronization requests so multiple
triggers cannot open redundant Gateway event streams.

The operational APIs are:

- `/api/operations/notifications` — current role/subject inbox derived from
  committed events;
- `/api/operations/events` — insurer/auditor event inspection with event, asset,
  block, and limit filters;
- `/api/internal/events/sync` — idempotent projection catch-up.

## Research snapshot

`/research` renders portfolio, adjudication, appeal, fraud-triage, evidence,
event, settlement, premium, benefit, and liability measurements obtained from
the current ledger. `/api/research/snapshot` returns the same structured artifact.
It includes channel, chaincode, ledger schema, event checkpoint, interpretation
limits, cumulative indexed-event count, bounded retained-event count, and a
canonical SHA-256 reproducibility hash. Export time is excluded
from that hash, so the same measured state produces the same identifier.

The dashboard is deliberately descriptive. Fraud assessment is advisory;
development-network latency is not a production benchmark; demonstration and
test records remain observations; and no metric is presented as clinical,
causal, or real-world fraud validation.

## Verification

Go tests cover grant ownership, invalid grantees, use limits, revocation, and
auditor assignment. TypeScript tests cover event replay deduplication, targeted
notifications, stable standalone checkpoint discovery, grant-state aggregation,
and reproducible hashing. The live CLI
workflow creates, uses, and revokes a grant. Playwright validates grant-backed
ciphertext delivery, dossier provenance, event synchronization, role inboxes,
research authorization, the dedicated dashboard, and WCAG 2.1 AA checks.
The consolidated verifier covers worker authentication as part of the live
browser suite in addition to the Go suite and live network check.
