# Research evaluation snapshot — 2026-09-19

This snapshot records one reproducible local execution of the comparative protocol benchmark and automated Oracle threat evaluation. It is evidence for the prototype implementation, not a production-capacity claim.

## Experimental environment

- Node.js v24.16.0 on Windows x64
- AMD Ryzen 5 5600H with Radeon Graphics
- 12 logical CPUs and 7.88 GB reported system memory
- 30 repetitions per configuration
- 1,000 measured operations per repetition after 200 warm-up operations
- Balanced cyclic execution order

## Comparative protocol results

| Configuration | Mean latency (µs) | Median (µs) | P95 (µs) | Trial-mean 95% CI (µs) | Mean throughput (ops/s) | Latency vs centralized |
|---|---:|---:|---:|---:|---:|---:|
| Centralized trusted verifier | 3.837 | 3.1 | 5.2 | 3.338–4.336 | 266,483.748 | 1.000× |
| Single Oracle (1-of-1) | 11.861 | 9.9 | 15.4 | 11.240–12.482 | 84,432.195 | 3.091× |
| Unanimous Oracles (2-of-2) | 15.102 | 12.8 | 19.0 | 14.778–15.426 | 65,833.537 | 3.936× |
| Fault-tolerant Oracles (2-of-3) | 18.144 | 15.6 | 21.8 | 17.764–18.523 | 54,874.663 | 4.729× |
| 2-of-3 with selective disclosure | 382.689 | 319.4 | 693.2 | 363.647–401.730 | 2,646.198 | 99.737× |

The privacy-bound configuration was 21.092× slower than non-private 2-of-3 computation in this CPU microbenchmark, but its mean cost remained below 0.4 ms. These measurements cover protocol computation only. Fabric network, endorsement, ordering, and storage costs are separately measured by Caliper.

The latest live Caliper validation completed all five rounds without failed transactions. At a fixed offered rate it recorded 20.2 TPS for the read-only 1-of-1, 2-of-2, and 2-of-3 threshold rounds, and 10.1 TPS with 0.63-second average latency for anchored registry writes.

## Threat-evaluation results

| ID | Threat | Initial risk | Safe outcome | Result |
|---|---|---|---|---|
| T01 | Single malicious Oracle | HIGH | Contained by honest majority | PASS |
| T02 | Unavailable Oracle | HIGH | Tolerated by 2-of-3 quorum | PASS |
| T03 | Conflicting/corrupted registry | HIGH | Detected and failed closed | PASS |
| T04 | Forged or unassigned identity | CRITICAL | Prevented | PASS |
| T05 | Replayed or stale result | HIGH | Prevented | PASS |
| T06 | Altered selective-disclosure proof | CRITICAL | Prevented | PASS |
| T07 | Late commitment or reveal | MEDIUM | Prevented | PASS |
| T08 | Appeal-version substitution | HIGH | Prevented | PASS |

- Safe outcomes: 8/8 (100%)
- Automated evidence coverage: 100%
- Exercised control coverage: 100%
- Unique linked chaincode tests: 5
- High residual risks: 2 — two-Oracle collusion and common-source registry error

The detailed generated reports include trial-level data, process CPU measurements, exact test output, trust assumptions, and every documented residual risk. Regenerate them using the commands in `docs/comparative-and-security-evaluation.md`.
