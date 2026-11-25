# Machine-learning evidence for the thesis

| Evidence | Population and unit | Evaluation | Authority |
| --- | --- | --- | --- |
| Frozen evaluator reproducibility | Fabric-owned source-hashed fixtures | Exact feature and integer-score parity, pinned bundle and evaluator digest | Reproducible synthetic inference. [Alignment](../frozen-xgboost-alignment.md) |
| Challenger primary split | 240 synthetic target episodes, 10 held-out providers, 40 generator-positive labels | Equal 20% total panel budget of 48 episodes. Existing frozen referrals kept. | Offline shadow comparison. [Results](../results/challenger-replay-2026-11-25.md) |
| Challenger sealed split | 336 synthetic target episodes, 14 separately held-out providers, 56 generator-positive labels | Equal 20% budget rounded up to 68 episodes. Existing frozen referrals kept. | Offline shadow comparison. [Results](../results/challenger-replay-2026-11-25.md) |
| Evidence routing sweep | 288 synthetic diagnostic cases with balanced scenario counts | Fixed AUTO and real frozen advice at 25%, 50%, 75% and 100% panel capacity | Offline protocol experiment. [Results](../results/oracle-v2-phase3-2026-11-25.md) |

| Split | Ranker for remaining slots | Additional generator-positive referrals | Additional benign referrals | Detected positives including frozen referrals |
| --- | --- | ---: | ---: | ---: |
| Primary | Frozen score | 7 | 30 | 8/40 |
| Primary | Additive boosted stumps | 24 | 13 | 25/40 |
| Primary | Monotonic boosted ranker | 24 | 13 | 25/40 |
| Sealed | Frozen score | 5 | 45 | 6/56 |
| Sealed | Additive boosted stumps | 27 | 23 | 28/56 |
| Sealed | Monotonic boosted ranker | 36 | 14 | 37/56 |

The synthetic label defines the numerator. The panel budget defines the denominator of referral counts. Case bills are expressed in BDT and the frozen adapter converts poisha using its pinned scale. No independently labeled real-patient cohort was evaluated. No challenger was promoted.
