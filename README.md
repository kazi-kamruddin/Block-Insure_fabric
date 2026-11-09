# Block-Insure Fabric

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

The current workflow demonstration uses a separate
`insurance-workflow-20261005` channel with schema-15 chaincode 1.5.1-workflow.
Use [the presentation runbook](docs/local-demonstration.md) and
`scripts/workflow-demo.ps1` to start it. The earlier 3 October hardening gate is
recorded in [the dated live record](docs/results/hardening-live-20261003.md).
The default local environment file still selects the older main channel; use
the workflow wrapper for the current demonstration.

This is not a production deployment claim. Institutional authentication,
durable encrypted object storage and key recovery, multi-node/orderer high
availability, production monitoring, backup/restore operations, and deployment
governance remain environment-specific work outside the local release.

## Workspace layout

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
