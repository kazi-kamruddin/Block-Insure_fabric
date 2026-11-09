# Standalone CI repair — 9 November 2026

The failed pull-request and push runs for commit `b80f55825d0150b99ed025b09abffac6d3f8f667`
represent two failing jobs executed twice. Go and research jobs passed. GitHub's
job metadata identified the failing steps as Oracle tests and the web dependency
audit; the standalone build was skipped after the audit failure.

## Causes and scoped changes

The Oracle parity test imported a sibling Solidity checkout that does not exist
in a Fabric-only checkout. An isolated reproduction produced 25 passing tests
and one `MODULE_NOT_FOUND` failure. It now uses five Fabric-owned synthetic input
cases and committed reference outputs with source hashes. Full normalized-record,
feature-observation and inference-result comparisons remain, including explanation
additivity. Expected values were checked against the read-only reference pipeline
during development; executable tests never resolve those reference paths. No
cross-repository test command, source generator or optional fallback was added.
Frozen model bytes, thresholds and evaluator identity are unchanged.

The existing hybrid dataset CLI also assumed an ignored imported reference tree.
It now requires an explicit `--input=<JSONL dataset>`. Regression assertions cover
the missing-input error and successful generation using a temporary local dataset.
Existing historical datasets, experiments and reports were retained.

The live npm audit reproduced critical/high findings in the locked web tree.
Updated versions are Next.js, `@next/env` and `eslint-config-next` 16.4.5;
Zod 4.6.7; Vitest 5.1.0 with its updated test-tool dependencies. React and Fabric
Gateway versions are unchanged. The full audit remains enabled at its original
high-severity threshold; development dependencies are included. No forced major
downgrade, audit suppression or assertion removal was used. The workflow now also
checks the frozen evaluator manifest explicitly.

A read-only Git checkout-filter reproduction also showed that the usual Windows
`core.autocrlf=true` setting changed byte-hashed model/source files. Explicit
`.gitattributes` rules now preserve those bytes. Both Windows-style and unchanged
checkout filtering reproduce all ten protected dependency/adapter hashes. No
frozen asset or evaluator regeneration was needed.

Relevant upstream advisories: [Next.js](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[Vitest](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), and
[test-tool dependency](https://github.com/advisories/GHSA-698v-4r3x-3vcv).

## Verification and limits

Verification used a fresh Fabric-only source copy on Windows with Node 22.23.4.
It contained no sibling checkout, imported reference tree, private environment
file or enrolled identities. These are local results, not a new GitHub Ubuntu run.

| Check | Result |
| --- | --- |
| Fresh locked dependency installation, `npm ci` | PASSED |
| Web lint, typecheck, event-worker executable checks | PASSED |
| Web unit/cryptographic tests | PASSED, 96 tests; one local worker to respect memory limits |
| Standalone production build | PASSED, Next.js 16.4.5 |
| Oracle source and frozen evaluator checks | PASSED |
| Oracle tests without a sibling checkout | PASSED, 27 tests; no skipped tests |
| Full `npm audit --audit-level=high` | PASSED; zero critical/high, eight moderate dependency entries remain |
| Offline browser journeys against the clean build | PASSED, 8 tests, including encrypted recovery at 320px |
| Updated GitHub pull-request/push checks | UNTESTED until the owner commits and pushes this patch |
| New live Fabric/chaincode deployment | UNTESTED and unnecessary for these CI-only changes; no deployment performed |

The remaining moderate dependency entries originate in the ESLint/minimatch
chain and remain visible in the audit report. This is not a zero-vulnerability
claim. Earlier security and full alignment acceptance findings retain their
separate dispositions; this repair does not establish clinical validity or
preserved-channel readiness.

Original failures, clean-copy source hashes, individual logs and audit JSON are
kept in ignored local evidence under `.local-reference/alignment-2026-11-08/ci-*`.
The security installation initially hit an npm 10 peer-resolver exception; using
a temporary npm 11 installer resolved it, and the resulting lockfile passed a
fresh ordinary `npm ci`. No global npm settings were changed.

No Solidity source, ledgers, volumes, identities, ciphertext or checkpoints were
modified. No Git staging, commit, push, merge or workflow rerun was performed by
the agent. Commit and push the repair on the pull-request branch to obtain fresh
GitHub results before merging.
