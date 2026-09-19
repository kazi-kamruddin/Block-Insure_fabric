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
 InsurerMSP       HospitalMSP AuditorMSP BankMSP       OracleMSP
 peer0.insurer    peer0.hospital peer0.auditor peer0.bank peer0.oracle
 CouchDB          CouchDB        CouchDB       CouchDB   CouchDB
 Fabric CA        Fabric CA      Fabric CA     Fabric CA Fabric CA
```

## Identity convention

Each Fabric CA will enroll its own peer and organization administrator. The
Insurer CA will also issue the initial managed development identities for
policyholders. Certificates carry a `role` attribute, and chaincode will
validate both the caller MSP and that attribute.

| Identity class | MSP | Required role attribute |
|---|---|---|
| Insurer administrator | `InsurerMSP` | `insurerAdmin` |
| Policyholder | `InsurerMSP` | `policyholder` |
| Hospital officer | `HospitalMSP` | `hospitalOfficer` |
| Auditor subjects `auditor1`–`auditor4` | `AuditorMSP` | `auditor` |
| Bank officer | `BankMSP` | `bankOfficer` |
| Oracle services `oracle1` and `oracle2` | `OracleMSP` | `oracle` plus unique `subjectId` |

## Data boundary

All organizations share the workflow ledger on `insurance-channel`. The
channel ledger stores only safe operational identifiers, states, hashes, and
references. Encrypted medical documents and encryption keys remain off chain.
One deliberately narrow collection, `bankInsurerPrivateData`, shares Bank account
token hashes and simulated balances only between BankMSP and InsurerMSP peers.
Public account state retains masked display and ownership metadata. Hospital,
Auditor, and Oracle peers receive only the public hashes and transfer outcomes.

## Development ordering model

The local network uses one Raft orderer for simplicity. This provides Fabric
ordering semantics but not orderer fault tolerance. A multi-orderer Raft
cluster is a future production concern, not a prerequisite for the thesis
development network.

## Endorsement governance

The channel application policy uses `MAJORITY Endorsement`. The insurance
chaincode overrides this with an explicit two-of-five organization policy so
ordinary workflow transactions remain practical while retaining cross-organization
validation. Writes to `bankInsurerPrivateData` use the stricter collection-level
`AND('BankMSP.peer','InsurerMSP.peer')` policy. The definition lifecycle uses
`MAJORITY LifecycleEndorsement`, while the deployment script deliberately obtains
definition approvals from all five organizations before commit.

Endorsement is not the actor authorization rule. Every mutating transaction also
checks the proposal creator's MSP and CA-issued `role` attribute inside chaincode.
This combination provides cross-organization validation of deterministic state
transitions without treating any browser or Next.js role claim as authoritative.
