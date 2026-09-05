# Insurance contract

This Go chaincode owns the shared, permissioned insurance ledger for
`insurance-channel`.

## Current transaction flow

1. An `InsurerMSP` identity with `role=insurerAdmin` creates and publishes a
   policy package, then issues a policy whose terms are snapshotted.
2. The policy owner, an `InsurerMSP` identity with `role=policyholder`, submits
   a claim and immutable evidence references. Only SHA-256 hashes and safe
   metadata are placed on the shared ledger; medical documents remain
   off-chain.
3. A `HospitalMSP` identity with `role=hospitalOfficer` verifies or invalidates
   the claim.
4. The insurer starts review and an `AuditorMSP` identity with `role=auditor`
   records the decision.
5. The insurer authorizes settlement and a `BankMSP` identity with
   `role=bankOfficer` confirms the bank reference.

The initial review model deliberately uses one auditor decision per claim. A
multi-auditor quorum can be introduced later without weakening this state
machine.

Money is represented as signed 64-bit integer minor units. Dates use
`YYYY-MM-DD`; ledger timestamps come from the Fabric transaction timestamp.
Deterministic composite-key list queries are available for packages, policies,
claims, evidence references, and settlements; the application applies its
policyholder ownership filter before returning collections.

Successful evidence retrievals are separately committed as
`EvidenceAccessRecord` assets. The contract permits the owning policyholder,
the insurer administrator, a hospital officer in the claim verification path,
and an auditor after review starts. Bank identities cannot retrieve clinical
evidence. Claims link their hospital-verification and auditor-decision records
for audit navigation.

## Test

Go does not need to be installed on the host:

```bash
bash chaincode/insurance-contract/scripts/test.sh
```

The script runs formatting checks, `go vet`, unit tests, and contract metadata
validation in an isolated official Go container.

## Deploy

With the local network running:

```bash
bash network/scripts/deploy-chaincode.sh
```

The lifecycle script packages and installs the contract on all four peers,
collects all four organization approvals, commits it to `insurance-channel`,
and queries the committed definition from each peer.
