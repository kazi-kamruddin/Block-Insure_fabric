# Phase 1 thesis baseline — 26 September 2026

## Claim and scope

The prototype demonstrates failure-aware, auditable health-insurance claim
adjudication on a permissioned Hyperledger Fabric network. Its demonstrated
properties are role-bound transaction authority, invoice and policy provenance,
exact 2-of-3 Oracle result agreement, governed auditor fallback, version-bound
appeals, and inspectable evidence and payment records. Fraud scoring is advisory.
Bank balances and transfers are simulated. Privacy claims are limited to the
implemented PDC membership, hashes, browser encryption, grants, and selective
disclosure protocol. The missing Tripathi `fabric2.pdf` prevents a final novelty
comparison; no novelty claim is made here.

The missing item is identifiable as Tripathi et al., *Health insurance system
using federated blockchain technology*, *International Journal of Ad Hoc and
Ubiquitous Computing* 50(4), 223–239 (2025), DOI
[`10.1504/IJAHUC.2025.150218`](https://www.inderscience.com/info/inarticle.php?artid=150218).
The publisher's abstract confirms an insurance workflow on Hyperledger Fabric,
so Fabric-based insurance itself cannot be claimed as novel. The complete
methods and experiments are not available in this workspace; comparison of
specific failure, Oracle, privacy, or governance mechanisms remains open.

## Named source and preserved ledger

| Item | Observed state |
| --- | --- |
| Repository base | `e9b915a333cc25b5699c82ac36db977242d4248a` on `developement` |
| Reviewed readiness fix | `a87a238` |
| Source state | `phase1-baseline-2026-09-26` Git tag, on `developement` |
| Node / npm / PowerShell | `v24.16.0` / `10.2.5` / `7.6.5` |
| Preserved ledger | `insurance-channel`, height `2100` at 17:21 Asia/Dhaka on 26 September; current block hash `KEXpmruMaXUnA8IGIQ8D2/u3yUIJM23Q0waCLjPvMGA=` |
| Contract | `insurance-contract` version `1.4.0`, sequence `11`, schema `14` |
| Local package SHA-256 | `02254b0792c1db1265d96bfc71f3ad9acbb337760a7747eecb92e09e2c870450` |
| Package ID | `insurance-contract_1.4.0:02254b0792c1db1265d96bfc71f3ad9acbb337760a7747eecb92e09e2c870450` |

The package's 22 runtime source files are byte-identical to this working tree.
`src/contract_test.go` differs because it now includes a credential-revocation
boundary test. `scripts/audit-chaincode-package.sh` queried all five
peers: each reports the 1.4.0/11 committed definition and has approved and
installed this exact local package ID. The read-only network verification passed
for 17 services, six CAs, five CouchDBs, five joined peers, enrolled Hospital and
Oracle identities, and schema 14. This establishes source-to-package-to-peer
provenance for the current runtime; a version and schema query alone would not.

## Architecture and authority

The Next.js server authenticates demo sessions and maps each role to a fixed
server-held Fabric identity. Chaincode independently checks the certificate MSP,
role, subject, ownership, assignment, asset state, and version. HospitalMSP
creates and finalizes its own invoices. InsurerMSP checks them and requests Oracle
work. Three certificate-bound Oracle subjects in OracleMSP commit and reveal
results. Assigned AuditorMSP subjects vote on failure routes. BankMSP executes
the simulated premium and settlement state changes. The orderer and five peers
maintain a shared channel; public world state is visible to channel members.

Bank account private values use the Bank–Insurer PDC. Credential and selective
presentation details use the Hospital–Insurer–Oracle PDC. Their public metadata,
hashes, and workflow transitions remain on the channel. Browser AES-GCM evidence
ciphertext is stored locally, with ledger hashes and grants; local file loss can
make a referenced ciphertext unrecoverable. Demo authentication is not proof of
institutional identity. Three Oracle subjects share one MSP and may share source
errors; agreement alone does not prove clinical truth.

## Workflow and failure behavior

The reproducible demonstration route is documented in
`docs/local-demonstration.md`: policy and premium, Hospital-owned invoice,
invoice-bound claim and encrypted evidence, insurer cross-check, Oracle request,
positive result or negative/conflict/timeout fallback, assigned auditor votes,
fresh-version appeal, authorized simulated settlement, dossier, and research
export. Claims cannot use an old approval after appeal version change. Invalid
role, duplicate vote, stale version, late Oracle vote, and altered evidence proof
are rejected by the relevant chaincode or application checks.

The web command for `OpenAppealReview` was removed because chaincode deliberately
rejects it. A submitted appeal requires a corrected Hospital attestation and a
new Oracle request; only a finalized Oracle failure can be routed to a new review.
Premium collection uses `ProcessPremiumCollection` to derive success or bounce
from the simulated balance; manual outcome setters are unavailable in the web
workflow. Benefit `PAID` debits the simulated insurer account and records a Bank
reference; beneficiary credit and external transfer are not established.
Credential revocation blocks new presentations, but does not retrospectively
invalidate a presentation already registered as `VERIFIED`; the Oracle request
checks that presentation's expiry and claim version, not current credential
status. Revocation currently has no web action.

## Verification on this source state

| Gate | Result |
| --- | --- |
| Web lint and type check | Passed |
| Web unit tests | 20 files, 55 tests passed using `npx vitest run --configLoader runner` |
| Production build and worker syntax | Passed |
| npm high-severity dependency audit | Passed, zero vulnerabilities reported |
| Oracle worker syntax and unit tests | Passed, 16 tests |
| Go chaincode tests | Passed in `golang:1.25` with read-only source mount |
| Bounded workflow model | Passed; 208 reachable states, five safety invariants |
| Fabric network and package provenance | Passed as detailed above |
| Browser/live workflow and measured journey evaluation | Pending isolated experiment ledger |

The full `scripts/verify-all.ps1` gate has not passed on this source state. Its
browser phase writes uniquely named assets, so running it on the preserved
height-2100 ledger would change the starting evidence. A separate disposable
ledger is required before the live positive, negative, conflict, timeout,
appeal, evidence-tamper, role-denial, replay, and restart checks can be reported
as current results. The small end-to-end latency evaluation must be measured on
that same named ledger, with raw observations and fixture hashes retained.

## Thesis interpretation

The present code and verified unit/network gates support a concrete account of
implemented authority and deterministic failure handling. They do not yet prove
the entire live journey on this exact source commit, performance improvement,
fraud accuracy, production privacy, independent Oracle organizations, real
payment delivery, or clinical validity. Phase 1 closes only after the isolated
ledger's complete gate and measured healthy/failure journeys are attached to
this baseline and a fresh-reader deployment has been rehearsed.
