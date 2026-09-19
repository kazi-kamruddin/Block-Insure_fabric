# Reproducible performance and fault experiments

`caliper/run.ps1` generates a credential-path-safe network profile and runs Hyperledger Caliper 0.7.1 against the live Fabric network. It reports read/write latency, throughput, and success rate, including comparable 1-of-1, 2-of-2, and 2-of-3 threshold rounds.

`oracle-faults/run-matrix.ps1` runs the live end-to-end profiles for normal consensus, negative consensus, one unavailable worker, conflicting replicas/model versions, and quorum timeout. It writes elapsed time and pass/fail status to `oracle-faults/reports/latest.json`; each run uses an isolated `reports/artifacts/<run-id>` directory so Playwright traces cannot collide across profiles or repeated Windows runs.

Run these after deploying schema 14 and building the web application:

```powershell
./benchmarks/caliper/run.ps1
./benchmarks/oracle-faults/run-matrix.ps1
```
