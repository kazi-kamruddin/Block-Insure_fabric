# Provider-risk advisory

The unit of analysis is one Medicare provider. The label is the source
dataset's weak `PotentialFraud` flag. The fixed hash-based provider split
has 3,403 training, 461 calibration, 415 conformal, and 1,061 test providers.
Features aggregate claims ending before 1 October 2009. The 81,451 claim
rows for test providers contain raw `InscClaimAmtReimbursed` values of
0–125,000 in source reimbursement units, transformed using `log1p` before
provider aggregation. The model uses the source scale directly.

Of the 1,061 held-out providers, 86 are weak positives (8.1% prevalence).
At 213 review slots (20% rounded up), logistic regression retrieved 63
flagged providers. Recall was 73.3% (Wilson 95% interval 63.1–81.5%)
and precision was 29.6% (23.9–36.0%). These are descriptive
binomial intervals on one fixed provider split. Beneficiaries can overlap
across splits. This benchmark supports a provider triage comparison.

The artifact exporter produces registration metadata for an advisory
candidate. A dev-lite worker can observe a SHADOW release when its local
artifact hash matches and an explicit local provider-vector catalog is
available. The observation is outside the commit/reveal payload. There
is no verified benchmark-provider to live-hospital linkage. The logistic
artifact was registered as CANDIDATE on the live dev-lite channel, and
worker SHADOW scoring was verified with an authored catalog in unit tests.
HIGH-tier promotion remains on **HOLD**.

Scope is authored synthetic worker fixtures, one host, unit-level, and
the existing retrospective weak-label dataset. The worker suite passed
31 tests. The Go suite remained at 57 tests and 24 subtests.

### Live CouchDB dev-lite follow-up

The same hash-matched artifact entered SHADOW on the isolated CouchDB
channel. For one authored hospital vector set to the artifact's feature
means, the expected model score was 34,983 on its integer 1,000,000-point
scale. The authored vector has no outcome label, so prevalence and bill
range do not apply to this pipeline check. Both active Oracle workers
logged that score for the same request. Both authoritative reveals were
XGB_AUTO under the pinned `frozen-medical-v1` release and the request
finalized in exact consensus. The advisory output stayed in worker logs.

The SHADOW transaction was
`c7c6d9035e43d5c318d138abe2a295b802b6f3b0fb028238881c2632d0764632`.
Local records are `data/dev-lite-couchdb/maintenance-shadow-setup.json`
and `data/dev-lite-couchdb/maintenance-shadow-live.json`. This is a
synthetic one-host live pipeline check with no observed patient or provider
outcomes and no HIGH-tier promotion.
