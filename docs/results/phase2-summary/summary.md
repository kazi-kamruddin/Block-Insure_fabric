# Phase 2 derived results

Generated 2026-09-26T18:18:54.680Z. All values below are derived from the hashed raw inputs in `summary.json`.

## Protocol computation

| Profile | Mean latency (µs) | Trial-mean 95% CI (µs) | P95 (µs) | Mean ops/s |
| --- | ---: | ---: | ---: | ---: |
| centralized | 5.056 | 3.964–6.148 | 9.3 | 223276.475 |
| oracle-1-of-1 | 17.67 | 13.54–21.8 | 38.9 | 68389.616 |
| oracle-2-of-2 | 24.822 | 16.268–33.376 | 49.3 | 51918.641 |
| oracle-2-of-3 | 27.934 | 23.139–32.728 | 58.6 | 41071.752 |
| oracle-2-of-3-private | 548.221 | 471.181–625.26 | 1210.7 | 2041.323 |

## Live browser fault profiles

| Profile | Passed | Mean whole-test time (s) | Range (s) |
| --- | ---: | ---: | ---: |
| baseline | 3/3 | 130.6 | 128.4–133 |
| negative | 3/3 | 137.5 | 136.8–137.8 |
| one-unavailable | 3/3 | 140.2 | 129–152.7 |
| conflict | 3/3 | 148.8 | 140.7–156.2 |
| timeout | 3/3 | 142.6 | 137.9–146.2 |

## Ledger-derived decision intervals

| Profile | Oracle request-to-finalization mean (range), s | Claim creation-to-observed-final-state mean (range), s | Review open-to-close mean (range), s |
| --- | ---: | ---: | ---: |
| baseline | 13.08 (13.01–13.15) | 27.59 (27.32–27.73) | — |
| negative | 12.99 (12.92–13.12) | 36.16 (35.93–36.47) | 6.58 (6.55–6.59) |
| one-unavailable | 22.65 (22.34–23.16) | 29.49 (29.01–30.04) | — |
| conflict | 16.62 (16.03–17.45) | 42.8 (40.03–46.16) | 7.35 (6.5–8.63) |
| timeout | 16.51 (16.5–16.51) | 39.97 (38.47–41.82) | 6.78 (6.49–7.02) |

## Fabric Gateway and ledger

| Round | Success | Fail | Observed send TPS | Achieved TPS, mean (range) | Caliper mean latency, s | Workload P95 range, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| schema-read | 600 | 0 | 20.2 | 20.17 (20.1–20.2) | 0.03 (0.02–0.04) | — |
| oracle-1-of-1 | 600 | 0 | 20.23 | 20.2 (20.2–20.2) | 0.027 (0.01–0.06) | — |
| oracle-2-of-2 | 600 | 0 | 20.2 | 20.2 (20.2–20.2) | 0.01 (0.01–0.01) | — |
| oracle-2-of-3 | 600 | 0 | 20.2 | 20.17 (20.1–20.2) | 0.013 (0.01–0.02) | — |
| anchored-write-5-tps | 300 | 0 | 5.1 | 5 (5–5) | 1.313 (1.14–1.56) | 1952.521–3169.052 |
| anchored-write-10-tps | 300 | 0 | 10.2 | 9.97 (9.9–10) | 0.777 (0.67–0.95) | 1125.849–2201.667 |
| anchored-write-20-tps | 300 | 0 | 20.4 | 18.5 (18–19.3) | 0.867 (0.58–1.14) | 836.954–1681.59 |
| claim-submit-5-tps | 300 | 0 | 5.1 | 4.97 (4.9–5) | 1.263 (1.22–1.31) | 2055.669–2290.611 |
| claim-submit-10-tps | 300 | 0 | 10.2 | 9.67 (9.3–9.9) | 0.9 (0.84–0.96) | 1365.179–1626.094 |
| claim-submit-20-tps | 300 | 0 | 20.37 | 18.67 (17.6–19.2) | 0.7 (0.54–0.96) | 768.361–1386.951 |
| claim-submit-40-tps | 300 | 0 | 40.37 | 24.1 (22.9–25.8) | 1.497 (1.23–1.63) | 1761.896–2320.442 |
| claim-submit-80-tps | 300 | 0 | 68.4 | 23.47 (20.1–29.1) | 2.407 (1.69–2.77) | 2323.359–3597.953 |
| claim-submit-160-tps | 300 | 0 | 135.4 | 20.83 (12–25.4) | 3.597 (2.5–5.73) | 3228.102–7767.345 |
| mixed-policy-claim-5-tps | 300 | 0 | 5.1 | 4.6 (4.6–4.6) | 0.837 (0.77–0.88) | 2334.225–2602.306 |
| mixed-policy-claim-10-tps | 300 | 0 | 10.2 | 9.73 (9.5–9.9) | 0.653 (0.61–0.72) | 2004.075–2264.055 |
| mixed-policy-claim-20-tps | 300 | 0 | 20.4 | 19 (18.7–19.2) | 0.487 (0.39–0.66) | 1140.263–1991.992 |
| mixed-policy-claim-40-tps | 300 | 0 | 40.77 | 31.33 (26.4–35.2) | 0.423 (0.33–0.5) | 806.188–1539.217 |
| mixed-policy-claim-80-tps | 300 | 0 | 81.4 | 38 (35–41.2) | 0.643 (0.59–0.74) | 1403.385–1775.357 |
| mixed-policy-claim-160-tps | 300 | 0 | 151.13 | 48.77 (44.5–53.1) | 0.63 (0.56–0.73) | 1348.583–1652.11 |

## Docker resource samples during Caliper

| Container | Samples | Mean CPU % | Max CPU % | Mean memory MiB | Max memory MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| peer0.insurer.blockinsure.test | 216 | 11.62 | 92.99 | 105.53 | 120.8 |
| orderer.blockinsure.test | 216 | 4.28 | 111.81 | 76.74 | 97.48 |
| couchdb.insurer.blockinsure.test | 216 | 12.45 | 226.83 | 32.24 | 43.24 |
| dev-peer0.insurer.blockinsure.test-insurance-contract_1.4.0-phase2-8141d7f8edeb64f819e682354c0c46dc8b312245c1f2c3ccbfb36005bab8b27c | 216 | 10.43 | 268.54 | 193.29 | 222.3 |

Security model: 8/8 expected safe outcomes passed. The synthetic common-source error produced UNSAFE_AUTOMATIC_UNDER_SYNTHETIC_SOURCE_ERROR.

Protocol operations, full browser tests, and Caliper Gateway transactions have different timing boundaries; the three Caliper runs and three browser trials per profile are local observations rather than population reliability estimates.

