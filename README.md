# Block-Insure Fabric

Block-Insure Fabric is the permissioned Hyperledger Fabric evolution of the
Block-Insure insurance platform. It retains the insurance workflows from
the Ethereum prototype—policies, claims, hospital verification, auditor
review, banking, and evidence auditability—while using organization-issued
identities and Fabric ledger controls.

## Project status

The original five implementation areas and the policy/premium/benefit expansion
are complete for a local thesis and supervisor-demonstration release. The
four-organization network, Go contract, Next.js Gateway boundary, role-specific
workflows/evidence, release verification, policy acquisition, premium collection,
bank mandates, governed benefits, distributed adjudication, appeals, and advisory
fraud triage, governed evidence grants, durable event projection, and
ledger-derived research metrics run end to end against `insurance-contract`
0.6.1, schema 5.

This is not a production deployment claim. Institutional authentication,
durable encrypted object storage and key recovery, multi-node/orderer high
availability, production monitoring, backup/restore operations, and deployment
governance remain environment-specific work outside the local release.

## Workspace layout

- `network/` — local Fabric topology, channel configuration, and lifecycle scripts.
- `chaincode/insurance-contract/` — insurance domain chaincode and its tests.
- `apps/web/` — Next.js web application.
- `fabric/` — server-side Gateway, identity, and ledger integration modules.
- `services/` — off-chain document, fraud-scoring, and external-system adapters.
- `docs/` — architecture, role model, and implementation notes.
- `scripts/` — shared developer automation.
- `tests/` — cross-component tests.

`reference/` contains the prior Ethereum implementation for local study only.
It is deliberately ignored by Git and must not be modified or committed as part
of this Fabric project.

## Implemented architecture

The local network models separate organizations for the insurer, hospital,
bank, and auditor, backed by Fabric CAs and CouchDB. Its Go chaincode enforces
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

The application provides process and live-ledger health routes, signed local
demo sessions, role-specific dashboards and guided transactions, ledger queries,
and browser-encrypted evidence storage with on-ledger integrity/access records. Demo authentication and
local filesystem storage are development adapters, not production identity or
object-storage implementations.

See [the lifecycle design](docs/policy-premium-benefit-lifecycles.md) for policy,
OTP, collection-worker, reconciliation, and benefit boundaries;
[the local demonstration runbook](docs/local-demonstration.md) for the
five-organization journey and [the evidence security boundary](docs/evidence-security.md)
for the AES-GCM envelope, authorization path, and production limitations. The
[adjudication design](docs/distributed-adjudication.md) documents assignment,
quorum, timeout, appeal, and fraud decision-support boundaries. See the
[operations and research design](docs/event-driven-operations-and-research.md)
for Fabric event checkpointing, notification projection, evidence grants, and
reproducible thesis metrics.

## Complete verification

With Docker Desktop and the Fabric network running, execute every code, network,
security, browser, and live-workflow check from Windows PowerShell:

```powershell
.\scripts\verify-all.ps1
```

The command writes an ignored machine-readable summary to
`verification-results/latest.json`. Its browser phase creates uniquely named
local ledger records and proves role isolation plus the full settlement path.

GitHub Actions also runs locked Next.js lint/type/unit/audit/build checks and
native Go format/vet/tests on pushes and pull requests. The live Fabric/browser
gate remains local because it depends on this repository's four-organization
Docker network and enrolled development identities.
