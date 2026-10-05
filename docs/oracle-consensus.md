# Provenance-bound threshold Oracle consensus

Block-Insure uses one thesis-scale `OracleMSP` with three separately enrolled,
certificate-bound service identities: `oracle1`, `oracle2`, and `oracle3`. Each
worker owns its Fabric signing identity, registry replica, cursor, retry loop,
and health record. One certificate subject cannot submit more than one response
to a request.

This is operational and identity separation inside one permissioned
organization. It must not be described as three independent real-world data
providers. A production deployment can place each worker in a separate MSP and
connect it to an independently governed hospital, policy, or regulator source.

## Version-bound 2-of-3 protocol

For current invoice claims, an insurer administrator starts processing and the
application publishes a current `OracleRegistrySnapshot` commitment before
creating an `OracleRequest`. The ledger records a `SOURCE_BOUND` invoice and
claim-version binding without deciding whether their facts match. The three
workers evaluate that match. The request
binds all adjudication inputs:

- claim ID and version, invoice source binding, query hash, and appeal commitment;
- registry ID, version, canonical root, rules version, and rules hash;
- model version and model hash;
- optional claim/version-bound selective-presentation ID, protocol, and hash;
- three assigned certificate subjects and the required confirmation count;
- commit and reveal deadlines.

The chaincode accepts a configurable 1–9-worker profile only when the threshold
is a strict majority and does not exceed the assigned worker count. The deployed
research profile assigns three workers and requires two matching canonical
result hashes. This means one unavailable or divergent worker cannot prevent a
valid decision, while one worker cannot decide a request alone.

Each worker first submits a salted commitment. Reveal begins when every assigned
worker has committed or when the commit deadline passes. Chaincode recomputes
the result and commitment hashes before accepting a reveal. A result reaches
consensus as soon as two identical hashes are revealed:

- a matching valid result sets the claim to `APPROVED`;
- a matching invalid result finalizes `NEGATIVE_RESULT`;
- three different complete results finalize `CONFLICT`;
- fewer than two matching results at the reveal deadline finalize `TIMEOUT`.

Failure outcomes set the claim to `ORACLE_FAILED` and may be routed to the
existing certificate-bound four-auditor review. Oracles cannot create
settlements. Settlement still requires insurer authorization and `BankMSP`
confirmation.

The `hospital-invoice-rules-v2` registry contains invoice ID and hashed patient
reference. Workers accept a positive claim up to the invoice amount within the
admission/discharge dates; the customer's free-text narrative remains separate
from the Hospital treatment reference. The ledger rejects a positive reveal if
the source invoice has since been voided. Older fixture-based requests retain
their original rules and hashes for historical test comparisons.

Appeal submission increments the claim version and clears the active Oracle
request. Old commitments and results therefore cannot authorize a corrected
claim. A new request has a different query/result domain even when visible claim
fields happen to match an earlier version.

## Dataset provenance and isolated replicas

The tracked files under `services/oracle-worker/registry/` are small deterministic
fixtures. The three baseline files have different source IDs and the same
canonical root. Fault profiles alter one registry or one configured model so
that divergent results are observable and repeatable.

For the larger experiment, run this from `services/oracle-worker`:

```powershell
npm run build:hybrid-registries
```

The adapter reads the existing Kaggle-derived hybrid JSONL and writes three
isolated registry replicas plus a controlled corrupt replica under ignored
`data/oracle/generated-hybrid/`. Its manifest records the input SHA-256, dataset
identifier/version, transformation version, record count, generation time, and
all canonical roots. The input digest is included in the rules commitment, so a
different source file produces a different on-ledger registry commitment.

The three generated replicas deliberately share one source dataset. They
demonstrate reproducible provenance, process isolation, identity separation, and
fault tolerance—not independent factual corroboration. Independent real sources
can later implement the same snapshot interface without changing the consensus
contract.

To run a worker against a generated replica, set `ORACLE_REGISTRY_PATH` before
starting its normal identity profile. For example, from `services/oracle-worker`:

```powershell
$env:ORACLE_REGISTRY_PATH="../../data/oracle/generated-hybrid/oracle1-hybrid-v1.json"
node src/index.mjs --env=.env.oracle1.example
```

Use the corresponding `oracle2` and `oracle3` file in the other worker
processes. Publish the manifest's `baselineRootHash`, record count, rules version,
and rules hash as the Fabric registry snapshot before requesting verification.

## Fault profiles

The supervised stack supports these profiles:

| Profile | Running inputs | Expected result |
| --- | --- | --- |
| `Baseline` | Three matching registries/models | 2-of-3 consensus |
| `Oracle2Unavailable` | Oracle 1 and Oracle 3 | Consensus after the commit deadline |
| `Conflict` | valid registry, corrupt registry, mismatched model | `CONFLICT` and auditor fallback |
| `QuorumUnavailable` | Oracle 1 only | `TIMEOUT` and auditor fallback |

The browser suite uses the equivalent `baseline`, `one-unavailable`, `conflict`,
and `timeout` profiles.

## Executable safety evaluation

Run:

```powershell
npm run evaluate:consensus
```

The evaluator enumerates all 64 response states for three workers where each is
unavailable or returns result `A`, `B`, or `C`. It checks that at most one result
can reach a strict-majority quorum and reports representative healthy,
unavailable, divergent, conflict, and timeout scenarios. Chaincode tests then
exercise the same properties against ledger state transitions, including stale
appeals, duplicate subjects, malformed thresholds, and delayed reveals.

## Observable provenance

Worker health exposes the certificate subject, source ID, registry root,
dataset/version, input digest, transformation version, model version, processing
counts, cursor progress, errors, and last latency. No private key, salt, patient
identity, or clinical document is exposed. Persisted checkpoints are marked
offline when their live endpoint cannot be reached.

## Selective-disclosure binding

HospitalMSP issues a Merkle credential for each finalized invoice and
InsurerMSP issues one for an active policy. Salts and complete credential fields
are stored in `oracleProofPrivateData`; only the issuer identity, source ID,
root, version, status, and expiry are public. Issuance is authenticated by the
normal Fabric transaction signature.

The policyholder registers a short-lived presentation after invoice
cross-checking. Chaincode generates and verifies proofs for the minimum invoice
and policy fields required for adjudication, checks their semantics against the
claim, binds the presentation to the claim version and a unique challenge, and
stores only its SHA-256 commitment publicly. Each assigned Oracle reads the
authorized private presentation, recomputes every Merkle path, checks expiry and
claim semantics, and includes the presentation commitment in its canonical
result hash. Undisclosed patient, treatment, premium, package, and terms fields
do not enter the shared world state or Oracle presentation.
