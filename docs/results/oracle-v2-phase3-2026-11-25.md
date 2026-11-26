# Phase 3 Oracle evidence experiment

Date 2026-11-25 (Asia/Dhaka). Node v24.16.0. Seed 42. Twelve paired scenarios with 24 cases per scenario give 288 cases per advice setting. The same cohort appears at every panel budget.

The Hospital payment confirmation is a signed copy derived from the invoice and belongs to the Hospital control domain. Half of these cases also contain an independent Bank-signed event contradicting the payment. The provenance-aware policy rejects the Hospital copy as independent authority and uses the Bank event when present. The accreditation-lineage stress case remains an artificial dependency test. Evidence policy still governs routing when the real frozen model is used.

## Fixed AUTO advice

The frozen worker scorer uses one synthetic observation without prior visits. It produced REVIEW advice for 0 of 288 cases in this run. The legacy shared-snapshot comparison retains its snapshot route.

The columns below show wrong automatic approvals / legitimate referrals / panel demand / unresolved at 50% panel capacity.

| Scenario | Eligible / total | v1 shared | v2 single origin | v2 multi-source | v2 provenance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Insurer snapshot altered | 0/24 | 24/0/0/0 | 0/0/24/0 | 0/0/24/0 | 0/0/24/1 |
| Hospital bill above regulator band | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/4 |
| Claimant receipt changed, including benign transcription mismatches | 12/24 | 12/0/0/0 | 12/0/0/0 | 0/12/24/0 | 0/12/24/6 |
| Inactive licence or unaccredited service | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/3 |
| One worker offline | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| One worker reads a stale mirror, with compound-fault subsets | 24/24 | 0/8/8/0 | 0/8/8/0 | 0/8/8/0 | 0/8/8/6 |
| Duplicate commitment offered by one worker | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| Consistent Hospital and claimant reports of a false amount | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 |
| Synthetic lineage stress case | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 |
| Independent payment evidence contradicts the request | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/6 |
| Clean claim | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| Hospital confirmation derived from the invoice, with or without a signed Bank event | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 0/0/24/6 |

### Panel budget sweep

Every aggregate below depends on the equal-weight synthetic scenario mix. Unresolved counts also depend on the fixed number of panel slots. Routing percentiles use the analytical schedule in seconds.

| Budget | Mode | Wrong AUTO | Legitimate referrals | Panel demand | Served | Unresolved | Conflict | Timeout | Routing p50/p95 (s) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 25% | v2-single-origin | 156 | 8 | 32 | 32 | 0 | 4 | 4 | 10/66 |
| 25% | v2-multi-source | 72 | 20 | 128 | 72 | 56 | 4 | 4 | 11/66 |
| 25% | v2-provenance-aware | 24 | 20 | 176 | 72 | 104 | 4 | 4 | 12/66 |
| 50% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 50% | v2-single-origin | 156 | 8 | 32 | 32 | 0 | 4 | 4 | 10/66 |
| 50% | v2-multi-source | 72 | 20 | 128 | 128 | 0 | 4 | 4 | 11/66 |
| 50% | v2-provenance-aware | 24 | 20 | 176 | 144 | 32 | 4 | 4 | 12/66 |
| 75% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 75% | v2-single-origin | 156 | 8 | 32 | 32 | 0 | 4 | 4 | 10/66 |
| 75% | v2-multi-source | 72 | 20 | 128 | 128 | 0 | 4 | 4 | 11/66 |
| 75% | v2-provenance-aware | 24 | 20 | 176 | 176 | 0 | 4 | 4 | 12/66 |
| 100% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 100% | v2-single-origin | 156 | 8 | 32 | 32 | 0 | 4 | 4 | 10/66 |
| 100% | v2-multi-source | 72 | 20 | 128 | 128 | 0 | 4 | 4 | 11/66 |
| 100% | v2-provenance-aware | 24 | 20 | 176 | 176 | 0 | 4 | 4 | 12/66 |

## Frozen model advice

The frozen worker scorer uses one synthetic observation without prior visits. It produced REVIEW advice for 48 of 288 cases in this run. The legacy shared-snapshot comparison retains its snapshot route.

The columns below show wrong automatic approvals / legitimate referrals / panel demand / unresolved at 50% panel capacity.

| Scenario | Eligible / total | v1 shared | v2 single origin | v2 multi-source | v2 provenance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Insurer snapshot altered | 0/24 | 24/0/0/0 | 0/0/24/0 | 0/0/24/0 | 0/0/24/1 |
| Hospital bill above regulator band | 0/24 | 24/0/0/0 | 0/0/24/0 | 0/0/24/0 | 0/0/24/4 |
| Claimant receipt changed, including benign transcription mismatches | 12/24 | 12/0/0/0 | 12/0/0/0 | 0/12/24/0 | 0/12/24/6 |
| Inactive licence or unaccredited service | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/3 |
| One worker offline | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| One worker reads a stale mirror, with compound-fault subsets | 24/24 | 0/8/8/0 | 0/8/8/0 | 0/8/8/0 | 0/8/8/6 |
| Duplicate commitment offered by one worker | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| Consistent Hospital and claimant reports of a false amount | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 |
| Synthetic lineage stress case | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 |
| Independent payment evidence contradicts the request | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/6 |
| Clean claim | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| Hospital confirmation derived from the invoice, with or without a signed Bank event | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 0/0/24/6 |

### Panel budget sweep

Every aggregate below depends on the equal-weight synthetic scenario mix. Unresolved counts also depend on the fixed number of panel slots. Routing percentiles use the analytical schedule in seconds.

| Budget | Mode | Wrong AUTO | Legitimate referrals | Panel demand | Served | Unresolved | Conflict | Timeout | Routing p50/p95 (s) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 25% | v2-single-origin | 132 | 8 | 56 | 56 | 0 | 4 | 4 | 10/66 |
| 25% | v2-multi-source | 72 | 20 | 128 | 72 | 56 | 4 | 4 | 11/66 |
| 25% | v2-provenance-aware | 24 | 20 | 176 | 72 | 104 | 4 | 4 | 12/66 |
| 50% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 50% | v2-single-origin | 132 | 8 | 56 | 56 | 0 | 4 | 4 | 10/66 |
| 50% | v2-multi-source | 72 | 20 | 128 | 128 | 0 | 4 | 4 | 11/66 |
| 50% | v2-provenance-aware | 24 | 20 | 176 | 144 | 32 | 4 | 4 | 12/66 |
| 75% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 75% | v2-single-origin | 132 | 8 | 56 | 56 | 0 | 4 | 4 | 10/66 |
| 75% | v2-multi-source | 72 | 20 | 128 | 128 | 0 | 4 | 4 | 11/66 |
| 75% | v2-provenance-aware | 24 | 20 | 176 | 176 | 0 | 4 | 4 | 12/66 |
| 100% | v1-shared | 180 | 8 | 8 | 8 | 0 | 4 | 4 | 8/65 |
| 100% | v2-single-origin | 132 | 8 | 56 | 56 | 0 | 4 | 4 | 10/66 |
| 100% | v2-multi-source | 72 | 20 | 128 | 128 | 0 | 4 | 4 | 11/66 |
| 100% | v2-provenance-aware | 24 | 20 | 176 | 176 | 0 | 4 | 4 | 12/66 |

## Live evidence

The [R1 journey record](r1-journeys-2026-11-25.md) reports the separately observed sequence-2 AUTO, panel, quorum and timeout decisions. Live results use ledger transactions and are outside the analytical cohort.

~~~powershell
node --test benchmarks/oracle-v2/harness.test.mjs
node benchmarks/oracle-v2/run-phase3.mjs --date 2026-11-25
~~~
