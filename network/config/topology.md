# Local network topology

## Purpose

This is the initial thesis-development topology. It demonstrates distinct
business authorities without claiming production high availability.

```text
                         OrdererMSP
                    orderer.blockinsure.test
                                │
                        insurance-channel
      ┌─────────────────┬───────┼────────┬──────────────────┐
      │                 │       │        │                  │
 InsurerMSP       HospitalMSP AuditorMSP BankMSP
 peer0.insurer    peer0.hospital peer0.auditor peer0.bank
 CouchDB          CouchDB        CouchDB       CouchDB
 Fabric CA        Fabric CA      Fabric CA     Fabric CA
```

## Identity convention

Each Fabric CA will enroll its own peer and organization administrator. The
Insurer CA will also issue the initial managed development identities for
policyholders. Certificates carry a `role` attribute, and chaincode will
validate both the caller MSP and that attribute.

| Identity class | MSP | Required role attribute |
|---|---|---|
| Insurer administrator | `InsurerMSP` | `insurerAdmin` |
| Claim officer | `InsurerMSP` | `claimOfficer` |
| Policyholder | `InsurerMSP` | `policyholder` |
| Hospital officer | `HospitalMSP` | `hospitalOfficer` |
| Auditor | `AuditorMSP` | `auditor` |
| Bank officer | `BankMSP` | `bankOfficer` |
| System worker | `InsurerMSP` | `systemWorker` |

## Data boundary

All organizations share the workflow ledger on `insurance-channel`. The
channel ledger stores only safe operational identifiers, states, hashes, and
references. Private Data Collections will be added with the insurance
chaincode only for confidential metadata that must be shared between specified
organizations. Encrypted medical documents and encryption keys remain off
chain.

## Development ordering model

The local network uses one Raft orderer for simplicity. This provides Fabric
ordering semantics but not orderer fault tolerance. A multi-orderer Raft
cluster is a future production concern, not a prerequisite for the thesis
development network.

## Endorsement governance

The channel application policy uses `MAJORITY Endorsement`. With four business
organizations, a valid chaincode transaction therefore needs endorsements from
three organization peers. The chaincode definition lifecycle similarly uses
`MAJORITY LifecycleEndorsement`, while the deployment script deliberately obtains
definition approvals from all four organizations before commit.

Endorsement is not the actor authorization rule. Every mutating transaction also
checks the proposal creator's MSP and CA-issued `role` attribute inside chaincode.
This combination provides cross-organization validation of deterministic state
transitions without treating any browser or Next.js role claim as authoritative.
