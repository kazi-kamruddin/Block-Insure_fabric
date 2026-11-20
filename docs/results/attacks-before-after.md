# Approval and settlement verification, 20 November 2026

Scope is synthetic, one host, and unit-level. Both full suites ran on native Go 1.26.11 with vendored dependencies. The accepted archive matched 36 runtime and module files at `8a79b9c`. The baseline used a detached worktree.

The table records defensive assertions, existing fixtures, and source review. The same-scenario before/after suite was not executed, so this does not establish comparative attack-blocking results.

| Scenario | 1.8.0 | 1.9.0 dev-lite |
| --- | --- | --- |
| Stale-version approval | Unrun | Missing current certificate rejected |
| Replay onto a corrected claim | Unrun | Unrun |
| Amount mismatch at authorization | Unrun | Rejected |
| Amount mismatch at confirmation | Unrun | Rejected |
| Double confirmation | Unrun | Second confirmation rejected |
| Mutation after authorization | Unrun | Newer episode revision rejected |
| Insurer-only registry publication | Published in existing fixture | Unscoped publication rejected in existing fixture |
| Correction loop | Unrun | One corrected version required review. Loop unrun. |
| Positive Oracle result on suspected duplicate | Unrun | Panel required |
| Inconsistent certificate amount | N/A | Rejected |
| Early vote visibility to claimant and another MSP | Open limitation from source review | Open limitation from source review |

The early-vote limitation comes from the unrestricted chaincode decision listing in both versions. No transaction-based access reproduction was performed.

The baseline suite passed 45 top-level tests and 10 subtests. The current suite went from 48 tests and 10 subtests to 50 tests and 18 subtests. Raw logs are under `.local-reference/maintenance-1.9/item-01/`. No production source, accepted network state, or Docker resources changed.
