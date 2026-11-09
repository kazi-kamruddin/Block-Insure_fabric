# Comparative and security evaluation

## Research questions

- **RQ1 — Cost:** What computational overhead is introduced by Oracle replication, strict-majority consensus, and selective disclosure relative to a centralized verifier?
- **RQ2 — Resilience:** Does 2-of-3 consensus preserve a correct decision when one worker is malicious or unavailable, and does it fail closed when quorum is lost?
- **RQ3 — Security:** Are identity forgery, replay, stale results, proof alteration, deadline manipulation, and appeal substitution prevented or safely contained by enforceable controls?

## Comparative experiment

`benchmarks/comparative/run-experiment.mjs` runs five configurations: centralized verification, 1-of-1, 2-of-2, 2-of-3, and 2-of-3 with selective-disclosure verification. The default design uses 30 repetitions, 1,000 measured operations per configuration per repetition, a 200-operation warm-up, nanosecond-resolution monotonic timing, and a cyclically rotated execution order to reduce ordering bias.

The output includes operation-level mean, median, and P95 latency; a 95% confidence interval calculated over independent trial means; throughput confidence intervals; process CPU time and utilization; memory deltas; raw trial summaries; and machine/environment metadata. Process CPU utilization can exceed 100% when runtime helper threads use more than one logical CPU. JSON, CSV, and Markdown reports are written under `benchmarks/comparative/reports`.

This is a controlled **protocol computation** benchmark. It measures registry assessment, request/result binding, commitment generation, threshold evaluation, and optional Merkle-proof verification. It does not represent production network capacity. The existing Hyperledger Caliper suite separately measures Fabric Gateway and ledger overhead, while the live fault matrix measures full workflow recovery time.

The Phase 2 protocol report, raw trial data, and deployed experiment are archived under `docs/results/phase2-comparative`, `docs/results/phase2-caliper`, and `docs/results/phase2-faults.json`. Run a new experiment on an otherwise idle, documented machine:

```powershell
node ./benchmarks/comparative/run-experiment.mjs --repetitions=30 --operations=1000 --warmup=200
$env:FABRIC_CHANNEL_NAME = 'insurance-phase2-20260926'
# Seed the synthetic policy once with seed-load-fixture.sh in the Fabric CLI environment.
./benchmarks/caliper/run.ps1 -RunId run1
./benchmarks/caliper/run.ps1 -RunId run2
./benchmarks/caliper/run.ps1 -RunId run3
./benchmarks/oracle-faults/run-matrix.ps1 -Repetitions 3
```

## Threat model

The machine-readable model is `benchmarks/security-evaluation/threat-model.json`. It defines the actor, attacked asset, STRIDE category, initial risk, security property, enforcing controls, expected safe outcome, automated evidence, trust assumptions, and residual risk for eight misuse cases.

The evaluation boundary includes the Oracle request, certificate-bound commitment and reveal, registry/model provenance, selective-disclosure proof, claim and appeal versioning, deadlines, and auditor fallback. It assumes Fabric MSP private keys are protected, collection policies are enforced by authorized peers, SHA-256 remains secure, and no more than one of three assigned Oracles is Byzantine.

Run the complete matrix with:

```powershell
node ./benchmarks/security-evaluation/run-evaluation.mjs
```

The runner executes attack simulations and exact Go chaincode tests, caches shared test evidence, and emits JSON and Markdown reports under `benchmarks/security-evaluation/reports`. A passing test demonstrates that the implemented control produces the declared safe outcome under the modeled attack; it does not eliminate the explicitly recorded residual risks. The Phase 2 snapshot is in `docs/results/phase2-security`.

## Interpretation boundaries

- Three registry replicas with a common Kaggle-derived origin demonstrate provenance isolation and controlled faults, not three independent real-world data providers.
- Selective disclosure hides undisclosed fields from shared world state, but it is not a zero-knowledge proof: authorized Oracle peers receive the disclosed values.
- A 2-of-3 threshold tolerates one faulty worker. Two colluding assigned Oracles remain an explicit trust-boundary failure.
- Local development-network results must be reported as reproducible prototype measurements, not production capacity estimates.
