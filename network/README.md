# Block-Insure local Fabric network

This directory owns the tracked configuration and lifecycle scripts for the
local Block-Insure Fabric network. It is intentionally separate from the
application and chaincode source.

## Development topology

The initial local topology contains a dedicated ordering organization and four
business organizations:

| Organization | MSP ID | Responsibility |
|---|---|---|
| Orderer | `OrdererMSP` | Development Raft ordering service |
| Insurer | `InsurerMSP` | Policy, claim, and insurer administration |
| Hospital | `HospitalMSP` | Hospital claim verification |
| Auditor | `AuditorMSP` | Manual-review decisions |
| Bank | `BankMSP` | Settlement/EFT status confirmation |

Each business organization starts with one peer, one Fabric CA, and one
CouchDB state database. The shared application channel is
`insurance-channel`.

## Local tooling

Official Fabric samples, Linux CLI binaries, and Docker images are installed
locally under `network/.fabric/`. This directory is ignored by Git. Generated
identities, channel artifacts, ledgers, and databases are also ignored.

On this Windows host, execute Fabric Bash scripts through the Ubuntu WSL
workspace link at:

```text
/home/vengeance/workspaces/block-insure-fabric
```

The link points to this repository; it does not copy or move project files. It
avoids path-space handling defects in some official Fabric sample scripts.

## Lifecycle commands

Run the lifecycle script from the repository's WSL workspace link:

```bash
cd -L /home/vengeance/workspaces/block-insure-fabric
bash network/scripts/network.sh up
bash network/scripts/network.sh status
bash network/scripts/network.sh verify
bash network/scripts/network.sh down
bash network/scripts/network.sh reset
```

- `up` bootstraps a missing network or restarts an existing stopped network
  without replacing its ledger state.
- `status` lists containers and each peer's joined channels.
- `verify` checks all 14 containers, five CAs, four CouchDB instances, the
  orderer channel, and each peer ledger. When chaincode is committed, it also
  checks version `0.6.1` on all four peers and evaluates schema version `5`.
- `down` stops and removes containers while retaining identities, channel
  artifacts, and Docker ledger volumes.
- `reset` is destructive: it removes this network's containers, ledger
  volumes, generated identities, and generated channel artifacts.

The launcher uses the Linux Docker CLI when its WSL socket is available and
falls back to Docker Desktop's `docker.exe` integration when necessary.

Host ports are `7051`, `8051`, `9051`, and `12051` for the four peers;
`7054`, `8054`, `9054`, `12054`, and `11054` for the CAs; and `5984`, `6984`,
`7984`, and `8984` for CouchDB. Credentials embedded in Compose are strictly
local development defaults and must not be reused outside this disposable
network.

Never commit local certificates, private keys, wallets, generated channel
artifacts, or database state.

## Chaincode lifecycle and smoke verification

With the network running, deploy the Go contract and exercise its live workflow:

```bash
bash network/scripts/deploy-chaincode.sh
bash network/scripts/smoke-workflow.sh
```

The deployment script installs and approves the package for all four business
organizations before committing the definition. Four separately enrolled auditor
identities exercise a 3-of-4 approval quorum. The smoke script asserts a final
`SETTLED` claim, an advisory fraud assessment that cannot decide the claim,
an active premium-funded policy, a completed collection, and a paid benefit
liability. Bump `CHAINCODE_VERSION` whenever source changes. The script uses
sequence 1 on a clean channel, detects an already-committed version, and chooses
the next sequence for a new version; `CHAINCODE_SEQUENCE` remains an explicit
override for controlled recovery.
