# Permissioned Oracle consensus

Block-Insure uses one thesis-scale `OracleMSP` with two separately enrolled,
certificate-bound service identities: `oracle1` and `oracle2`. Each worker owns
its Fabric signing identity, registry loader, cursor, retry loop, and health
record. One certificate subject cannot fill both positions. This demonstrates
operational independence without claiming that the two services are separate
legal organizations; a production design could split them into two MSPs.

## Version-bound protocol

After the insurer cross-checks an invoice-bound claim against the contracted
Hospital's finalized invoice, an insurer administrator publishes an
`OracleRegistrySnapshot` commitment and creates an `OracleRequest`.
The request freezes the claim ID and version, insurer invoice cross-check, query hash,
registry root/version, rules hash/version, model hash/version, exactly two Oracle
certificate subjects, and commit/reveal deadlines.

Each assigned worker loads the exact snapshot named by the request. Tracked
synthetic fixtures remain available for controlled baseline/conflict experiments;
normal Hospital workflows generate immutable `registry-hospital-vN` snapshots
from finalized invoice-register records and publish their canonical roots on
Fabric. Workers fetch those hash-only snapshots by ID, resolve the Hospital
record, and compute a deterministic result containing the complete
verdict, verification code, canonical record hash, and every snapshotted version.
It first submits a salted commitment. Reveal begins after both commitments arrive
or the commit deadline passes. Chaincode recomputes both the result hash and the
commitment before accepting a reveal. It accepts only the documented result-code
set and requires `verified=true` exactly for `VERIFIED`; malformed combinations
cannot become internally inconsistent ledger evidence. A worker whose configured
model differs from the request produces the governed `MODEL_VERSION_MISMATCH`
negative result instead of blocking its event cursor.

Two identical canonical result hashes are required:

- matching valid results set the claim to `APPROVED`;
- matching invalid results finalize `NEGATIVE_RESULT`;
- different complete results finalize `CONFLICT`;
- an insurer administrator can finalize an incomplete request as `TIMEOUT` after
  the reveal deadline.

The last three outcomes set the claim to `ORACLE_FAILED`. An insurer can then use
`RouteOracleFailureToReview` to open the existing certificate-bound four-auditor
round. An Oracle never creates a settlement, and an insurer cannot submit Oracle
commitments or reveals. Settlement still requires insurer authorization followed
by BankMSP confirmation.

Appeal submission increments the claim version and clears the active Oracle
request reference. Any old commitment or result is therefore stale. A new appeal
request has a different query/result domain even if all visible claim fields are
otherwise identical.

## Demonstration registry data

`services/oracle-worker/registry/` contains deterministic local research fixtures:

- the Oracle 1 and Oracle 2 baseline files have different source IDs but the same
  canonical root;
- lookup `11…11` produces a matching valid result;
- lookup `22…22` produces a matching negative result;
- the Oracle 2 conflict fixture changes one record and therefore has a different
  registry root.

The supervised launcher selects these without source editing through
`-OracleScenario Baseline`, `Conflict`, or `Oracle2Unavailable`.

The dynamic snapshots are also synthetic demonstration data: their source is the
project's Fabric Hospital invoice register, not a live hospital, government, or
national-health integration. They contain reference/treatment hashes, Hospital
IDs, exact demo amounts, and service-date bounds—not patient names or clinical
documents. The root, rules, and model commitments make that provenance explicit.

## Operations and verification

Workers persist identity-bound cursors and secret-free health JSON under ignored
`data/oracle/`. The insurer/auditor health screen shows identities, sources,
snapshot/model versions, progress, counts, errors, and last latency. Claim dossier
schema 4 includes requests, commitments, revealed results, and registry provenance.
Unrevealed result material is never returned because commitments contain only a
salted hash. Counters and progress survive worker restarts, while the web health
reader verifies each live endpoint and labels a retained checkpoint offline when
its worker is no longer reachable.

The Go suite covers authorization, certificate-subject separation, duplicate and
late submissions, reveal matching, exact positive/negative consensus, conflict,
timeout, stale versions, appeal isolation, and auditor fallback. Worker tests
cover cross-language hashing, independent snapshots/configuration, phase ordering,
cursor restart behavior, bounded retry, and health persistence. The live browser
suite exercises both automatic approval-to-bank-settlement and negative-result
fallback through a 3-of-4 auditor approval.
