# Block-Insure Fabric

Block-Insure Fabric is the permissioned Hyperledger Fabric evolution of the
Block-Insure insurance platform. It will retain the insurance workflows from
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

## Planned network model

The first Fabric network will model separate organizations for the insurer,
hospital network, bank, and auditors. Application users will be represented by
certificate identities and attributes rather than browser wallets. The Next.js
server will access Fabric through Gateway; browsers will never hold Fabric
private keys.

## Getting started

This repository currently contains the initial workspace structure. The next
implementation milestone is to add the local Fabric network and the TypeScript
insurance chaincode contract.
