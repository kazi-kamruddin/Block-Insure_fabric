# Fabric 1.9.0 maintenance run

Branch `feature/1.9.0`. Evidence dated 20 November 2026 in Asia/Dhaka.
Go counts below are top-level tests / subtests. Full suites ran on native
Go 1.26.11 without Docker. The accepted 1.8.0 network, channel, and
volumes were never modified.

| Item | Status | Commit | Go before → after | Scope and outcome | What this does not show |
| --- | --- | --- | --- | --- | --- |
| A / 6 | Partial | `569e020`, `50786c6` | 55/24 → 56/24 | Synthetic, one host, unit and live. Legacy and release-qualified worker decisions coexist. Serial hold orders, existing commit/reveal, attestation mismatch refusal and unavailable-evaluator review passed. Named replay supports the installed frozen artifact. A live held request entered panel preparation after the item 9 fix. | No live pre-registry upgrade with an outstanding commitment. Hash attestation is an Oracle statement about its installation. |
| B / 3c | Done | `e3fbcaf` | 56/24 → 57/24 | Synthetic, one host, unit and live. Dev-lite defaults to overlap-first. V1 remains selectable. The v3 appeal certificate verified with duplicate rule v2. | No field-case sensitivity or precision estimate and no external or cross-host validation. |
| 4 | Done | `256aee8` | 52/18 → 53/18 | Synthetic, one host, unit and live readback. The certificate binds the issued terms and payable breakdown digest. A successor product preserved the approved payable in Go. [Result](medical-terms-binding-2026-11-20.md) | No live Fabric or CouchDB proof for the successor-product scenario. |
| 5 | Done | `88cc9ec` | 53/18 → 53/18 | Synthetic, one host, unit and live read-only. Four Python tests passed. One archived payout and the new version-3 appeal both verified against separate peer reads. The new certificate binds the issued rules, breakdown and duplicate rule v2. [Original unit result](dossier-verifier-2026-11-20.md) | An export alone has no independent ledger anchor and cannot establish clinical truth. |
| 7 | Partial | `e1c8d9b` and follow-up evidence | 57/24 → 57/24 | Synthetic, one host, unit, live SHADOW, and retrospective weak-label dataset. Two CouchDB dev-lite workers independently logged the expected score on authored input. Both authoritative reveals stayed pinned to the frozen evaluator. [Provider report](provider-advisory-shadow-2026-11-20.md). | No verified provider linkage, HIGH-tier promotion, or claim-level predictive validity. |
| 8 | Partial | `defe73e` | 59/24 → 59/24 | Synthetic, one host, unit and installed SDK review. The dev-lite gateway can hand off a typed unsigned request and refuse Bank credential loading. The separate CLI reads Fabric directly, requests operator approval, rechecks the reviewed fields, and uses SDK 1.12.1 external signing. Three unit tests passed. [Operator steps](../../tools/bank-signer/README.md) | The external mode was not activated on the live demo. No key move or ACL change, independently approved payout, or OS-level isolation test. |
| 9 | Done | `443c58a` and follow-up evidence | 59/24 → 59/24 | Synthetic, one host, unit and live. The corrected appeal, short-deadline escalation and pending release hold passed. Of 20 explicit pair checks, Bank + Insurer alone endorsed and committed both operations. The other 18 stopped at endorsement. [Pair results](dev-lite-endorsement-pairs-2026-11-20.md) | The result applies to the current membership and transaction path. The conditional per-key change was unnecessary for this deployment. |
| 10 | Done | Follow-up changes | 59/24 → 59/24 | Synthetic, one host, live. Three isolated CouchDB journeys each paid BDT 40.00 and exported a consistent certificate dossier. Teardown removed 11 owned volumes. The six accepted volumes matched by name and Docker-reported size before and after. [Acceptance](../dev-lite-medical.md#20-november-2026-couchdb-acceptance). | No performance or external validation, block-signature verification, or volume byte comparison. |
| 11 | Partial | `1bdc2e4` | 58/24 → 59/24 | Synthetic, one host, unit and live read-only. Sequence 4 returned a valid disposal plan and private-state hash for the settled appeal. Its 365-day deadline is 20 November 2027. | No live purge, peer storage inspection, or live post-purge verification. Shared clinical records are outside the disposal action. |
| 12 | Done offline | `58347be` | 57/24 → 58/24 | Synthetic, one host, unit. The Auditor commits a period seed and rate before start. Candidate payouts await the revealed seed. Observed 2,513/10,000 selections at 25%, and a resolved case entered panel review. | Dependence on timely seed reveal and confidentiality before the deadline. No live or independent draw verification. |
| 13 | Done offline | `dc3b2a3` | 58/24 → 58/24 | Synthetic, one host, unit. The Insurer-only projection report detected all four corrupted fields in a fixture. | Event visibility, checkpoint lag, and cross-query read timing can cause differences. The report does not repair them. |
| 14 | Done offline | `550bb36` | 58/24 → 58/24 | Synthetic, one host, unit. Reviewer CLI shows each contribution and the nearest feasible one-feature change at a supplied cutoff, measured in standardized units. | No causal effect, patient-level interpretation, or operational threshold validation. |
| 15 | Partial | Follow-up evidence | 59/24 → 59/24 | Synthetic, one host, live. A new Bank enrollment accessed Bank-private state. A CRL committed in block 451. The peer rejected the disposable revoked auditor and accepted its replacement. [Drill](dev-lite-certificate-drill-2026-11-20.md) | Production-style Bank cutover, old Bank retirement, and replacement auditor writes remain untested. |

Baseline and earlier commits were `71acca1` for the defensive regression
checkpoint, `281e908` for the seeded properties, and `4bfda9f` for the
measurement-only threshold comparison. Their [comparison](attacks-before-after.md),
[property result](settlement-seeded-properties.json), and
[measurement](duplicate-screen-measurement-2026-11-20.json) record their own counts.
The restricted comparison rows remain explicitly unrun.

### Changes and test records

| Item | Main files and tests | Result record |
| --- | --- | --- |
| A / 6 | `medical_model_release.go`, Oracle and settlement call sites, `decision-store.mjs`, `release-protocol.mjs` and the named replay CLI. Go transition and legacy request tests. Worker recovery and frozen-hash tests. | [Initial finding](medical-model-release-finding-2026-11-20.md), local `.local-reference/maintenance-1.9/item-A/` and `data/dev-lite/maintenance-release-replay.json`. |
| B / 3c | `medical_duplicates.go`, certificate schema, dossier verifier and duplicate rule/measurement tests. | [Held-out diagnostics](duplicate-screen-diagnostics-2026-11-20.json), local `.local-reference/maintenance-1.9/item-B/`. |
| 4–5 | Medical claim, appeal and certificate code, the independent `tools/verify-dossier/` CLI and their terms-binding and verifier test suites. | [Terms binding](medical-terms-binding-2026-11-20.md), [verifier](dossier-verifier-2026-11-20.md). |
| 7 | `provider-risk.mjs`, the worker's advisory hook and manifest exporter. Hash-checked SHADOW unit tests and live authored-vector comparison. | [Provider advisory](provider-advisory-shadow-2026-11-20.md), local `data/dev-lite/maintenance-provider-candidate.json` and `data/dev-lite-couchdb/maintenance-shadow-live.json`. |
| 8 | `tools/bank-signer/`, Bank-signing-request API, gateway config and key-loading gate. Request, approval and state-change unit tests. | [Signer procedure](../../tools/bank-signer/README.md), local `.local-reference/maintenance-1.9/item-08/`. |
| 9–10 | Dev-lite deployment, Playwright medical rehearsal, explicit pair experiment and an isolated CouchDB Compose profile. Offline shell checks cover both profiles and the one-network guard. | [Dev-lite integration record](../dev-lite-medical.md), [20 endorsement outcomes](dev-lite-endorsement-pairs-2026-11-20.md), local `data/dev-lite/maintenance-seq3-appeal*/report.json` and `data/dev-lite-couchdb/maintenance-lifecycle.log`. |
| 11 | `medical_retention.go`, appeal reads and web ledger mapping. Synthetic retention test and live disposal-plan query. | Local `.local-reference/maintenance-1.9/item-11/` and `data/dev-lite/maintenance-retention-plan.json`. |
| 12 | `medical_audit_sampling.go`, Oracle finalization and timeline. Go sampling and same-version test. | Local `.local-reference/maintenance-1.9/item-12/`. |
| 13 | Projection audit API and `claim-reconciliation.ts`. Corrupted-row and missing-data tests. | Local `.local-reference/maintenance-1.9/item-13/`. |
| 14 | `provider-reasons.mjs` and the reviewer CLI. Additive contribution and one-feature explanation tests. | Local `.local-reference/maintenance-1.9/item-14/`. |
| 15 | Disposable enrollment, authorized dev-lite AuditorMSP CRL update and before-and-after proposal evaluations. Existing application credentials stayed in place. | [Drill](dev-lite-certificate-drill-2026-11-20.md) and local `data/dev-lite/maintenance-revocation-drill/`. |

### Live deployment and readback

All five dev-lite peers committed sequence 3 of `insurance-contract`. The
source audit matched package
`insurance-contract_1.9.0:554e4db71fcad1402d2fb833cce7c6890ad7430ce51af2e02d08de45a0b11e5c`.
The lifecycle commit was
`2088f68cec9c98d1d847dad6761382462ad9d6d9c3cfc6bf4d333612dfd33002`.

All five peers later read back sequence 4 for the committed-state hold fix.
The audited package ID is
`insurance-contract_1.9.0:69a43c2fbcc76f0800d7c27042d31701945353f299d235051668c50111bd7f94`.
All five reported VALID for lifecycle transaction
`512e71fb8768d275429869128b5855458d3a69fc730a57bc877ce0cc2c400e6a`.

The separately bootstrapped CouchDB project used the same source-audited
package under its own genesis block and MSPs. All five CouchDB peers
reported VALID for lifecycle transaction
`5b13983b593e5ce6fc2cb3a90e0ce7f23c6389ddb21fa97480f442b610b8136f`
at sequence 1. LevelDB dev-lite was stopped during this run.

The uninterrupted browser rehearsal completed for
`medical-e6d1d017-12e0-4889-8112-9f818afb545d`. The corrected version 3
went through fresh evidence checks and three fresh approvals, and Bank
confirmed the BDT 40.00 payment `med-payout-a330a517-04c`. The verifier
checked the independently read v2 certificate, including the duplicate rule
version and terms and breakdown hashes. The browser report and receipt are
`data/dev-lite/maintenance-seq3-appeal-final/report.json` and
`data/dev-lite/maintenance-seq3-appeal-receipt.json`.

The short-deadline synthetic claimant escalation for
`maint-escalation-ec742a664ac9` was refused early with HTTP 409. After the
Oracle reveal deadline of 15:45:43 UTC, the claimant action committed at
15:46:59 UTC, ended the request as FAILED, and put the current claim into
MEDICAL_REVIEW_PREPARING. Local record
`data/dev-lite/maintenance-live-escalation.json`.

The sequence-4 held-release follow-up retained the same claim and pending
request from sequence 3. Its finalization code became MODEL_HELD, and the
current claim entered MEDICAL_REVIEW_PREPARING. Local record
`data/dev-lite/maintenance-live-hold.json`. The promoted successor used the
same frozen artifact, so this drill does not validate a new evaluator.

The same sequence-4 deployment returned two VALID settlement controls
and 18 endorsement-stage refusals across all two-organization pairs.
The final synthetic settlement debited and credited exactly 4,000 minor
units. [Endorsement report](dev-lite-endorsement-pairs-2026-11-20.md).

A read-only Docker inventory reported the same six names and sizes for
the preserved `block-insure` volumes at both observations. Local record
`data/dev-lite/maintenance-preserved-volume-comparison.json`. The size
check was repeated across the CouchDB replay and teardown. All six
preserved volumes matched again, all six LevelDB dev-lite volumes remained,
and zero CouchDB test containers or volumes remained. Local records
`data/dev-lite-couchdb/maintenance-accepted-volume-comparison.json` and
`data/dev-lite-couchdb/maintenance-teardown.json` contain Docker metadata.

The earlier sequence-2 corrected-appeal export also verified against a
peer-read certificate hash. The separate logistic release registration was
valid on the Insurer and Oracle peers
and read back in CANDIDATE status. Registration transaction
`d1074cf0262246fcc58412a1acefab62249253d4f6d5b7d81b48865c8892fe10`
and the candidate record are scoped to dev-lite. Local evidence files
include `data/dev-lite/maintenance-legacy-dossier.json` and
`data/dev-lite/maintenance-provider-candidate.json`. Named-release replay
ran on two synthetic inputs, preserving the mandatory review flag. Its
output is `data/dev-lite/maintenance-release-replay.json`.

### Duplicate rule limitations

The held-out generator authored hospital, service, overlap, readmission, and
billing patterns. V1 missed 347 edits on amount alone and 395 on missing
overlap with or without an amount mismatch. The V1 amount tolerance is public.
V2 ignores amount for records that overlap at the same hospital and service,
so the 347 amount-only V1 misses do not remain misses under V2. Edits with no
overlap can still pass V2, regardless of amount. The close benign overlap rate
is based on 24 synthetic repeats. On the held-out seed, edited referrals
rose from 258/1,000 to 605/1,000 and benign repeat referrals rose from
2/1,000 to 13/1,000. Both referred 0/1,000 authored nonoverlapping
readmissions. The initial V2 lookup reconstructs the
subject/hospital/service bucket from readable historical claims. That cost
and compatibility with future retention require separate evaluation.

### Findings and remaining operator work

See [FINDINGS](FINDINGS.md) for F01 early vote visibility, F02 legacy decision
lookup, F03 evaluator availability, F04 duplicate misses, F05 provider
identity linkage, F06 Bank custody, F07 private retention, F08 audit seed
handling, F09 incomplete projection, F10 certificate revocation, F11
frozen evaluator identity, F12 browser sign-in, F13 committed-state reads
during hold, F14 deployment-tool reliability, F15 enrollment timeout,
and F16 CouchDB startup and rehearsal tooling.

A human operator still needs to perform the second-operator rehearsal,
approve a Bank signature from an independently permissioned account, and
verify actual clinical-data disposal after the retention deadline. The
dev-lite certificate drill verified both replacement credentials and
rejection of the revoked auditor. A full Bank cutover still needs an
independently permissioned operator to switch credentials, test settlement
confirmation, and retire the previous enrollment. A verified mapping from
benchmark providers to enrolled hospitals is still needed for a live
provider HIGH-tier decision. The live pre-registry upgrade with a saved
Oracle commitment remains distinct from the tests and sequence-4 hold
demo.

The independent verifier also passed on an extract containing only the
claim, certificate and settlement. The unit purge left those bindings
unchanged. This complementary check used an unpurged live dossier and does
not establish actual peer-side erasure.

Final offline gates at the last verified code checkpoint were **59 Go tests
and 24 subtests**, **33 Oracle worker tests**, **4 dossier verifier tests**,
**4 focused web tests**, and **3 Bank signer tests**. Web TypeScript checking
passed. Go logs are under `.local-reference/maintenance-1.9/`.
The follow-up native suite confirmed the same 59 tests and 24 subtests
with zero failures. Its counts are in
`.local-reference/maintenance-1.9/followup-endorsement-couchdb/counts.json`.
