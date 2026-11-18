# Fabric synthetic challenger comparison

## Protocol fixed before the first comparison

The experiment asks whether simpler explanations or peer-relative temporal
signals help prioritize residual review on a reproducible synthetic workload.
The frozen Fabric evaluator remains the incumbent. Its shipped weights,
calibration, score units and operating point retain their existing identity.
The experiment uses Fabric's standalone adapter and generates synthetic BDT
minor units, dates, institutions and patients locally.

| Candidate | Method |
| --- | --- |
| A | Additive logistic gradient boosting with depth-one trees. Report the base margin, exact summed stump contributions by feature, and the separate calibrated score. |
| B | Depth-three gradient boosting with pairwise logistic loss within providers. Use prior episode overlap and a training-history-only peer 90th percentile with pooled fallback. Constrain the response to nondecreasing on positive peer excess and prior overlapping same-service episodes. Keep ordinary repeat counts unconstrained. |

Compare both to frozen XGBoost, rules plus seeded uniform residual selection,
a Bernoulli NB baseline over training-median binarized features, and L2
logistic regression. The NB baseline has its own trained artifact identity.
It represents a compatible statistical comparator for this cohort.
Ranking and monotonicity follow the standard pairwise and coordinate-wise
definitions. [Ranking](https://xgboost.readthedocs.io/en/stable/tutorials/learning_to_rank.html)
[Monotonicity](https://xgboost.readthedocs.io/en/stable/tutorials/monotonic.html)

Use provider-disjoint training, calibration, primary test and sealed-family
test groups. Patient and episode identifiers are unique to each provider
group. Synthetic interventions provide outcome labels. Training features
are allowlisted observable amounts and prior history. Family identifiers,
mechanical gate results, labels, future records and post-claim outcomes stay
outside the feature matrix. Current-day records are excluded from history.
The fixed sealed families use changes in short overlap and peer-relative
billing patterns. Benign repeat visits are represented in every group.

Mandatory review is applied first. Rank the remaining cases at 20% total
review capacity, rounded up to a whole claim and including mandatory cases.
Break score ties by case ID. Scores are evaluated at equal realized
workload; record the incumbent's separate frozen operating point as well.
Fix tree rounds, depth, feature order, calibration method and seed in source.
Fit a nonnegative-slope logistic calibrator for all learned baselines and
challengers using only the calibration split.

Report synthetic positive counts, provider/patient/episode counts, overlap
between splits, macro recall over positive families, precision, benign
review rate, Brier score and ten-bin calibration error. The primary
comparison is B versus frozen XGBoost on sealed-family macro recall, with a
paired 95% interval from 1,000 provider-cluster bootstrap draws. The
exploratory gate requires a gain of at least five percentage points,
interval lower bound above zero, benign review rate at most 20%, and a
Brier score within 0.02 of frozen XGBoost. Include peer-excess-only and
unconstrained-ranker ablations. This gate screens a synthetic comparison
for further study. Live Oracle authority still requires a separate
qualification and activation.

## Results on 19 November 2026

**PASSED** reproducibility and source checks. **HOLD** for live promotion.
The study used 1,056 unique synthetic patient episodes across 44 provider
clusters with zero split overlap. There were 288 training, 192 calibration,
240 primary and 336 sealed episodes. The sealed set has 56 positives, 28
per family, and 18 mandatory reviews. Its comparison uses 68 review slots.
The primary set uses 48 slots. The frozen live threshold selected 11 and
18 cases respectively and is reported separately.

| Model | Primary macro recall | Sealed macro recall | Sealed precision | Sealed benign review | Sealed residual Brier |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rules plus random | 12.3% | 14.3% | 11.8% | 21.4% | 0.143 |
| Frozen XGBoost | 20.0% | 10.7% | 8.8% | 22.1% | 0.164 |
| Bernoulli NB | 30.6% | 37.5% | 30.9% | 16.8% | 0.118 |
| Logistic regression | 50.0% | 76.8% | 63.2% | 8.9% | 0.062 |
| A. Additive boosted stumps | 62.3% | 50.0% | 41.2% | 14.3% | 0.107 |
| B. Monotonic boosted ranker | 62.5% | 66.1% | 54.4% | 11.1% | 0.081 |
| Peer excess only | 34.2% | 33.9% | 27.9% | 17.5% | 0.132 |
| Unconstrained ranker | 60.1% | 66.1% | 54.4% | 11.1% | 0.080 |

B's sealed-family gain over frozen XGBoost was 55.4 percentage points
with a paired provider-clustered interval of 35.7 to 73.2 points.
It met the prespecified synthetic gate. Logistic regression led the
sealed cohort and the unconstrained ranker tied B's macro recall there.
The test supports comparison on the intentionally constructed billing and
history patterns. The families were held out from fitting and calibration
and share the same authored generator. This run contains no external fraud
labels or independent population samples. Live challenger routing and
worker integration remain UNTESTED. Frozen XGBoost retains routing authority.

This offline run used Node 24.16.0 and the exact Fabric evaluator identity
`fabric-xgb-synthetic-v1`, hash
`4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4`.
The challenger artifact hash is
`1bc58b5db36a73bf07a5333c139c2ba085236f13a409b7e60bb0f9ac08cc1f67`.
The report records cohort hashes and actual counts, calibration errors,
bootstrap bounds and other workload results. The maximum stump explanation
additivity error was `2.67e-15` margin units. Nested split order validated
the ranker's monotonic constraints. Fresh training reproduced all three
artifact files byte for byte and a separate process replayed 144 integer
scores exactly. The first run failed monotonicity validation because the
right subtree lost an ancestor's upper bound. Passing that inherited bound
fixed the trainer and the original assertion passed.

Retained local evidence is under `.local-reference/ml-challengers-20261119/`.
`first.log` contains the original failure and `final/results.json` contains
the measured comparison. `source-manifest.json` binds the benchmark files,
the Git base, the cohort identities and the frozen evaluator. To reproduce
the results from the Fabric root, choose a new evidence path.

```powershell
node --test benchmarks/ml-challengers/challengers.test.mjs
$run = ".local-reference/ml-challengers-$(Get-Date -Format yyyyMMdd-HHmmss)"
node benchmarks/ml-challengers/evaluate.mjs --run $run
node benchmarks/ml-challengers/evaluate.mjs --replay $run
```
