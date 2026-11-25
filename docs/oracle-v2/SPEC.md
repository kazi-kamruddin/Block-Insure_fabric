# Oracle protocol v2 for medical claims

Phase 1 reference design. The adapter services, Node evaluator, shared vectors
and experiments run offline. The ledger transitions in this document are
Phase 2 requirements. The existing v1 worker stays on its request-pinned v1
paths. Claims still reach the governed four-person panel after a referral,
disagreement or timeout. No Oracle path automatically rejects a claim.

## 1. Issuer governance

`SourceIssuerRegistry` records `{issuerId, kind, ed25519PublicKey, keyVersion,
validFrom, validUntil, status, authorizedFacts[], controlDomain}`. Kind is
`HOSPITAL_HIS`, `REGULATOR`, `CLAIMANT_RECEIPT` or `PAYMENT`. A Hospital
key needs approval by InsurerMSP, AuditorMSP and its designated Hospital
subject. Other kinds need InsurerMSP and AuditorMSP. Key versions are
immutable after approval. Preserve old keys and their validity/revocation
records for historical verification. The new-request interval is
`validFrom <= requestedAt < validUntil`, with key status ACTIVE at
`requestedAt`. Control domains describe who can control the input before
it is signed. Running a second copy under another key has no effect on its
underlying control domain.

## 2. Facts and authority

| Fact | Authorized issuer kind | Validation |
| --- | --- | --- |
| `invoiceIssued` | Hospital HIS (S-A) | Hospital/service/session and invoice dates, amount and diagnosis for the exact claim version |
| `licenceActiveOnServiceDate` | Regulator (S-B) | ACTIVE licence on the service date |
| `serviceAccredited` | Regulator (S-B) | Service accreditation on the service date |
| `tariffBand` | Regulator (S-B) | Effective tariff bounds on the service date; compare with signed S-A amount |
| `receiptConsistent` | Claimant receipt ingress (S-C) | Compare with signed S-A invoice; derived comparison with no independent claim about the amount |
| `paymentOccurred` | Payment (S-D), optional | Independent simulated Bank source for one named policy; match claim version, payee and amount |

Regulator versions are separate signed records, selected by their most
recent `validFrom` on or before the service date with
`serviceDate < validUntil`. Publish corrections and supersession under
distinct records. The Insurer's policy limits are separately labelled
terms. For the proposed DIAGNOSTIC policy, S-A and S-B facts are required
and their pertinent origins must be independent. S-C must match the S-A
invoice. A single issuer may provide several regulator facts from the same
authoritative feed. The rules do not infer independent corroboration from
those facts.

## 3. Records, lineage and independence

Each signed record contains `{recordId, issuerId, keyVersion, originId,
derivedFrom[], effectiveAt, payload, signature}`. A parent is addressed
by its globally unique record ID. Each origin identifier identifies a
source event, independent of a record's publication ID. Workers compute
the record's origin plus the transitive closure of parent origins, using
verified records from the pinned feeds. Treat missing parents, missing
origin IDs, cycles and oversized closures as unknown lineage. Two records
count as independent only when both are authorized for the facts for
which the policy asks, their origin closures are disjoint and their
control domains differ. A signed copy and the record it cites share an
origin even when the copy asserts a fresh origin ID of its own. A matching
receipt can corroborate transcription. Its origin remains tied to the
Hospital invoice when the receipt derives from that invoice.

## 4. Feeds, coverage and anchoring

Each append-only feed is `{issuerId, keyVersion, feedVersion, records[],
merkleRoot, coverage, issuedAt, signature, anchorSignature}`. Sort by
unique ASCII record ID. A leaf is `digest("oracle-v2:leaf", signedRecord)`.
A parent is `digest("oracle-v2:node", [left, right])`, duplicating the last
node at an odd level. An empty root is `digest("oracle-v2:empty", [])`.
The record inclusion proof carries the leaf index, tree size and siblings
in bottom-up order. Receipt and payment bodies use an enum for disposition
where applicable. Medical payloads stay in the restricted sources.

Ed25519 signs the 32 raw bytes of the domain digest. Encode the signature
and SPKI DER public key as unpadded base64url. Domains and signed bodies:

| Domain | Body |
| --- | --- |
| `oracle-v2:record` | Record excluding its signature |
| `oracle-v2:coverage` | `{issuerId, keyVersion, feedVersion, root, scope, from, through, recordIds[]}` |
| `oracle-v2:feed` | `{issuerId, keyVersion, feedVersion, merkleRoot, coverage, issuedAt}` with signed coverage |
| `oracle-v2:anchor` | `{issuerId, keyVersion, feedVersion, root, effectiveAt, coverageHash}` where coverageHash is the coverage digest |
| `oracle-v2:retrieval-receipt` | `{requestId, oracleId, feedVersion, root}` signed by the serving adapter's diagnostics key |

Any enrolled Fabric identity may submit
`AnchorSourceFeed(issuerId, keyVersion, feedVersion, root, effectiveAt,
coverageHash, signature)`. The issuer signature controls acceptance.
Chaincode records `anchoredAt` and the submitter, rejects rollbacks and
duplicate versions, and retains previous checkpoints. Use a retained
issuer-verifiable coverage statement to establish absence for an expected
record ID only within its exhaustive, explicitly scoped time interval.
A missing response or an out-of-scope assertion provides no absence
evidence. The offline adapter scope is `SYNTHETIC_CLAIMS`.

## 5. Manifest pinning and retrieval

At request creation resolve the eligible issuers for each required kind
from the claim, policy and issuer registry. Pin the latest eligible
anchored checkpoint with `anchoredAt <= requestedAt`, selecting an ACTIVE
key. Break an equal-anchor-time tie by feed version. Pin
`{issuerId, keyVersion, feedVersion, root, effectiveAt, anchoredAt}` per
required issuer, sorted by issuer ID. The ordered pins and requestedAt
form the `oracle-v2-source-manifest-v1` object and the
`oracle-v2:manifest` digest. Requests also bind the policy, Oracle roster
and evaluator release versions. Use request time for the authority,
record and checkpoint validity decisions. Service dates govern the
particular licence, accreditation and tariff intervals.

Workers request exact versions, validate the feed signatures and root,
and validate individual records and proof/coverage where applicable.
Distinguish response timeout, stale mirror, unavailable pinned version,
invalid evidence and verified absence. Re-fetch a mirror only within the
request's budget. Retrieval receipts remain per-worker diagnostics.
oracle1 retrieves directly, oracle2 verifies a mirror, and the Phase 2
oracle3 path reads restricted Hospital context from its own collection
peer and verifies the other required feeds. Worker-scoped bearer tokens
replace any shared registry token for the v2 endpoints.

## 6. Fact vector and integer classifications

`FactVector` has the shape `{schema: "fact-vector-v1", claimId,
claimVersion, manifestHash, policyVersion, facts, tariffBand, receiptCheck,
modelAdvice}`. Each required fact has `{status, evidence[]}` with a distinct,
sorted set of authorized source record IDs or hashes. Status is PASS,
CONTRADICTED, INSUFFICIENT or UNVERIFIABLE. PASS requires evidence. A record
required but unavailable or unverifiable cannot create a PASS. A dependent
positive assertion becomes INSUFFICIENT where independence is required.
Include one optional fixed enum `integrity` in a non-PASS fact when a
worker can establish INVALID_SIGNATURE, INACTIVE_LICENCE or
UNACCREDITED_SERVICE. This enum lets chaincode deterministically select
the integrity disposition without private payloads or free text. IDs
must be opaque references. No medical fields, raw values or PII appear
in the vector.

Use poisha for the tariff classification. BELOW means
`billMinor < bandMinMinor`, IN means the bill is at or under the maximum,
ABOVE means the bill exceeds the maximum and is at or below 115% of it,
and FAR_ABOVE means above 115%. Compare integer cross-products against
100 and 115 to preserve exact boundary values, including fractional
percentage points. The 115 cutoff follows the existing 1.15 allowance
for a typical band. A missing trusted band cannot approve a case.
`receiptCheck` is MATCH, MISMATCH or ABSENT. `modelAdvice` is REVIEW
for `riskScoreUnits >= thresholdUnits`, AUTO otherwise. The same frozen
artifact supplies those integer values. The mandatory evidence gate
continues to apply separately.

## 7. Deterministic decision

INTEGRITY_FAIL if any validated integrity reason reports an invalid
signature, inactive licence or unaccredited service. AUTO_APPROVE only
when every required fact is PASS, tariffBand is BELOW or IN, receiptCheck
is MATCH, and modelAdvice is AUTO. A separately pinned policy may allow
verified receipt absence by omitting it from the required set and accepting
an INSUFFICIENT receipt fact with ABSENT. The default diagnostic policy
requires a receipt. When evidence cannot qualify for AUTO_APPROVE or
INTEGRITY_FAIL the decision is PANEL_REVIEW. INTEGRITY_FAIL and
PANEL_REVIEW both route to the panel, with the reason carried by the
committed vector. The ledger derives the disposition again from the
verified canonical vector and pinned policy.

## 8. Canonical byte format

Containers are JSON records and arrays. Leaves are well-formed Unicode
strings and base-10 safe integers from `-(2^53-1)` through `2^53-1`.
Reject floats, nulls, booleans, duplicated keys, unknown fields in strict
schema objects and unpaired surrogates. Sort record keys by UTF-8 byte
order and preserve array order. Use JSON string escaping for controls,
quotes and backslash, with explicit lowercase escapes for U+2028 and
U+2029. No spacing or HTML escaping. Serialize zero without a sign.
The digest input is UTF-8 domain, one NUL byte, then canonical UTF-8 JSON.
Use SHA-256, lowercase hex. The portable vectors include Bengali text,
tariff and score boundaries, fact vector digest and subject-bound
commitments. Node runs them now. Phase 2 uses the same vectors in Go.

## 9–12. Commit, reveal, routing and diagnostics

Compute commitments as `digest("oracle-v2:commit", [channelId, requestId,
claimVersion, oracleSubject, factVectorHash, decision, salt])`. The salt
is lowercase hex for 32 bytes and subject/request-bound. Refuse repeated
commitment digests within a request and a second commitment or reveal by
the same assignee. Reveal includes canonical FactVector JSON, declared
decision, salt and workerDiagnosticsHash. Chaincode recomputes
`digest("oracle-v2:fact-vector", vector)`, the deterministic decision,
and the subject/channel-bound commitment. Refuse decoded but noncanonical
bytes, inconsistent identities, an incorrect decision, a different
commitment, or an ineligible time/version/assignment.

Take two distinct valid reveals of the exact same vector and decision
before finalizing. On exhausted divergent reveals or expiry, route to
the panel. The result code is `V2:<Decision>:<factVectorHash>`. Preserve
request-version dispatch for historical v1 code and commitment semantics.
The per-worker `workerDiagnosticsHash` covers full Shapley output, OOD,
raw ratios, retrieval path and optional signed receipts, using a separate
encoding that can include floating-point diagnostics. Diagnostics hashes
are excluded from the quorum object. They must never include keys, salts
or unneeded PII.

## 13–14. Roster and certificate

The governed roster snapshots `{version, subjects[3]{subjectId,keyVersion},
requiredConfirmations: 2, status}`. Approval is by InsurerMSP, AuditorMSP
and OracleMSP. Rotation applies to subsequent requests. Emergency
revocation stops later reveals by that subject. If fewer than two valid
assignees remain the request can close to the panel at timeout. The Phase
2 medical certificate binds manifestHash, factVectorHash, decision and
policyVersion alongside the settlement-critical existing terms/version
fields. v1 history keeps its own certificate and verifier semantics.

## 15. E2 offline evaluator adaptation

Preserve frozen weights, feature list, threshold and identity evidence.
For priors, use the fields the frozen context builder consumes: time,
amount, patient, provider, treatment and diagnosis. Unlinked episodes
use a HospitalMSP provider-local pseudonym based on the hospital ID and
PatientReferenceHash. The scope prevents unlinked episodes from populating
cross-hospital patient history. A verified association to this claim is
required for the current record, which alone needs a valid benchmark.
An undated prior with discharge before the cutoff cannot safely be excluded
and causes a typed incomplete-context referral. New finalized invoices
require dates in Phase 2.

Keep strictly prior UTC days and the inclusive lower edge at 90 days.
Refuse CONTEXT_OVERSIZED when the current record plus scoped prior
records exceed 10,000. Do not truncate. Check for duplicate invoice
identity in the scoped records. Complete matched contexts must reproduce
the v1 integer score. Integer model advice is the only score-derived
quorum field. Preserve raw and explanatory outputs as diagnostics.

## 16–17. Upgrade and approval wording

Before switching the medical request path, inspect pending v1 requests.
Drain each pending medical v1 request through the governed existing
review transition with separate owner approval. Keep historical reads
and verifiers. Register and govern E2 before making it the selected
release. Preserve current collection endorsement and dissemination.

Proposed invariant for the owner to approve: **exact 2-of-3 agreement on
the canonical fact vector and decision**. Three assigned Oracle subjects,
two exact matching reveals, governed Auditor fallback, the frozen model
and the two collection policies stay fixed. The protocol verifies
authority, declared lineage and agreement within the signed inputs.
Coordinated upstream false statements can still satisfy the verified input
policy. A matching receipt proves consistency with its source, not the
truth of the billed care. The demo uses simulated data and one workstation.

[Node/Go test vectors](../../services/oracle-worker/test/vectors/v2/protocol.json)
