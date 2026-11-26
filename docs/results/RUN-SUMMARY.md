# Fabric 1.9.0 run summary

## Current state — 26 November 2026 freeze (Asia/Dhaka)

This section is the current summary. Everything below the next heading is the dated 20 November maintenance record, kept unchanged as history.

**Deployment.** The thesis demonstration runs on `insurance-dev-lite-190`, a LevelDB channel with five business organisations (Insurer, Hospital, Auditor, Bank, Oracle), one Raft orderer and a single shared chaincode-as-a-service (ccaas) process. Chaincode 1.9.0 is committed at lifecycle **sequence 4** with package `insurance-contract_1.9.0-r2:7240d4c0…82b1`. All five peers read back the same definition, package and approval. The ledger height after the upgrade is 406. The ledger carries every claim, policy and payout recorded since the 24 November seed: sequence 4 changed code, not state.

**What the system does.** A customer buys a diagnostic or surgical policy and pays premiums by EFT mandate or one-time payment. The hospital records the treatment episode and bill. The customer files a claim against that episode. Three Oracle workers independently assemble a fact vector from three signed sources: the hospital's own records (S-A, signed under HospitalMSP), a simulated regulator feed (S-B) and receipt consistency (S-C). They commit to it, then reveal it. Two exact matches decide the route. An automatic approval issues a certificate and the Bank pays in simulated BDT. Anything else goes to a four-auditor panel that votes by sealed ballot (three approvals approve, two rejections reject). A rejection can be appealed, which creates a new claim version that runs through the same checks. The frozen XGBoost evaluator and its E2/E3 successors only advise and route. They never decide payment alone.

**Last change (Session C).** Once any Oracle result or panel vote is revealed, no further sealed commitment is accepted. Before this, the ±15 s proposal-timestamp tolerance let a participant that had withheld its commitment submit a backdated one after seeing a revealed value. Three Go tests reproduce that attack; they failed on the sequence-3 source and pass on sequence 4. A live probe on the sequence-4 peer also showed that one changed bit in disclosed medical facts is refused. [Session C record](session-c-2026-11-26.md)

**Verification at freeze.**

| Suite | Result |
| --- | --- |
| Go chaincode (pinned container): gofmt, vet, tests | Clean, clean, 105 top-level tests passed |
| Web: lint, typecheck, Vitest, production build | Pass, pass, 234/234 in 68 files, 30/30 pages |
| Oracle worker: check, tests, frozen evaluator hash | Pass, 54/54, v1 hash matched |
| Source adapters | 8/8 |
| Demo launcher and registry restore scripts | 4/4 |
| Bounded workflow model (JS checker) | 544 states, 7 invariants |
| Dossier verifier (Session A, unchanged code) | 30 passed, 11 subtests |
| TLC (Session A and pre-freeze, models unchanged) | 5/5 configurations |

**Coverage.** Of the 62 tracked items, 52 are DONE, 5 PARTIAL, 4 deferred by plan and 1 is an owner drill. The five partial items need the owner's hands-on run: browser screenshots (Chromium needs 900 MB free with the stack running), the claim-206 escalation and a warmed-memory sample at or above 1,000 MB. [Coverage audit](../final-coverage-audit.md)

**Limits that stay.** All five organisations, the CAs and the three Oracle workers run on one laptop. The three Oracle subjects share one OracleMSP. S-B is simulated, and the fraud labels are synthetic, so no fraud-detection accuracy is claimed. Agreement between sources shows consistency and integrity, not clinical truth. No throughput figure is reported for the R2 system; the 24.1 TPS figure in the Phase 2 study belongs to a different CouchDB channel and workload. Twenty MVCC conflicts were measured on shared Oracle request keys ([attribution](r2-latency-2026-11-26.md#mvcc-attribution)).

## 20 November 2026 maintenance run (historical)

Branch `feature/1.9.0`. Evidence dated 20 November 2026 in Asia/Dhaka.
Go counts below are top-level tests / subtests. Full suites ran on native
Go 1.26.11 without Docker. The accepted 1.8.0 network, channel, and
volumes were never modified.

| Item | Status | Commit | Go before → after | Scope and outcome | What this does not show |
| --- | --- | --- | --- | --- | --- |
| A / 6 | Done | `569e020`, `50786c6` and follow-up evidence | 55/24 → 56/24 | Synthetic, one host, unit and live. An outstanding pre-registry request with two commitments survived the CouchDB sequence upgrade and coexisted with a new release-pinned request. Both reached exact consensus and the saved legacy decision files were unchanged. The hold and unavailable-evaluator checks also passed. | Self-attested evaluator installation and one controlled upgrade do not establish general deployment compatibility. |
| B / 3c | Done | `e3fbcaf` | 56/24 → 57/24 | Synthetic, one host, unit and live. Dev-lite defaults to overlap-first. V1 remains selectable. The v3 appeal certificate verified with duplicate rule v2. | No field-case sensitivity or precision estimate and no external or cross-host validation. |
| 4 | Done | `256aee8` | 52/18 → 53/18 | Synthetic, one host, unit and live readback. The certificate binds the issued terms and payable breakdown digest. A successor product preserved the approved payable in Go. [Result](medical-terms-binding-2026-11-20.md) | No live Fabric or CouchDB proof for the successor-product scenario. |
| 5 | Done | `88cc9ec` | 53/18 → 53/18 | Synthetic, one host, unit and live read-only. Four Python tests passed. One archived payout and the new version-3 appeal both verified against separate peer reads. The new certificate binds the issued rules, breakdown and duplicate rule v2. [Original unit result](dossier-verifier-2026-11-20.md) | An export alone has no independent ledger anchor and cannot establish clinical truth. |
| 7 | Partial | `e1c8d9b` and follow-up evidence | 57/24 → 57/24 | Synthetic, one host, unit, live SHADOW, and retrospective weak-label dataset. Two CouchDB dev-lite workers independently logged the expected score on authored input. Both authoritative reveals stayed pinned to the frozen evaluator. [Provider report](provider-advisory-shadow-2026-11-20.md). | No verified provider linkage, HIGH-tier promotion, or claim-level predictive validity. |
| 8 | Partial | `defe73e` and follow-up evidence | 59/24 → 59/24 | Synthetic, one host, unit and live. The external-mode gateway returned an unsigned handoff and refused its normal Bank confirmation. The separate CLI displayed the current settlement and committed a BDT 40.00 payout after explicit terminal approval using the replacement Bank certificate. [Operator steps](../../tools/bank-signer/README.md). | Approval was supplied for the synthetic rehearsal on the same host. An independently permissioned operator and OS-account denial of key access remain unverified. |
| 9 | Done | `443c58a` and follow-up evidence | 59/24 → 59/24 | Synthetic, one host, unit and live. The corrected appeal, short-deadline escalation and pending release hold passed. Of 20 explicit pair checks, Bank + Insurer alone endorsed and committed both operations. The other 18 stopped at endorsement. [Pair results](dev-lite-endorsement-pairs-2026-11-20.md) | The result applies to the current membership and transaction path. The conditional per-key change was unnecessary for this deployment. |
| 10 | Done | Follow-up changes | 59/24 → 59/24 | Synthetic, one host, live. Three isolated CouchDB journeys each paid BDT 40.00 and exported a consistent certificate dossier. Teardown removed 11 owned volumes. The six accepted volumes matched by name and Docker-reported size before and after. [Acceptance](../dev-lite-medical.md#20-november-2026-couchdb-acceptance). | No performance or external validation, block-signature verification, or volume byte comparison. |
| 11 | Partial | `1bdc2e4` and follow-up evidence | 58/24 → 59/24 | Synthetic, one host, unit and live evaluation. Sequence 4 returned the disposal plan. The exact hash-bound purge proposal was refused before the 365-day deadline, and re-reads confirmed the same private-state hash and certificate. Eligibility begins on 20 November 2027. | No committed purge, peer storage inspection, or live post-purge verification. Shared clinical records are outside the disposal action. |
| 12 | Done offline | `58347be` | 57/24 → 58/24 | Synthetic, one host, unit. The Auditor commits a period seed and rate before start. Candidate payouts await the revealed seed. Observed 2,513/10,000 selections at 25%, and a resolved case entered panel review. | Dependence on timely seed reveal and confidentiality before the deadline. No live or independent draw verification. |
| 13 | Done offline | `dc3b2a3` | 58/24 → 58/24 | Synthetic, one host, unit. The Insurer-only projection report detected all four corrupted fields in a fixture. | Event visibility, checkpoint lag, and cross-query read timing can cause differences. The report does not repair them. |
| 14 | Done offline | `550bb36` | 58/24 → 58/24 | Synthetic, one host, unit. Reviewer CLI shows each contribution and the nearest feasible one-feature change at a supplied cutoff, measured in standardized units. | No causal effect, patient-level interpretation, or operational threshold validation. |
| 15 | Done | Follow-up evidence | 59/24 → 59/24 | Synthetic, one host, live. The revoked auditor was refused and its replacement committed an approval vote. On the disposable CouchDB ledger the replacement Bank enrollment signed a payout, a BankMSP CRL committed, and the retired Bank predecessor was refused while the replacement still worked. [Drill](dev-lite-certificate-drill-2026-11-20.md). | The retirement applied to the disposable CouchDB enrollment. Production-style custody and retirement of the working LevelDB Bank enrollment are outside this drill. |

Baseline and earlier commits were `71acca1` for the defensive regression
checkpoint, `281e908` for the seeded properties, and `4bfda9f` for the
measurement-only threshold comparison. Their [comparison](attacks-before-after.md),
[property result](settlement-seeded-properties.json), and
[measurement](duplicate-screen-measurement-2026-11-20.json) record their own counts.
The restricted comparison rows remain explicitly unrun.

### Changes and test records

| Item | Main files and tests | Result record |
| --- | --- | --- |
| A / 6 | `medical_model_release.go`, Oracle and settlement call sites, `decision-store.mjs`, `release-protocol.mjs` and the named replay CLI. Go transition and worker recovery tests plus live restart with stored commitments. | [Initial finding](medical-model-release-finding-2026-11-20.md), local `.local-reference/maintenance-1.9/item-A/` and `data/dev-lite-couchdb/migration-rehearsal/maintenance-live-migration.json`. |
| B / 3c | `medical_duplicates.go`, certificate schema, dossier verifier and duplicate rule/measurement tests. | [Held-out diagnostics](duplicate-screen-diagnostics-2026-11-20.json), local `.local-reference/maintenance-1.9/item-B/`. |
| 4–5 | Medical claim, appeal and certificate code, the independent `tools/verify-dossier/` CLI and their terms-binding and verifier test suites. | [Terms binding](medical-terms-binding-2026-11-20.md), [verifier](dossier-verifier-2026-11-20.md). |
| 7 | `provider-risk.mjs`, the worker's advisory hook and manifest exporter. Hash-checked SHADOW unit tests and live authored-vector comparison. | [Provider advisory](provider-advisory-shadow-2026-11-20.md), local `data/dev-lite/maintenance-provider-candidate.json` and `data/dev-lite-couchdb/maintenance-shadow-live.json`. |
| 8 | `tools/bank-signer/`, Bank-signing-request API, gateway config and key-loading gate. Request, approval and state-change unit tests. Live gateway denial, handoff and CLI payout. | [Signer procedure](../../tools/bank-signer/README.md), local `data/dev-lite/maintenance-bank-cutover-gateway.json` and `data/dev-lite/maintenance-bank-cutover-confirmed.json`. |
| 9–10 | Dev-lite deployment, Playwright medical rehearsal, explicit pair experiment and an isolated CouchDB Compose profile. Offline shell checks cover both profiles and the one-network guard. | [Dev-lite integration record](../dev-lite-medical.md), [20 endorsement outcomes](dev-lite-endorsement-pairs-2026-11-20.md), local `data/dev-lite/maintenance-seq3-appeal*/report.json` and `data/dev-lite-couchdb/maintenance-lifecycle.log`. |
| 11 | `medical_retention.go`, appeal reads and web ledger mapping. Synthetic retention test, live plan and pre-deadline read-only evaluation. | Local `.local-reference/maintenance-1.9/item-11/`, `data/dev-lite/maintenance-retention-plan.json` and `data/dev-lite/maintenance-retention-refusal.json`. |
| 12 | `medical_audit_sampling.go`, Oracle finalization and timeline. Go sampling and same-version test. | Local `.local-reference/maintenance-1.9/item-12/`. |
| 13 | Projection audit API and `claim-reconciliation.ts`. Corrupted-row and missing-data tests. | Local `.local-reference/maintenance-1.9/item-13/`. |
| 14 | `provider-reasons.mjs` and the reviewer CLI. Additive contribution and one-feature explanation tests. | Local `.local-reference/maintenance-1.9/item-14/`. |
| 15 | Disposable enrollment, dev-lite AuditorMSP and CouchDB BankMSP CRL updates, before-and-after proposal evaluations and committed replacement signatures. | [Drill](dev-lite-certificate-drill-2026-11-20.md), local `data/dev-lite/maintenance-revocation-drill/` and `data/dev-lite-couchdb/migration-rehearsal/bank-rotation/`. |

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

In a later isolated CouchDB run, the schema-correct pre-registry archive
`830efd3f571ba0382d6168706947f43de8ce54ce1d148a97ecf3301c4501df70`
committed at sequence 2 in transaction
`73ea37f79d132eb8b86533e7ddb26870603703a02d8a1ac3fd955fd4fbb46506`.
Two workers committed and saved decisions for a request with no release
ID. The workers stopped while it was pending. All five peers validated
the audited 1.9.x upgrade to sequence 3 in transaction
`9634790da906b6f31eae272991cf1ec3ee2722dd40b431aeb6c2f700ce748700`.
The legacy request retained both commitments while a second request pinned
to `frozen-medical-v1` entered PENDING. After restart both requests reached
exact consensus. Oracle 2 and Oracle 3 revealed for the legacy request.
Oracle 2 had a saved pre-upgrade commitment, and both saved decision files
kept their original hashes. Both claims still required panel review.
The checkpoints and terminal evidence are under
`data/dev-lite-couchdb/migration-rehearsal/`.

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
check was repeated across the CouchDB replay and its original teardown.
All six preserved volumes matched again, all six LevelDB dev-lite volumes
remained, and zero volumes remained after that rehearsal's teardown. Local records
`data/dev-lite-couchdb/maintenance-accepted-volume-comparison.json` and
`data/dev-lite-couchdb/maintenance-teardown.json` contain Docker metadata.
After the later migration and Bank rotation run, the isolated project was
stopped with its eleven evidence volumes retained. The six accepted
1.8.0 volume names and Docker-reported sizes still matched the preserved
inventory. The accepted network, channel and containers stayed untouched.
Local closeout comparison is
`data/dev-lite/maintenance-release-closeout-volume-comparison.json`.

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
F16 CouchDB startup and rehearsal tooling, and F17 archived response schema.

A human operator still needs to perform the second-operator rehearsal,
approve a Bank signature from an independently permissioned account, and
verify actual clinical-data disposal after the retention deadline. The
certificate drills verified replacement writes and rejection of the revoked
auditor and the retired disposable Bank predecessor. The current LevelDB
Bank enrollment stays intact for normal demonstrations. A verified
mapping from benchmark providers to enrolled hospitals and an approved
referral threshold are still needed for a live provider HIGH-tier decision.

The replacement auditor vote committed in transaction
`aa356741e2044ad8279ef5cfc3a3d3ca43ff82f5d6e7bc6fdbf8388673ba80d2`.
The replacement Bank certificate signed the confirmation under explicit
terminal approval in transaction
`5b8ed1b940870a20160e62ef68c94d192fed94ec9b467586c7d3256b9411638b`.
The exported settlement dossier matched the same claim version, amount
and certificate. The gateway's 409 refusal applied to the configured
application path and did not establish OS-level isolation.

The disposable CouchDB replacement Bank signer committed transaction
`5c8e562307a8aed33e5b5f6a06f7a9fffe414e6d2b3d3fd4cb52c51654b72d38`
for BDT 40.00 before the predecessor was retired. The Bank MSP config
update committed in block 81. The same Bank-private account query
succeeded for both credentials before retirement. It succeeded only for
the replacement afterward. Local records include `before.json`,
`replacement-signed.json`, `container-latest.block`, and `after.json`
under `data/dev-lite-couchdb/migration-rehearsal/bank-rotation/`.

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
The release closeout reran that full suite with the same passing counts and
reran all three signer unit tests. The native Go record is
`.local-reference/maintenance-1.9/release-closeout/counts.json`.
