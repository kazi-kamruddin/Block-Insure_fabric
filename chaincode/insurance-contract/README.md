# Insurance contract

This Go chaincode owns the shared, permissioned insurance ledger for
`insurance-channel`.

## Current transaction flows

1. An `InsurerMSP` identity with `role=insurerAdmin` creates and publishes a
   policy package, then issues a policy whose terms are snapshotted.
2. The policy owner, an `InsurerMSP` identity with `role=policyholder`, submits
   a claim and immutable evidence references. Only SHA-256 hashes and safe
   metadata are placed on the shared ledger; medical documents remain
   off-chain.
3. A `HospitalMSP` identity with `role=hospitalOfficer` verifies or invalidates
   the claim.
4. The insurer records optional advisory fraud triage and requests verification
   from exactly two assigned `OracleMSP` certificate subjects. Each independently
   commits then reveals a registry/model/version-bound result. Exact positive
   consensus approves the claim; negative, conflict, or timeout routes through an
   explicit transaction into a review round with immutable auditor assignments,
   thresholds, and a deadline. Four distinct
   `AuditorMSP` certificate subjects support the default 3-of-4 approval / 2-of-4
   rejection quorum. A rejected claimant may submit one appeal, which creates a
   new review round without replacing the original votes.
5. The insurer authorizes settlement and a `BankMSP` identity with
   `role=bankOfficer` confirms the bank reference.

The policyholder can also acquire published coverage in `PENDING_PAYMENT`,
designate beneficiaries, request a bank mandate, authorize a manual OTP payment,
and request configured death/surrender/maturity benefits. Bank-confirmed premiums
activate or reinstate coverage; insurer lifecycle processing applies grace,
lapse, expiry, cancellation, and renewal rules. Scheduled collections, receipt
replay markers, append-only reversals, explicit funding gates, and claim/benefit
liabilities preserve the external-fiat audit trail without putting account
numbers or real BDT on-chain.

Fraud assessments are explainable, versioned, and strictly advisory: there is no
transaction path from a fraud score to a claim decision. Review votes are unique
per auditor subject and round; timeout finalization and appeal processing retain
the complete adjudication history.

Money is represented as signed 64-bit integer minor units. Dates use
`YYYY-MM-DD`; ledger timestamps come from the Fabric transaction timestamp.
Deterministic composite-key list queries are available for every policy, banking,
benefit, claim, evidence, and liability asset; the application applies its
policyholder ownership filter before returning collections.

Successful evidence retrievals are separately committed as
`EvidenceAccessRecord` assets. The contract permits the owning policyholder,
the insurer administrator, a hospital officer in the claim verification path,
and an auditor assigned to the current review. Policyholders can additionally
create revocable, expiring, use-limited `EvidenceAccessGrant` assets scoped to
one organization, role, certificate subject (or explicit wildcard), evidence
item, and purpose. Chaincode binds purposes to role semantics and records grant
provenance on every use. Bank identities cannot retrieve clinical evidence.
Claims link verifications, review rounds, decisions, appeals, fraud assessments,
access records, and settlements for audit navigation.

The Oracle-capable target definition is `insurance-contract` 0.7.0 with schema
version 6 and an automatically resolved lifecycle sequence. The preserved local
definition remains 0.6.1 sequence 9/schema 5 until an explicitly approved clean
Oracle topology bootstrap is performed.

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

The lifecycle script packages and installs the contract on all five peers,
collects all five organization approvals, commits it to `insurance-channel`,
and queries the committed definition from each peer.
