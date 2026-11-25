# Claim workflow verification

`InsuranceWorkflow.tla` models claim submission, hospital verification, threshold Oracle voting, auditor fallback, appeal versioning, authorization, and settlement. The TLC configuration fixes the research profile at three Oracles, a two-vote threshold, and two claim versions.

The bounded explicit-state explorer (JavaScript) writes `reports/latest.json`. It checks one reveal per assigned subject, exhaustion and timeout, current-version approval, and settlement authorization. The regression output retains the former counterexample where two conflicts and one match leave the request open for a fourth response. In the fixed model the third response closes the request.

```bash
npm run check
```

Use `node check-model.mjs --no-write` to print the same report without writing a file, or `--report <path>` to choose a destination.

From this directory, the owner-approved TLC run uses the pinned local JAR and a 512 MB heap:

```bash
java -XX:+UseSerialGC -Xmx512m -cp .cache/tla2tools.jar tlc2.TLC -config InsuranceWorkflow.cfg InsuranceWorkflow.tla
```

Dated TLC outputs belong in [docs/results](../../docs/results). The JavaScript report records the bounded explorer only.
