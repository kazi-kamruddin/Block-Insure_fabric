# Block-Insure Fabric

[![Fabric CI](https://github.com/kazi-kamruddin/Block-Insure_fabric/actions/workflows/quality.yml/badge.svg?branch=main&event=push)](https://github.com/kazi-kamruddin/Block-Insure_fabric/actions/workflows/quality.yml)

**[Verified medical demo](docs/results/medical-final-acceptance-2026-11-19.md)** — live isolated Fabric rehearsal covering medical intake, OCR, appeal, and Bank payout.

Block-Insure Fabric is the permissioned Hyperledger Fabric evolution of the
Block-Insure insurance platform. It retains the insurance workflows from
the Ethereum prototype—policies, claims, clinical cross-checking, auditor
review, banking, and evidence auditability—while using organization-issued
identities and Fabric ledger controls.

## Project status

An opt-in frozen XGBoost alignment candidate is under verification; see
[its input contract and verification boundaries](docs/frozen-xgboost-alignment.md).
It is not activated on preserved channels. Existing research results do not
validate the new evaluator or establish real-patient classification accuracy.
The current isolated candidate is1.6.3-xgb-alignment/sequence4. Its
[recovery/security guide](docs/workflow-recovery-and-security.md) and
[dated verification record](docs/results/recovery-security-2026-11-10.md)
track durable critical actions, the patched Go builder and provider failure
handling. Earlier [Stage B results](docs/results/alignment-stage-b-2026-11-09.md)
remain historical. Preserved-channel activation still requires owner review.
The maintained candidate launcher and full ordinary-form browser rehearsal now
pass scoped local acceptance; see the [10 November demonstration results](docs/results/candidate-rehearsal-2026-11-10.md).
The new [medical reimbursement candidate](docs/medical-reimbursement-candidate.md)
uses its own channel and introduces verified patient associations, reimbursement
statements and episode-based claim reservations. Use the matching November
checkout for rehearsals of the previously verified deployment.
The [medical review and OCR acceptance record](docs/results/medical-review-ocr-2026-11-19.md)
records the live 1.8.0-medical sequence-2 rehearsal through clarification,
decryption, browser-local OCR, same-panel appeal and one Bank payout.
The follow-up verified deadline recovery and committed PDF and JPEG OCR
receipts. The [synthetic challenger comparison](docs/fabric-ml-challengers.md)
records the two offline alternatives at the same review workload.
The [final medical acceptance record](docs/results/medical-final-acceptance-2026-11-19.md)
tracks Bank commit recovery, private patient matching, separate insurer
investigation outcomes and live challenger shadow scoring.

The original implementation areas and the policy/premium/benefit expansion are
joined by a certificate-bound 2-of-3 Oracle consensus subsystem. The source now
defines partner agreements, policy-specific provider networks, an independent
Hospital invoice register, Oracle-led invoice checking, and a
five-business-organization network with a Go contract, Next.js Gateway boundary, role-specific
workflows/evidence, release verification, policy acquisition, premium collection,
bank mandates, governed benefits, distributed adjudication, appeals, and advisory
fraud triage, governed evidence grants, durable event projection, and
ledger-derived research metrics, evidence Merkle inclusion proofs, a targeted
Bank–Insurer private-data collection, independent Oracle workers, commit/reveal
consensus, governed auditor fallback, issuer-bound selective-disclosure
credentials, executable TLA+ workflow verification, and reproducible Caliper
and fault-profile benchmarks. The archived clean local baseline runs
`insurance-contract` 1.4.0 with schema 14. Its automated code gate and live Fabric
workflow cover the Phase 1 partner and Hospital boundary.

The preserved October workflow demonstration uses a separate
`insurance-workflow-20261005` channel with schema-15 chaincode 1.5.1-workflow.
Select it explicitly with `scripts/workflow-demo.ps1 Start -Profile Historical`.
The wrapper now defaults to the verified November candidate. Use the
[presentation runbook](docs/local-demonstration.md) for the current isolated
candidate and keep its application/package/schema aligned. The earlier3 October hardening gate is
recorded in [the dated live record](docs/results/hardening-live-20261003.md).
The default local environment file still selects the older main channel; select
the isolated candidate environment explicitly for current alignment verification.
Preserving a channel does not activate the latest source on it.

This is not a production deployment claim. Institutional authentication,
durable encrypted object storage and key recovery, multi-node/orderer high
availability, production monitoring, backup/restore operations, and deployment
governance remain environment-specific work outside the local release.

## Workspace layout

This repository is standalone: runtime, build, tests and operational tooling do
not require the Solidity implementation or an imported copy. Shared methodology
is represented by Fabric-owned frozen assets and source-hashed test fixtures.
Other implementations serve only as read-only development references.

- `network/` — local Fabric topology, channel configuration, and lifecycle scripts.
- `chaincode/insurance-contract/` — insurance domain chaincode and its tests.
- `apps/web/` — Next.js web application.
- `docs/` — architecture, role model, and implementation notes.
- `scripts/` — shared verification and supervised demonstration automation.
- `services/oracle-worker/` — independent Oracle processes, registry fixtures,
  durable cursors, and health reporting.
- `formal/insurance-workflow/` — TLA+ specification and exhaustive executable checker.
- `benchmarks/` — Hyperledger Caliper and end-to-end Oracle fault experiments.

Server-side Gateway, identity, evidence, fraud, event, and research modules are
co-located under `apps/web/lib/`; cross-component browser tests live in
`apps/web/e2e/`.

`reference/` contains the prior Ethereum implementation and a dated Fabric
context snapshot for local study. It is deliberately ignored by Git; edits to
`reference/context Block_Insure_Fabric 13oct.md` remain local unless
explicitly added to version control. The nested Ethereum implementation is not
the active runtime.

## Implemented architecture

The local network models separate organizations for the insurer, hospital,
bank, auditor, and Oracle services, backed by Fabric CAs and CouchDB. Its Go chaincode enforces
MSP membership, certificate role attributes, asset ownership, and the complete
policy-to-settlement and policy-to-benefit state machines. The Next.js server accesses the ledger
through Fabric Gateway; browsers never hold Fabric private keys.

## Getting started

For this machine's existing November candidate, use the maintained supervisor:

```powershell
.\scripts\workflow-demo.ps1 Start
.\scripts\workflow-demo.ps1 Status
.\scripts\workflow-demo.ps1 Stop
```

Open `http://127.0.0.1:3200/workspace`. This profile verifies the archived source,
all five installed/approved/committed package identities and schema, drains late
historical starts, and resumes existing state. It does not deploy, seed or reset.
Restore the original ignored `data/candidate-demo/secrets.json` and existing
identities/state when moving machines. No original secret is generated by Start.
See [candidate startup and browser rehearsal](docs/candidate-demonstration.md).
The commands below describe separate development/network setup, not a procedure
to repeat against preserved ledgers.

The local Fabric network is implemented under `network/`. From Ubuntu WSL:

```bash
bash network/scripts/network.sh up
bash network/scripts/deploy-chaincode.sh
bash network/scripts/network.sh verify
bash network/scripts/smoke-workflow.sh
```

The web application lives under `apps/web`. Copy `.env.example` to the ignored
`.env.local`, generate an `AUTH_SECRET` of at least 32 characters, and run:

```powershell
npm install
npm run dev
```

An optional supervised local event consumer can then be run from `apps/web`
with `npm run events:sync`; `-- --once` performs a bounded complete catch-up and
exits. It uses `EVENT_WORKER_SECRET` and never receives a Fabric private key.

The application provides process and live-ledger health routes, signed local
demo sessions, a `/showcase` presentation board, role-aware presenter guides,
role-specific dashboards and guided transactions, ledger queries,
and browser-encrypted evidence storage with on-ledger integrity/access records. Demo authentication and
local filesystem storage are development adapters, not production identity or
object-storage implementations.

For a supervised local deployment from the repository root, use
`scripts/demo-stack.ps1`. `Preflight` is read-only, `Start` reuses the preserved
ledger, `Status` checks the web app plus the event, banking, and Oracle workers, and `Stop` retains Fabric
volumes. `CleanBootstrap -ConfirmReset` is deliberately destructive and is only
for an explicitly approved clean showcase; it rebuilds the topology, deploys
chaincode 1.4.0, seeds partner agreements, private balance-bearing Bank accounts, Hospital invoices, and the
policy/benefit/Oracle catalog, then starts the web app, event worker, automatic
premium-collection worker, and all three Oracle workers.

See [the lifecycle design](docs/policy-premium-benefit-lifecycles.md) for policy,
OTP, collection-worker, reconciliation, and benefit boundaries;
[the partner and Hospital boundary](docs/partner-agreements-and-hospital-invoices.md)
for agreement-scoped provider networks, independent invoices, and insurer
cross-checking;
[the local demonstration runbook](docs/local-demonstration.md) for the
six-organization journey and [the evidence security boundary](docs/evidence-security.md)
for the AES-GCM envelope, authorization path, and production limitations. The
[adjudication design](docs/distributed-adjudication.md) documents assignment,
quorum, timeout, appeal, and fraud decision-support boundaries. See the
[operations and research design](docs/event-driven-operations-and-research.md)
for Fabric event checkpointing, notification projection, evidence grants, and
reproducible thesis metrics. The [Oracle consensus design](docs/oracle-consensus.md)
documents certificate assignment, exact-result commit/reveal, version binding,
worker independence, and manual-review fallback.
The [Merkle and private-banking design](docs/evidence-merkle-and-private-banking.md)
specifies canonical evidence proofs, transient input, collection membership, and
the public/private account split.
The [Phase 1 baseline](docs/results/phase1-baseline-2026-09-26.md) records the
current source/package/ledger provenance, completed checks, workflow boundaries,
and the remaining isolated live gate.
The [privacy, formal-verification, and benchmarking design](docs/privacy-formal-benchmarking.md)
defines the selective-disclosure protocol, checked invariants, experiment matrix,
and interpretation limits.

## Complete verification

Code checks require only this checkout. Use Node.js 22.12 or newer within the
22.x line, or a supported 24.x release, for the web test toolchain. Run
`npm --prefix apps/web ci`, then its lint, typecheck, test, audit and build
scripts. Oracle checks use `npm --prefix services/oracle-worker run check`,
`npm --prefix services/oracle-worker run check:xgboost` and
`npm --prefix services/oracle-worker test`. No sibling repository, imported
reference directory, Fabric network or private environment file is needed for
these code gates. The live verification below additionally requires this
project's own network and enrolled identities.

With Docker Desktop and the Fabric network running, create the isolated Phase 1
channel once from Ubuntu WSL:

```bash
bash network/scripts/create-phase1-channel.sh
```

Then execute every code, network, security, browser, and live-workflow check
from Windows PowerShell:

```powershell
.\scripts\demo-stack.ps1 Stop -KeepNetwork
.\scripts\verify-phase1.ps1
.\scripts\demo-stack.ps1 Start
```

The verifier needs exclusive access to the Next.js build and Oracle worker ports;
it fails early with an actionable message if managed application services are
still running. Fabric ledger volumes remain available throughout this sequence.

The wrapper runs `verify-all.ps1` with an experiment channel and separate local
evidence, event, Oracle, and browser-artifact paths. The preserved
`insurance-channel` remains available for demonstrations. The command writes
an ignored machine-readable summary to
`verification-results/latest.json`. Its browser phase creates uniquely named
local ledger records and proves role isolation plus automatic consensus and
negative, divergent-snapshot, and unavailable-Oracle fallback settlement paths.

GitHub Actions also runs locked Next.js lint/type/unit/audit/build checks, Oracle
worker protocol/durability tests, and native Go format/vet/tests on pushes and
pull requests. The live Fabric/browser gate remains local because it depends on
this repository's five-business-organization Docker network and enrolled
development identities.
