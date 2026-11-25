# Challenger shadow replay at a fixed panel budget

Date 2026-11-25 (Asia/Dhaka). Node v24.16.0. Promotion **HOLD**.

The unit is one synthetic target episode from the existing provider-disjoint held-out cohorts. The primary split has 40/240 injected positives and target bills of BDT 338.96–1,025.00. The sealed split has 56/336 injected positives and target bills of BDT 301.34–1,025.00. Both have 16.7% positives before frozen routing. Training, calibration, primary and sealed data use the existing generator and seed 11926. The frozen input adapter divides BDT minor units by 10,000,000.

The frozen evaluator fabric-xgb-synthetic-v1 has hash 4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4. The archived challenger artifact is verified by the existing shadow worker loader against hash 1bc58b5db36a73bf07a5333c139c2ba085236f13a409b7e60bb0f9ac08cc1f67. The original model and review gate are unchanged.

## Allocation

Preserve every frozen referral. The fixed total budget is 20% of the original split, rounded up. Allocate the remaining slots separately for each ranker, only among frozen-cleared episodes eligible for shadow scoring. Rank by descending integer score with case ID as the tie-breaker. The equal-budget comparator spends the same slots on the same pool using frozen scores. An incremental detection is a referred case with a generator-positive label. A benign referral is a referred generator-negative case.

| Split | Providers | Episodes | Positives | Existing referrals | Cleared positives | Cleared benign | Total budget | Additional slots | Cleared cases excluded by shadow eligibility |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 10 | 240 | 40 | 11 | 39 | 190 | 48 | 37 | 0 |
| sealed | 14 | 336 | 56 | 18 | 55 | 263 | 68 | 50 | 0 |

| Split | Residual ranker | Added detections | Added benign referrals | Detection delta vs frozen-score extension | Benign delta vs frozen-score extension | Total detections | Total benign referrals |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | Frozen-score extension | 7 | 30 | 0 | 0 | 8 | 40 |
| primary | Additive boosted stumps | 24 | 13 | 17 | -17 | 25 | 23 |
| primary | Monotonic boosted ranker | 24 | 13 | 17 | -17 | 25 | 23 |
| sealed | Frozen-score extension | 5 | 45 | 0 | 0 | 6 | 62 |
| sealed | Additive boosted stumps | 27 | 23 | 22 | -22 | 28 | 40 |
| sealed | Monotonic boosted ranker | 36 | 14 | 31 | -31 | 37 | 31 |

## Reproducibility and limits

- primary cohort SHA-256 0281a1fd224e5cf6c1ef4f030c362f419093eae7ac5fc2443682b919d4d07643
- sealed cohort SHA-256 f614732a4722d2e7eb86ba095998bc9b40ffaf28f601753b0d0a4896c0563c76

Rerun from the Fabric root with `node benchmarks/challenger-replay/run.mjs --date 2026-11-25`. The default input is the retained `.local-reference/ml-challengers-20261119/final/models.json`. If the retained archive is unavailable, use the [existing deterministic fitting instructions](../fabric-ml-challengers.md) to reproduce it, then pass its `models.json` path with `--artifact`.

The replay measures selection on authored synthetic labels. It gives no estimate of real-patient fraud detection, field prevalence or live clinical workload. Filled residual slots simulate additional panel referrals. The challengers remain diagnostics outside Oracle quorum and settlement authority.
