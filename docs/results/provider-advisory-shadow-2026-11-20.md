# Provider-risk advisory

The fixed provider-disjoint benchmark includes 1,061 held-out providers
and 86 weak positives. At 213 review slots logistic regression retrieved
63 positives. Recall was 73.3% (Wilson 95% interval 63.1–81.5%)
and precision was 29.6% (23.9–36.0%). These are descriptive
binomial intervals on one fixed split. They do not account for residual
beneficiary overlap or demonstrate claim-level performance.

The artifact exporter produces registration metadata for an advisory
candidate. A dev-lite worker can observe a SHADOW release when its local
artifact hash matches and an explicit local provider-vector catalog is
available. The observation is outside the commit/reveal payload. There
is no verified benchmark-provider to live-hospital linkage, so no live
registration or HIGH-tier promotion path was exercised. No challenger
was added.

Scope is authored synthetic worker fixtures, one host, unit-level, and
the existing retrospective weak-label dataset. The worker suite passed
31 tests. The Go suite remained at 57 tests and 24 subtests.
