# Candidate launcher and browser rehearsal — 10 November 2026

The maintained launcher now resumes the existing November candidate, and the
ordinary-form browser rehearsal passed. This is local thesis demonstration
acceptance for the scenarios below, not production or faultless-completion
certification. Earlier studies and the recovery/security milestone retain their
own source identities and results.

## Source and deployment

Work started with a clean Fabric tree at `08b8813` on `developement`. These
launcher, browser, evidence API and documentation changes are uncommitted. No
Solidity, Go runtime, model, operating-point, endorsement or collection change
was made during this milestone. Fabric remains independently runnable.

| Identity | Verified selection |
| --- | --- |
| Channel | `insurance-workflow-alignment-20261108` |
| Chaincode | `insurance-contract`, `1.6.3-xgb-alignment`, sequence 4, schema 15 |
| Package SHA256 | `bc2a30f5b434c73649f765a31232892941ced4f617c7f5518cf399af8457c44a` |
| Source equivalence | 25 runtime files match archive; all five installed/approved/committed package identities checked at startup |
| Builder | `block-insure/fabric-ccenv:2.5.16-go1.26.10`, unchanged |
| Evaluator | `fabric-xgb-synthetic-v1`, `4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4` |
| Frozen bundle | `e83eab8c8df7c9996471c754d352d9201ffd30246184c72cd1943c612d2ab380` |

The prior actual-binary hash remains a historical binary verification from the
recovery/security milestone, not a new binary scan here. No package was rebuilt
or activated. Preserved main/October/audit definitions were not upgraded.

## Changes and retained design

`workflow-demo.ps1` defaults to Candidate; `-Profile Historical` retains the
October launcher. Candidate Start verifies source/package, drains late historical
runtimes with the existing low-memory guard, warms only the selected package and
starts the web server, three Oracle subjects and event worker. It requires the
original private configuration; it never resets, deploys, enrolls or reseeds.
Ownership uses PID plus start time and exact container IDs. Reused PIDs and
replaced containers are preserved. Start restores the caller's environment.
PowerShell 5.1/7 record enumeration and environment removal were verified.

Two application defects were reproduced and fixed:

* Evidence registration classified definite SDK endorsement rejection and
  committed INVALID as uncertain. It now returns a visible typed 409 while
  retaining ciphertext. Unknown submission/status remains pending. The browser
  freezes the original upload bindings and offers an exact-ciphertext retry.
* Optimistic sign-in exposed controls while the role route was still changing,
  losing the first form interaction. Sign-in now loads the canonical,
  server-authorized workspace after the session cookie is set. Its intentional
  document navigation has a narrowly justified lint exemption.

The exact three-subject/2-result Oracle agreement, four assigned auditors with
3-approval/2-rejection rules, certificate/Gateway custody, private data and
separate Insurer/Bank authority remain. Appeal evidence retains the existing
`APPEAL_DOCUMENT` and committed-hash rule. Assigned current reviewers may read
authorized historical case documents; an old document's grant does not authorize
the corrected version's document. No EVM workflow was transplanted.

## Verification

Evidence root is ignored `.local-reference/demo-completion-20261110/`. Dates in
logs are UTC or host Asia/Dhaka as labeled. Windows 11 Pro, approximately 8 GB
host RAM, Docker 29.9.2/Fabric 2.5.16, Node 24.16.0 and installed Microsoft Edge
qualify live acceptance. The research/helper gate additionally used cached Node
22. Tests use one browser worker, no automatic retries, unique synthetic IDs and
the existing isolated candidate. Standalone output was rebuilt after the sign-in
fix. No measurements of platform performance or clinical accuracy are claimed.

| Gate | Disposition / evidence |
| --- | --- |
| Cold Start, app restart and readiness | PASSED; `launcher-start-first.log`, `controller-start-result.json`, `controller-repair-result.json`, timestamped private supervisor logs |
| Ready Start and caller restoration | PASSED; `launcher-ready-release.json`: same process registry, launcher returned, caller channel sentinel restored |
| Profile/PID/secret/root/environment boundaries | PASSED on Windows PowerShell 5.1 and PowerShell 7; `profile-windows-restoration.log`, `profile-pwsh-restoration.log` |
| Low-memory runtime guard | PASSED deterministic regressions; `runtime-tests.log`; live startup retained its stable sampling/guard interval |
| Detached Node helper and research/parser checks | PASSED 12 Node-reported tests on Node 22; `research-node22.log` |
| Web units | PASSED 122/122 on final application behavior; `web-tests-release.log` |
| Typecheck, lint, standalone build | PASSED; `typecheck-complete.log`, `lint-complete.log`, `build-final.log`; compilation used a 1 GiB heap cap |
| Full ordinary-form browser rehearsal | PASSED 2/2, once as a combined final batch; `browser-release/report.json`, `browser-release.log` |
| Running-server safety preflight | PASSED against actual candidate and an explicitly mocked wrong-channel response; `browser-preflight.log`. Wrong selection rejects before mutations |
| Final config with server preflight | PASSED 1/1 additional focused real upload recovery run; `browser-preflight-release/report.json`, 41.4 seconds; main business journey unchanged |
| Final offline browser suite | PASSED 11/11; `offline-release.log`, no enrolled identities, separate state, non-ledger channel and external email disabled. Pending/lost-response transport is explicitly mocked in these offline UI regressions |
| Mobile visual check | PASSED five role-form viewports at 320 px; `visual-guided-check.json`, `visual-*-guided-320.png`. API authentication was read-only setup for these additional screenshots |
| Source/archive match | PASSED; `source-package-final.json` |
| Preserved deployments and volumes | PASSED 15/15 peer/channel heads and both block hashes unchanged, all 47 volume names unchanged; `preserved-head-comparison.json`, `volume-retention.json` |
| Stop and repeated Stop | PASSED; `controller-stop-result.json`, `launcher-stopped-release.json`, `final-resource-retention.json`: five owned processes and 16 owned containers stopped, no test listeners/running containers, Docker healthy |

The two-test final batch took 9.7 minutes: actual committed upload response loss
49.4 seconds and the multi-role journey 8.7 minutes. These include browser,
cryptography, polling and application delays; they are functional journey times,
not Fabric transaction-latency measurements. Earlier failures/reruns were retained,
not combined into a success percentage. The later safety-preflight addition is
verified separately; the business journey body is unchanged.

Browser mutations used sign-in cards and visible role forms. Passive ledger reads
checked outcomes, and the old-grant/new-document denial used an authenticated API
probe. The batch verified:

* Published package terms, acquisition, Bank accounts/mandate, OTP collection of
  a queued installment, reconciliation without another debit, next EFT payment
  and a downloaded statement with exactly two payments.
* Hospital source forms/isolation, browser-encrypted invoice, downloaded and
  verified plaintext, automatic Oracle route and request-pinned model result.
* Model-only review, four assignments, primary/optional grants, actual reviewer
  plaintext while the owner was signed out, and rejection after two votes.
* Corrected appeal version 2, visible rejection of unsupported appeal document,
  denial of the old grant for the new document, stale vote denial, authorized
  historical evidence access and approval only on the third current vote.
* Underfunded Bank outcome, later funding, exactly one successful payment,
  duplicate denial with unchanged balance, and five essential role screens at
  320 px without horizontal overflow or browser page errors.
* A real upload committed before its response was discarded in the browser.
  Retry recovered the same reference/ciphertext hash, one ledger linkage, and
  the original plaintext. This fault is browser response loss, not a mock ledger.

`synthetic-ui-context-v1` chooses an unused calendar cohort from 2025 down to
2000 before inference. It preserves every historical record, adds one June 3
prior and checks a June 12 invoice. Actual pinned features must have
`providerLags=[9]`, `history_patient14=log(2)`, mandatory=false, sole
`MODEL_THRESHOLD` and frozen score 90846555. This isolates synthetic history;
it does not search scores, modify normalization or tune the threshold.

## Original failures and final disposition

| Preserved failure | Root cause / disposition |
| --- | --- |
| `evidence-outcome-before.log`, two failing assertions | Confirmed API phase classification defect; typed 409 fix, 5/5 focused units and actual negative browser outcome passed |
| `browser-first/` optional appeal document | Existing Go rule permits committed `APPEAL_DOCUMENT` only; kept rule, corrected fixture and retained a visible negative assertion |
| `browser-final/`, `model-route-comparison.json` | Repeated fixed-date fixtures legitimately increased eligible history and changed routing; preserved all records and adopted the explicit unused synthetic cohort contract |
| `browser-isolated-context/` historical document denial expectation | Current assigned reviewers legitimately retain authorized history access; retained behavior and tested the actual new-document/stale-vote boundaries |
| `browser-evidence-final/` and first focused result in `browser-final-corrected/` | Sign-in navigation raced initial controls; API-auth diagnostic passed, production login fixed, final visible-sign-in batch passed |
| `launcher-stop-apps.log` | PowerShell 5.1 returned a nested JSON array; explicit record enumeration now passes on both shells and actual Stop |
| `profile-pwsh-final-2.log` | .NET null left an empty inherited variable on PowerShell 7; explicit environment removal/restoration fixed |
| `controller-stale-pid-failure.log` | Original PID reused after host interruption; now warns and preserves the foreign process rather than adopting or blocking on it |
| `typecheck-384-failure.log` | Compiler heap cap was insufficient; serial 1 GiB compilation passed; runtime caps unchanged |
| Native Node pipe-captured PowerShell startup | FAILED transport: caller timed out despite launcher READY/exit indication; no claim that this tool-host transport is fixed. In-process supervised Start returns and is the documented acceptance boundary |
| `visual-check.log` | Local screenshot helper imported one directory too high, before any browser action; corrected helper passed. Original failure and first screenshots retained |

No original failure was overwritten. Original rejected appeal ciphertext remains
at SHA256 `22c042c5579823242e1c2d1e71434f3ebe347dbe3a1fb64c5e920be797ed0757`.
Browser File retry requires keeping that page open; unsaved Files are not promised
to survive reload. Critical saved transaction recovery remains separately
documented and verified in the preceding milestone.

## Scope boundaries

Real provider/inbox delivery is UNTESTED here; this profile explicitly disables
external email. Optional automatic scheduled collection-worker startup is UNTESTED
in this rehearsal; manual EFT is PASSED and previous worker evidence remains
historical. The Historical launcher/build pairing is UNTESTED in this milestone.
Preserved-channel activation is BLOCKED pending a reviewed plan and owner
authorization; it is unnecessary for this isolated presentation. Fresh remote CI
awaits the owner's publication. No new Go scan, performance campaign or production
backup/restore certification was run. Use the [demonstration guide](../candidate-demonstration.md)
for startup, custody, recovery and the presentation sequence.
