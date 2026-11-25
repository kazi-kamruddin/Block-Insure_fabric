# Frozen adapter sensitivity

Date 2026-11-25 (Asia/Dhaka). Node v24.16.0. Evaluator 4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4.

This deterministic paired fixture varies one synthetic episode's amount and invoice timing across three history contexts. It uses the installed frozen weights, actual adapter and unchanged thresholds. Amounts are in BDT. Scores are integer model units.

60 cases yielded 12 AUTO, 28 REVIEW and 20 CONTEXT_UNAVAILABLE. Recursively inspecting 57 trees found 2 splits on ood_distance (tree 51, node 2, cut 1.14136791; tree 52, node 2, cut 1.15661597). The OOD warning threshold has no direct routing gate. The numeric OOD feature enters the trees. With every other feature held fixed, substituting zero OOD for the observed distance changed 0 integer scores and 0 routing outcomes in this grid. The counterfactual trace does not alter the frozen bundle or the actual inference result.

An additional paired fixture with six same-patient prior invoices reaches the OOD branches. Observed OOD 32.6707 follows 51:2->6, 52:2->6 and scores 37995400 (AUTO). The same tree observations at zero OOD follow 51:2->5, 52:2->5 and score 42293772 (AUTO).

| Amount BDT | Lag days | Context | Score units | Routing | OOD distance |
|---:|---:|---|---:|---|---:|
| 500 | 0 | complete | 169955715 | REVIEW | 7.7833 |
| 500 | 0 | complete-no-priors | 165616852 | REVIEW | 5.0141 |
| 500 | 0 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 500 | 1 | complete | 169955715 | REVIEW | 32.5686 |
| 500 | 1 | complete-no-priors | 165616852 | REVIEW | 32.0178 |
| 500 | 1 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 500 | 7 | complete | 145971678 | REVIEW | 221.4984 |
| 500 | 7 | complete-no-priors | 165616852 | REVIEW | 221.4162 |
| 500 | 7 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 500 | 30 | complete | 138033671 | REVIEW | 948.7161 |
| 500 | 30 | complete-no-priors | 165616852 | REVIEW | 948.6965 |
| 500 | 30 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 1000 | 0 | complete | 169955715 | REVIEW | 7.7815 |
| 1000 | 0 | complete-no-priors | 165616852 | REVIEW | 5.0105 |
| 1000 | 0 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 1000 | 1 | complete | 169955715 | REVIEW | 32.5682 |
| 1000 | 1 | complete-no-priors | 165616852 | REVIEW | 32.0173 |
| 1000 | 1 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 1000 | 7 | complete | 145971678 | REVIEW | 221.4983 |
| 1000 | 7 | complete-no-priors | 165616852 | REVIEW | 221.4161 |
| 1000 | 7 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 1000 | 30 | complete | 138033671 | REVIEW | 948.7161 |
| 1000 | 30 | complete-no-priors | 165616852 | REVIEW | 948.6965 |
| 1000 | 30 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 10000 | 0 | complete | 169955715 | REVIEW | 7.7637 |
| 10000 | 0 | complete-no-priors | 165616852 | REVIEW | 4.9669 |
| 10000 | 0 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 10000 | 1 | complete | 169955715 | REVIEW | 32.5639 |
| 10000 | 1 | complete-no-priors | 165616852 | REVIEW | 32.0105 |
| 10000 | 1 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 10000 | 7 | complete | 145971678 | REVIEW | 221.4977 |
| 10000 | 7 | complete-no-priors | 165616852 | REVIEW | 221.4152 |
| 10000 | 7 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 10000 | 30 | complete | 138033671 | REVIEW | 948.7159 |
| 10000 | 30 | complete-no-priors | 165616852 | REVIEW | 948.6963 |
| 10000 | 30 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 100000 | 0 | complete | 90846555 | REVIEW | 8.2580 |
| 100000 | 0 | complete-no-priors | 67415682 | AUTO | 5.6125 |
| 100000 | 0 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 100000 | 1 | complete | 90846555 | REVIEW | 32.6852 |
| 100000 | 1 | complete-no-priors | 67415682 | AUTO | 32.1170 |
| 100000 | 1 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 100000 | 7 | complete | 76990859 | AUTO | 221.5154 |
| 100000 | 7 | complete-no-priors | 67415682 | AUTO | 221.4306 |
| 100000 | 7 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 100000 | 30 | complete | 55107514 | AUTO | 948.7198 |
| 100000 | 30 | complete-no-priors | 67415682 | AUTO | 948.6999 |
| 100000 | 30 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 200000 | 0 | complete | 90846555 | REVIEW | 9.1606 |
| 200000 | 0 | complete-no-priors | 67415682 | AUTO | 6.8197 |
| 200000 | 0 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 200000 | 1 | complete | 90846555 | REVIEW | 32.9247 |
| 200000 | 1 | complete-no-priors | 67415682 | AUTO | 32.3498 |
| 200000 | 1 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 200000 | 7 | complete | 76990859 | AUTO | 221.5508 |
| 200000 | 7 | complete-no-priors | 67415682 | AUTO | 221.4645 |
| 200000 | 7 | incomplete | — | CONTEXT_UNAVAILABLE | — |
| 200000 | 30 | complete | 55107514 | AUTO | 948.7279 |
| 200000 | 30 | complete-no-priors | 67415682 | AUTO | 948.7078 |
| 200000 | 30 | incomplete | — | CONTEXT_UNAVAILABLE | — |

[CSV](adapter-sensitivity-2026-11-25.csv)
