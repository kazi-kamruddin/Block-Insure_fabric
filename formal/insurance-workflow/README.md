# Claim workflow verification

`InsuranceWorkflow.tla` models claim submission, hospital verification, threshold Oracle voting, auditor fallback, appeal versioning, authorization, and settlement. The TLC configuration fixes the research profile at three Oracles, a two-vote threshold, and two claim versions.

The executable checker explores the same bounded transition system and writes `reports/latest.json`. It checks that settlement requires authorization, authorization uses a current approval, Oracle approval requires a current 2-of-3 quorum, and an old claim version cannot approve the current version.

```bash
npm run check
```

For an independent TLC run, install the official TLA+ tools and execute:

```bash
java -cp tla2tools.jar tlc2.TLC -config InsuranceWorkflow.cfg InsuranceWorkflow.tla
```

Both commands must complete without an invariant violation before protocol changes are accepted.
