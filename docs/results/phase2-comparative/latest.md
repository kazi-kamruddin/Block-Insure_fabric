# Comparative Oracle protocol benchmark

Generated 2026-09-26T17:07:09.483Z using 30 repetitions and 1000 measured operations per repetition.

| Configuration | Mean latency (µs) | Median (µs) | P95 (µs) | Trial-mean 95% CI (µs) | Mean throughput (ops/s) | Latency vs centralized |
|---|---:|---:|---:|---:|---:|---:|
| Centralized trusted verifier | 5.056 | 3.2 | 9.3 | 3.964–6.148 | 223276.475 | 1× |
| Single Oracle (1-of-1) | 17.67 | 10.3 | 38.9 | 13.54–21.8 | 68389.616 | 3.495× |
| Unanimous Oracles (2-of-2) | 24.822 | 13.5 | 49.3 | 16.268–33.376 | 51918.641 | 4.909× |
| Fault-tolerant Oracles (2-of-3) | 27.934 | 16.8 | 58.6 | 23.139–32.728 | 41071.752 | 5.525× |
| 2-of-3 with selective disclosure | 548.221 | 364.2 | 1210.7 | 471.181–625.26 | 2041.323 | 108.43× |

Scope: Oracle decision, binding, threshold, and optional selective-disclosure computation; excludes Fabric network and storage latency. Use the Caliper benchmark for ledger-level latency and throughput.
