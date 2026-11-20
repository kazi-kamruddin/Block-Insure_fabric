# Block-Insure local Fabric network

This directory owns the tracked configuration and lifecycle scripts for the
local Block-Insure Fabric network. It is intentionally separate from the
application and chaincode source.

## Development topology

The local topology contains a dedicated ordering organization and five business
organizations:

| Organization | MSP ID | Responsibility |
|---|---|---|
| Orderer | `OrdererMSP` | Development Raft ordering service |
| Insurer | `InsurerMSP` | Policy, claim, and insurer administration |
| Hospital | `HospitalMSP` | Hospital claim verification |
| Auditor | `AuditorMSP` | Manual-review decisions |
| Bank | `BankMSP` | Settlement/EFT status confirmation |
| Oracle | `OracleMSP` | Three certificate-bound registry-verification services |

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
bash network/scripts/network.sh reset --confirm-reset   # destructive; explicit approval only
```

- `up` bootstraps a missing network or restarts an existing stopped network
  without replacing its ledger state.
- `status` lists containers and each peer's joined channels.
- `verify` checks all 17 containers, six CAs, five CouchDB instances, the
  orderer channel, and each peer ledger. When chaincode is committed, it also
  checks version `1.4.0` on all five peers, evaluates schema version `14`, and
  confirms all three Oracle service enrollments.
- `down` stops and removes containers while retaining identities, channel
  artifacts, and Docker ledger volumes.
- `reset --confirm-reset` is destructive: it removes this network's containers,
  ledger volumes, generated identities, and generated channel artifacts. A bare
  `reset` is refused. `scripts/demo-stack.ps1 CleanBootstrap -ConfirmReset` is
  the supervised wrapper.

The `verify` defaults (`1.4.0`, schema `14`) describe the preserved main
`insurance-channel`. They are not the current candidate. Other channels have
their own helpers: `create-*-channel.sh` for historical experiment channels,
`verify-candidate.sh` (read-only, run inside the candidate container by
`scripts/candidate-demo.ps1`), and `get-ledger-state.sh` for channel heights.

The launcher uses the Linux Docker CLI when its WSL socket is available and
falls back to Docker Desktop's `docker.exe` integration when necessary.

Host ports are `7051`, `8051`, `9051`, `12051`, and `13051` for the five peers;
`7054`, `8054`, `9054`, `12054`, `13054`, and `14054` for the CAs; and `5984`, `6984`,
`7984`, `8984`, and `10084` for CouchDB. Credentials embedded in Compose are strictly
local development defaults and must not be reused outside this disposable
network.

Never commit local certificates, private keys, wallets, generated channel
artifacts, or database state.

## Dev-lite profiles

`network.sh --dev-lite ACTION` and `network.sh --dev-lite-couchdb ACTION`
delegate to `dev-lite.sh`. They run a separate five-peer network on
`insurance-dev-lite-190`. Ports are in the `31xxx` range, bound to `127.0.0.1`,
and identities and state live under `data/dev-lite*/`. The plain profile uses
LevelDB, and `--dev-lite-couchdb` adds isolated CouchDB volumes. Actions are
`up`, `deploy`, `verify`, `ca-start`, `ca-stop`, `stop`, and `teardown`.
`teardown` needs `--confirm-dev-lite` or `--confirm-dev-lite-couchdb`. Only one
orderer project may run at a time. `bash network/scripts/test-dev-lite.sh` is
the offline regression for this dispatcher.

## Chaincode lifecycle and smoke verification

With the network running, deploy the Go contract and exercise its live workflow:

```bash
bash network/scripts/deploy-chaincode.sh
bash network/scripts/smoke-workflow.sh
```

The deployment script installs the package and obtains all five organizations'
approval of the definition, including its collection configuration, before
commit. Membership in `bankInsurerPrivateData` itself remains limited to
BankMSP and InsurerMSP. `oracleProofPrivateData` is limited to HospitalMSP,
InsurerMSP, and OracleMSP and carries salted credential fields and selective
presentations; shared world state receives only roots and proof metadata.
Four separately enrolled auditor
identities exercise a 3-of-4 approval quorum. The smoke script asserts a final
`SETTLED` claim, an advisory fraud assessment that cannot decide the claim,
an active premium-funded policy, a completed collection, a paid benefit
liability, Bank/Insurer PDC isolation and balance movement, and a chaincode-
verified evidence Merkle proof. Bump `CHAINCODE_VERSION` whenever source changes. The script uses
sequence 1 on a clean channel, detects an already-committed version, and chooses
the next sequence for a new version; `CHAINCODE_SEQUENCE` remains an explicit
override for controlled recovery. Deployment also refuses to run unless every
peer selects the digest-pinned patched builder from `chaincode-builder/`. Start
the peers with `FABRIC_CHAINCODE_BUILDER` set to that image. Volumes are
preserved.

`bash network/scripts/seed-showcase.sh` idempotently creates one published policy
package, its benefit plan, and the canonical Oracle registry commitment. On a
clean ledger it creates no policies, claims, reviews, or Oracle requests.
