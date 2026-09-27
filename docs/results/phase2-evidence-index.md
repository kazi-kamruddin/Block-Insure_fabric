# Phase 2 evidence index

The experiment used the isolated `insurance-phase2-20260926` channel with `insurance-contract` version `1.4.0-phase2` and one peer in each of five local organizations. All data and bank references are synthetic. The package and peer-state audit is in [phase2-package-audit.txt](phase2-package-audit.txt). The [manifest](phase2-manifest.json) records source and fixture hashes, local environment, and before/after ledger heads. The complete interpretation is in the [paper](../paper/phase2-study.md); every table is reproducible from [summary.json](phase2-summary/summary.json) and its hashed inputs.

| Evidence | Raw artifacts | How to reproduce |
| --- | --- | --- |
| Protocol timing, 30 × 1,000 operations per profile | [JSON](phase2-comparative/latest.json), [CSV](phase2-comparative/latest.csv) | `node benchmarks/comparative/run-experiment.mjs --repetitions=30 --operations=1000 --warmup=200` |
| Exhaustive threshold states and common-source counterexample | [protocol matrix](phase2-protocol/protocol-matrix.json) | `node benchmarks/oracle-faults/run-protocol-matrix.mjs` |
| Eight security cases and exact Go tests | [JSON](phase2-security/latest.json), [report](phase2-security/latest.md) | `node benchmarks/security-evaluation/run-evaluation.mjs --output=docs/results/phase2-security` |
| Fifteen live browser journeys | [trial index](phase2-faults.json), linked Playwright logs under `artifacts/20260926T170729871Z/` | `./benchmarks/oracle-faults/run-matrix.ps1 -Repetitions 3` with the Phase 2 channel configured |
| Ledger decision intervals | [filtered ledger export](phase2-live-ledger.json) | `bash benchmarks/oracle-faults/export-live-ledger.sh` in the Fabric CLI environment |
| Three Caliper load repetitions | [run 1](phase2-caliper/run1.log), [run 2](phase2-caliper/run2.log), [run 3](phase2-caliper/run3.log); matching HTML reports, resource JSONL and per-worker latency JSON under `phase2-caliper/` | Set `$env:FABRIC_CHANNEL_NAME='insurance-phase2-20260926'`; run `./benchmarks/caliper/run.ps1 -RunId run1`, then `run2`, then `run3` |
| Preserved-ledger isolation | [before](phase2-preserved-ledgers-before.txt), [after](phase2-ledgers-after.txt) | `bash network/scripts/get-ledger-state.sh insurance-channel insurance-phase1-20260926 insurance-phase2-20260926` in the Fabric CLI environment |
| Exclusions and corrections | [record](phase2-exclusions.md) | Read alongside load results |

The Caliper fixture is one synthetic active policy and one finalized invoice. The offered-rate sweep is a local Gateway benchmark and is separate from full browser journeys. Logs include an invalid-invoice pilot and an interrupted corrected attempt, both excluded from the three complete repetitions as described in the exclusion record. The reference article's publisher abstract was available; its full text was unavailable, so mechanism-level novelty is unresolved.
