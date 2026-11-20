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
is no verified benchmark-provider to live-hospital linkage. The logistic
artifact was registered as CANDIDATE on the live dev-lite channel, and
worker SHADOW scoring was verified with an authored catalog in unit tests.
HIGH-tier promotion remains open. No challenger was added.

Scope is authored synthetic worker fixtures, one host, unit-level, and
the existing retrospective weak-label dataset. The worker suite passed
31 tests. The Go suite remained at 57 tests and 24 subtests.

### Live CouchDB dev-lite follow-up

The same hash-matched artifact entered SHADOW on the isolated CouchDB
channel. For one authored hospital vector set to the artifact's feature
means, the expected score was 34,983 units. Both active Oracle workers
logged that score for the same request. Both authoritative reveals were
XGB_AUTO under the pinned `frozen-medical-v1` release and the request
finalized in exact consensus. The advisory output stayed in worker logs.

The SHADOW transaction was
`c7c6d9035e43d5c318d138abe2a295b802b6f3b0fb028238881c2632d0764632`.
Local records are `data/dev-lite-couchdb/maintenance-shadow-setup.json`
and `data/dev-lite-couchdb/maintenance-shadow-live.json`. This is a
synthetic one-host live pipeline check with no observed patient or provider
outcomes and no HIGH-tier promotion.
