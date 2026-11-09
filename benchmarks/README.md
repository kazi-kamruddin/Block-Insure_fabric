# Reproducible performance and fault experiments

`caliper/run.ps1` generates a credential-path-safe network profile and runs Hyperledger Caliper 0.7.1 against the live Fabric network. It reports read/write latency, throughput, and success rate, including comparable 1-of-1, 2-of-2, and 2-of-3 threshold rounds.

`oracle-faults/run-matrix.ps1` runs the live end-to-end profiles for normal consensus, negative consensus, one unavailable worker, conflicting replicas/model versions, and quorum timeout. It writes elapsed time and pass/fail status to `oracle-faults/reports/latest.json`; each run uses an isolated `reports/artifacts/<run-id>` directory so Playwright traces cannot collide across profiles or repeated Windows runs.

Run these after deploying schema 14 and building the web application. For the
Oracle matrix, set `FABRIC_CHANNEL_NAME=insurance-phase1-20260926` and separate
`ORACLE_STATE_ROOT`, `EVENT_PROJECTION_ROOT`, and `EVIDENCE_STORAGE_ROOT`
directories as shown in `scripts/verify-phase1.ps1`; the matrix writes ledger
records and should use the experiment channel:

```powershell
./benchmarks/caliper/run.ps1
./benchmarks/oracle-faults/run-matrix.ps1
```

`comparative/run-experiment.mjs` is a controlled protocol microbenchmark. It compares centralized verification, 1-of-1, 2-of-2, 2-of-3, and privacy-bound 2-of-3 verification over 30 balanced repetitions. It reports mean, median, P95, 95% confidence intervals, throughput, CPU time, and memory deltas as JSON, CSV, and Markdown. It deliberately excludes Fabric network/storage latency; use Caliper for that layer.

`security-evaluation/run-evaluation.mjs` executes the structured STRIDE-informed threat model. Every threat is linked to an attack simulation, an exact chaincode enforcement test, or both, and produces machine-readable coverage and safe-outcome metrics.

```powershell
node ./benchmarks/comparative/run-experiment.mjs
node ./benchmarks/security-evaluation/run-evaluation.mjs
```
