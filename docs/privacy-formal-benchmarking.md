# Privacy-preserving verification, formal safety, and benchmarks

## Privacy protocol

Schema 14 adds two issuer-bound credential types: finalized Hospital invoices
and active insurance policies. Each credential is a sorted set of salted fields.
Leaves use a length-prefixed SHA-256 domain, internal Merkle nodes use a separate
domain, and the public `PrivacyCredential` records only the root and provenance.
The complete salted credential is held in Fabric collection
`oracleProofPrivateData`, whose members are HospitalMSP, InsurerMSP, and
OracleMSP.

A policyholder can register a short-lived `SelectiveDisclosurePresentation`
for a hospital-verified claim. It reveals only invoice identity, hospital,
amount/range dates and finalized status plus policy identity, holder, coverage
limit/range dates and active status. Chaincode verifies every proof and business
constraint before binding the public presentation hash to the claim version.
Oracle workers independently repeat those checks. The Oracle result digest
binds the presentation ID, hash, and protocol version, preventing substitution
or replay across claims and appeals.

This is selective disclosure, not a zero-knowledge range proof: authorized
Oracle collection members see the disclosed claim facts. Undisclosed medical
and policy terms remain outside the presentation, and no private disclosure is
written to shared world state.

Credential revocation is checked when a presentation is registered: a revoked
invoice or policy credential cannot create a new presentation. Registration
copies the verified roots and status into an immutable presentation record.
The current `RequestOracleVerification` path checks that record's expiry, claim
ID, version, and `VERIFIED` status, but does not re-read the credential status.
Thus revoking a credential after registration does not invalidate that existing
presentation before its expiry. `RevokePrivacyCredential` is currently a
chaincode-only operation, with no web action. The demonstration must not claim
retroactive revocation or end-to-end credential lifecycle governance.

## Formal workflow safety

`formal/insurance-workflow/InsuranceWorkflow.tla` models hospital verification,
Oracle voting, manual fallback, appeal version changes, authorization, and bank
confirmation. `InsuranceWorkflow.cfg` checks the deployed 2-of-3 profile. The
companion exhaustive checker is dependency-free and writes a reproducible JSON
report:

```powershell
cd formal/insurance-workflow
npm run check
```

The checked invariants state that settlement requires prior authorization,
authorization requires a current-version approval, Oracle approval requires a
current strict-majority quorum, stale approvals cannot survive an appeal, and a
claim cannot hold contradictory final decisions. TLC can independently check
the supplied specification with the official `tla2tools.jar` command documented
in the formal README.

## Performance and fault evaluation

`benchmarks/caliper/run.ps1` uses Hyperledger Caliper 0.7.1 and generates its
network profile from current local identities without copying keys into the
repository. It compares Gateway read latency, anchored writes, and 1-of-1,
2-of-2, and 2-of-3 threshold evaluation at fixed offered loads. Caliper produces
the standard success, throughput, and latency report.

`benchmarks/oracle-faults/run-matrix.ps1` exercises complete application-to-
ledger workflows for healthy positive and negative consensus, one unavailable
worker, divergent sources/models, and loss of quorum. Each profile uses unique
assets, records wall-clock recovery time, and preserves Playwright traces on
failure. Together these separate chaincode/Gateway capacity from end-to-end
worker and deadline behavior.

Measurements describe this local single-peer-per-organization development
network. They are reproducible engineering observations, not production
capacity estimates or evidence of independent real-world data sources.
