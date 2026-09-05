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

Each business organization will start with one peer, one Fabric CA, and one
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

## Lifecycle safety

The future `network/scripts/` commands will distinguish between:

- `up` — start a stopped network without deleting data;
- `down` — stop containers while retaining generated local state where safe;
- `reset` — explicitly destructive removal of generated identities, ledgers,
  channel artifacts, and local database data; and
- `status` — read-only health and channel inspection.

Never commit local certificates, private keys, wallets, generated channel
artifacts, or database state.
