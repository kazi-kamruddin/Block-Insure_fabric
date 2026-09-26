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
| Full-gate source | `ed2727a` (clean working tree at verification) |
| Node / npm / PowerShell | `v24.16.0` / `10.2.5` / `7.6.5` |
| Preserved ledger | `insurance-channel`, height `2100` before and after the Phase 1 tests; current block hash `KEXpmruMaXUnA8IGIQ8D2/u3yUIJM23Q0waCLjPvMGA=` |
| Experiment ledger | `insurance-phase1-20260926`, height `483` after verification and measurement; current block hash `qgkTD2ZBUpb8YnqNvoitQw5RnUcIHWQQa0Mqu2JnnC8=` |
| Contract | `insurance-contract` version `1.4.0`, sequence `11`, schema `14` |
| Local package SHA-256 | `02254b0792c1db1265d96bfc71f3ad9acbb337760a7747eecb92e09e2c870450` |
| Package ID | `insurance-contract_1.4.0:02254b0792c1db1265d96bfc71f3ad9acbb337760a7747eecb92e09e2c870450` |
| Experiment contract | `insurance-contract` version `1.4.0-phase1`, sequence `1`, schema `14`; package SHA-256 `6096ff77179a32dca12591e0d72e012dd4485ce06d09c10aec2bbed7834b48db` |

The package's 22 runtime source files are byte-identical to this working tree.
`src/contract_test.go` differs because it now includes a credential-revocation
boundary test. `scripts/audit-chaincode-package.sh` queried all five
peers: each reports the 1.4.0/11 committed definition and has approved and
installed this exact local package ID. The read-only network verification passed
for 17 services, six CAs, five CouchDBs, five joined peers, enrolled Hospital and
Oracle identities, and schema 14. This establishes source-to-package-to-peer
provenance for the current runtime; a version and schema query alone would not.
The experiment package's 22 runtime source files were also checked byte-for-byte
after measurement; its deployment output recorded the package ID ending in
`6096ff77179a32dca12591e0d72e012dd4485ce06d09c10aec2bbed7834b48db`
installed on all five peers and committed on the experiment channel.

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

| Asset | Principal tested transitions and authority |
| --- | --- |
| Policy | Policyholder acquisition creates `PENDING_PAYMENT`; a Bank-confirmed premium activates coverage. Insurer lifecycle action can advance grace, lapse, or expiry. |
| Claim | Policyholder submission binds an invoice; Insurer cross-check establishes Hospital verification; Oracle consensus approves or fails; an assigned auditor review can resolve failure. |
| Appeal | Policyholder submits one fresh claim version after rejection; Hospital and insurer supply a current attestation; a new Oracle request is version-bound; failed Oracle verification may open a new review. |
| Settlement | Insurer authorizes only a current approved claim; BankMSP confirms simulated payment and closes the liability. |

The trust assumptions are explicit: the Fabric CAs and organization admins issue
correct identities; Hospital invoice data and Oracle registries are supplied by
their named operators; the insurer controls orchestration; BankMSP attests to
simulated settlement; and the local host preserves ciphertext, keys, worker
state, and Fabric volumes. The tests check transitions and provenance under
those assumptions, not the truth of underlying medical or bank facts.

## Verification on the named source and experiment ledger

| Gate | Result |
| --- | --- |
| Web lint and type check | Passed |
| Web unit tests | 20 files, 55 tests passed |
| Production build and worker syntax | Passed |
| npm high-severity dependency audit | Passed, zero vulnerabilities reported |
| Oracle worker syntax and unit tests | Passed, 16 tests |
| Go chaincode tests | Passed in `golang:1.25` with read-only source mount |
| Bounded workflow model | Passed; 208 reachable states, five safety invariants |
| Fabric network and package provenance | Passed as detailed above |
| Browser/live workflow | 32 applicable main-suite tests passed; conflict, one-worker, and timeout cases each passed separately |

The full `scripts/verify-all.ps1` gate passed via `scripts/verify-phase1.ps1`
from clean commit `ed2727a`. Its [machine-readable report](phase1-verification-2026-09-26.json)
records all 15 steps as passed. The main browser suite skipped the three
scenario-specific tests by design; the verifier invoked and passed each one in
its matching worker profile. The first full attempt saw a Windows Playwright
worker exit before the timeout case began. An isolated timeout rerun passed, and
then the entire gate passed in one clean second run. This transient process
failure is a test-host reliability observation, not a claim-workflow outcome.

The browser suite exercised role isolation, invoice-bound claim submission,
encrypted evidence access and grants, insurer cross-check, policy/premium/benefit
and simulated banking flows, Oracle agreement and governed fallback, a corrected
appeal with fresh Hospital and Oracle verification, settlement, dossier, and
research export. Chaincode tests cover tampered Merkle proofs, stale-version
and duplicate-vote rejection. Worker tests cover identity-bound durable cursor
replay; a full live loss-and-recovery drill for local ciphertext or worker state
was not performed.

The experiment channel can be reproduced without resetting the preserved
channel. After the README's local setup, run `network/scripts/network.sh up`
and `network/scripts/create-phase1-channel.sh` in Ubuntu WSL, then run
`scripts/verify-phase1.ps1` in PowerShell. The channel script creates and seeds
only `insurance-phase1-20260926`; the verifier sets separate evidence, event,
Oracle cursor, and Playwright paths. The network and host resources are shared
between channels, so this is ledger isolation rather than independent hardware.

## Small measured journey evaluation

`benchmarks/oracle-faults/run-matrix.ps1` ran five profiles in the order below
on the experiment channel. The [raw observations](phase1-journey-measurements-2026-09-26.json)
retain start times, pass/fail outcomes, and elapsed milliseconds. Each profile
was run once, with unique test IDs and no exclusions.

| Journey | Outcome exercised | Whole test elapsed time |
| --- | --- | ---: |
| Healthy 2-of-3 | Automatic approval and simulated settlement | 58.064 s |
| Matching negative result | Auditor fallback and simulated settlement | 67.348 s |
| One Oracle unavailable | 2-of-3 approval and simulated settlement | 59.195 s |
| Divergent sources/model | Conflict, auditor fallback and simulated settlement | 67.792 s |
| Quorum timeout | Timeout, auditor fallback and simulated settlement | 64.710 s |

These are browser-test wall-clock times, including server startup, fixtures,
role sessions, ledger transactions, waits, and assertions. They are not isolated
Fabric transaction latency or capacity measurements. One run per profile does
not support confidence intervals or a reliable performance ranking. The
observation is that all five paths completed and the governed failure journeys
took roughly one minute under this local setup.

The registry fixture SHA-256 values are: Oracle 1
`6cf12a6f8f1cfcea92d7c1e29228e28312ae13e2f56b4fc11e8705f36e1b7a08`,
Oracle 2 `719933d02e3a77263aa8b38cb812eb7d89b80b759cae188d97de997266c7e880`,
Oracle 3 `5637eeb367a0f7d3430f3f236728136cb431aedd83c00fc6fe97563398d8ef77`,
and the Oracle 2 conflict fixture
`9be2d890895cc478cb23bcd953998ecb21a5c89385ce56afd5df931a474ecb0b`.

## Thesis interpretation

The named source, deployed experiment channel, complete gate, runnable channel
setup, and measured representative journeys satisfy the Phase 1 prototype gate.
The results establish exercised authority, auditable transitions, and bounded
failure handling in this local deployment. They do not establish a performance
improvement over alternatives, fraud accuracy, production privacy, independent
Oracle organizations, real payment delivery, or clinical validity. The
Tripathi full-text comparison and a live disaster-recovery drill remain explicit
thesis limitations, not implemented results.
