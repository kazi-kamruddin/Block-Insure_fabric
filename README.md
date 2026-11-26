# Block-Insure Fabric

[![Fabric CI](https://github.com/kazi-kamruddin/Block-Insure_fabric/actions/workflows/quality.yml/badge.svg?branch=main&event=push)](https://github.com/kazi-kamruddin/Block-Insure_fabric/actions/workflows/quality.yml)

**[R2 medical demo](docs/results/r2-journeys-2026-11-26.md)** — retained LevelDB ledger with signed-source processing, panel decisions, appeal and simulated BDT payouts.

Block-Insure Fabric is the permissioned Hyperledger Fabric evolution of the
Block-Insure insurance platform. It retains the insurance workflows from
the Ethereum prototype—policies, claims, clinical cross-checking, auditor
review, banking, and evidence auditability—while using organization-issued
identities and Fabric ledger controls.

## Current architecture (final)

The thesis demonstration uses `insurance-dev-lite-190`, a LevelDB channel
with five business MSPs, one Raft orderer, Go chaincode and a Next.js
Gateway on loopback port 3219. The Gateway holds Fabric identities. The
policyholder, hospital, insurer, bank and auditor use role-scoped workspaces.
Scoped collections hold medical facts and private Bank state. Encrypted
evidence files stay off-ledger, with references and digests on the ledger.

Three Oracle subjects in one OracleMSP run on the same host. Quorum requires
two exact matches on the request-pinned fact vector and routing decision.
Source records carry signed authority, origin
and derivation data. Two matching reveals can route an eligible diagnostic
claim automatically. Cases requiring review use a four-person panel with
three approvals or two rejections. Bank settlement uses simulated BDT and
checks the current version's approval certificate.

The retained definition is chaincode 1.9.0 at lifecycle sequence 3,
package `a5992983…5878`. A single shared ccaas process serves the peers.
DEMO revision 1, E3 routing and the six-auditor roster are active. R2 adds
sealed votes, Auditor-peer disclosure, three-share audit sampling and
certificate v3. S-B is simulated regulator data. [Dated R2 evidence](docs/results/r2-journeys-2026-11-26.md)

[Deployment provenance](docs/provenance.md) · [Dev-lite runbook](docs/dev-lite-medical.md) · [R2 design](docs/oracle-v2/R2-DESIGN.md) · [Defence checklist](docs/defence-checklist.md) · [Historical deployments](docs/archive/README.md)

The [thesis contribution](docs/paper/contribution.md) evaluates provenance
conditions and Oracle routing on synthetic evidence. The [ML tables](docs/paper/ml-evidence.md)
give the scope and limits of the frozen evaluator and shadow challengers.

## Workspace layout

This repository is standalone: runtime, build, tests and operational tooling do
not require the Solidity implementation or an imported copy. Shared methodology
is represented by Fabric-owned frozen assets and source-hashed test fixtures.
Other implementations serve only as read-only development references.

The [Fabric research dataset guide](datasets/hybrid-v1/README.md) explains
how to verify the local Medicare benchmark archive and prepare the isolated
5,000-record comparison workload.

- `network/` — local Fabric topology, channel configuration, and lifecycle scripts.
- `chaincode/insurance-contract/` — insurance domain chaincode and its tests.
- `apps/web/` — Next.js web application.
- `docs/` — architecture, role model, and implementation notes.
- `scripts/` — shared verification and supervised demonstration automation.
- `services/oracle-worker/` — separately configured Oracle processes, registry fixtures,
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
bank, auditor, and Oracle services. The R2 profile uses LevelDB. Archived
profiles also use CouchDB. Go chaincode enforces
MSP membership, certificate role attributes, asset ownership, and the complete
policy-to-settlement and policy-to-benefit state machines. The Next.js server accesses the ledger
through Fabric Gateway; browsers never hold Fabric private keys.

## Getting started

Use the [scenario cookbook](docs/scenario-cookbook.md) for the retained R2
demonstration. From the repository root, with the retained artifacts and a
production build prepared offline, start the stack.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Start
```

Open `http://127.0.0.1:3219/workspace`. The supervisor starts the retained
peers, shared ccaas, signed-source processes, three workers and production
web app. Use `Status` and `Stop` on the same script. A read-only inspection
uses `Start -ReadOnly` and keeps Oracle event consumption and source publishing off.

The earlier November alignment candidate has its own
[startup and browser rehearsal](docs/candidate-demonstration.md).
The commands below describe separate development/network setup, not a procedure
to repeat against preserved ledgers.

The local Fabric network is implemented under `network/`. From Ubuntu WSL:

For the separate legacy CouchDB stack, supply `FABRIC_COUCHDB_USERNAME` and
`FABRIC_COUCHDB_PASSWORD` through the environment or the ignored
`network/compose/.env`. Its published ports bind to loopback.

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
