# Phase 2 study protocol (locked before Phase 2 runs)

## Research question and boundaries

Can an identity-bound 2-of-3 Oracle workflow maintain a correct automated decision under one unavailable or divergent worker, fail into governed review when no exact majority exists, and do so with measurable prototype cost? The implementation is a Hyperledger Fabric health-insurance prototype. A simulated bank settlement is not an external transfer. Three Oracle identities and registry replicas are controlled within one demonstration environment; their agreement does not establish independent clinical truth.

The primary comparison is against a centralized verifier, 1-of-1, and 2-of-2 *protocol computations* on the same deterministic registry record. These alternatives are not deployed claim workflows. The live-system treatment is the deployed 2-of-3 workflow on an isolated Phase 2 channel. The unit of inference for protocol timing is a trial, not each operation within a trial. Live browser runs establish observed behavior on this host and are not a production reliability estimate.

## Questions and prespecified outcomes

| ID | Question | Outcome and interpretation |
| --- | --- | --- |
| RQ1 | What cost does replication and selective disclosure add? | 30 balanced-order trials of 1,000 operations each; trial-mean latency and throughput with 95% intervals, CPU time, operation-level P95. Fabric Gateway read and committed registry-write throughput/latency at offered 5, 10, and 20 TPS is reported separately. |
| RQ2 | What happens under one unavailable worker, a divergent worker, and quorum loss? | Three live runs of each baseline, negative, one-unavailable, conflict, and timeout profile; report pass counts, observed end states and whole-test elapsed time. Exhaustive 3-worker threshold states establish logical outcomes. |
| RQ3 | Which integrity and privacy controls survive modeled attacks? | Threat-model attack simulations and exact chaincode tests, with each asserted safe outcome and residual risk. A separate common-source-error case is expected to demonstrate an unsafe majority, not a defended property. |
| RQ4 | What can this study claim relative to Tripathi et al.? | Compare only published full-text details actually inspected. Until available, use the publisher abstract for shared Fabric-insurance scope and mark mechanism-level novelty unresolved. |

## Execution and data handling

1. Record source commit, machine/runtime metadata, fixture hashes, channel name, and preserved ledger height/hash before writes.
2. Create `insurance-phase2-20260926`, deploy the current chaincode as `1.4.0-phase2`, seed required demo assets, and keep Phase 2 worker/event/evidence state separate.
3. Run the protocol microbenchmark on an otherwise idle host. Its sequential local operations exclude network and storage.
4. Run the security model and threshold state-space table. The common-source case uses an externally designated ground-truth label to expose what a quorum cannot detect.
5. Run live fault profiles serially, with a balanced cyclic order across three repetitions and unique claim IDs. Record all failures and exclusions; do not drop failed trials.
6. Run Caliper on the Phase 2 channel only, recording offered and achieved load, successes/failures and transaction latency. The existing transaction benchmark uses unique registry commitments, not the whole claim journey; browser fault trials provide journey evidence.
7. Archive raw machine-readable reports and scripts. Derive every paper table from the archived reports. Preserve the development and Phase 1 channel heights/hashes as an isolation check.

No causal inference, clinical accuracy, production throughput, independent-Oracle resilience, bank-transfer finality, zero-knowledge privacy, or relative novelty over an unread full paper will be claimed. A failed measurement remains visible in the results and limits the corresponding conclusion.

## Completion gate

Phase 2 is complete when every result in the manuscript points to a tracked artifact; the result parser reproduces tables from raw measurements; controls and common-source failure are reported together; the repository and isolated ledger are identified; and the preserved development and Phase 1 ledgers are checked for unintended writes.
