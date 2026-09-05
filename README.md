# Block-Insure Fabric

Block-Insure Fabric is the permissioned Hyperledger Fabric evolution of the
Block-Insure insurance platform. It retains the insurance workflows from
the Ethereum prototype—policies, claims, hospital verification, auditor
review, banking, and evidence auditability—while using organization-issued
identities and Fabric ledger controls.

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
policy-to-settlement state machine. The Next.js server accesses the ledger
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
demo sessions, role-gated workflow commands, ledger queries, and ciphertext-only
evidence storage with on-ledger integrity references. Demo authentication and
local filesystem storage are development adapters, not production identity or
object-storage implementations.
