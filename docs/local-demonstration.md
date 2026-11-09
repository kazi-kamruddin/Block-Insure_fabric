# Local six-organization demonstration

## Guarded low-memory startup

`scripts/low-memory-network.ps1 Start -CoreOnly` now drains delayed historical
chaincode launches during a bounded observation window after each peer starts.
It requires at least 40 seconds of observation and 15 quiet seconds, plus at
least 128 MiB of guest MemAvailable, before adding load. Each delayed unwanted
runtime resets the quiet interval. `Status -CoreOnly` fails if chaincode runtimes
are present; it does not silently stop them. Docker commands time out rather
than waiting indefinitely when its API is unhealthy.

Use `-EvidencePath <local-ignored-file.jsonl>` to record container/memory samples.
Only runtime names for the five configured Fabric peers are eligible for cleanup.
Stopped containers, packages, ledgers, identities and volumes are retained. On a
startup failure, only newly started core services are stopped; pre-existing
services are preserved. CAs are left stopped when existing enrollments suffice.

Selected-runtime startup accepts `-ChaincodeVersion <version>`; install/deploy
the package on an explicitly selected channel separately. No launch command is
permission to upgrade a preserved channel. Later intentional queries of older
application deployments can launch their runtimes again, so recheck Status before
a memory-intensive campaign. The guard is bounded startup verification, not an
always-running process monitor. Keep compilers and network startup separate.

Run `./scripts/test-fabric-runtime.ps1` for deterministic late-start, timeout,
memory-floor and resource-selection regressions without Docker or ledger writes.

For the November candidate deployed only to its isolated alignment channel, use the
[candidate contract and isolated verification guide](frozen-xgboost-alignment.md).
The wrapper below deliberately selects the older preserved workflow deployment;
it does not activate the new evaluator or new transaction methods.

This runbook demonstrates the permissioned insurance journey using the local
InsurerMSP, HospitalMSP, AuditorMSP, BankMSP, and OracleMSP business network plus
the development orderer. It assumes the documented
WSL2, Docker Desktop, Fabric, Go, and Node prerequisites are already available.

## Current workflow rehearsal (6 October 2026)

From the repository root, use `./scripts/workflow-demo.ps1 Start` and open
`http://localhost:3000/workspace`. The wrapper selects the isolated
`insurance-workflow-20261005` channel and keeps the low-memory runtime. Check
it with `./scripts/workflow-demo.ps1 Status`; stop the managed application with
`./scripts/workflow-demo.ps1 Stop`. The earlier 1.4.1 hardening instructions
below document the previous research rehearsal.

`Start` is safe to rerun: it keeps an already healthy workflow running, or
restarts the managed web and workers if any dependency is down. It retains the
Fabric ledger and enrolled identities. Use `http://localhost:3000`, not
`127.0.0.1`, for interactive sign-in.

The channel starts with the published `showcase-health-v1` package, Bank
accounts, partner agreements, and five sample invoices dated for the local
demonstration day. Their patient reference is `policyholder1`. Hospital staff
may create a fresh invoice in the Hospital Billing Registry using that patient
reference, a unique invoice reference, a treatment reference, an amount, and
admission/discharge dates. Finalization creates a private invoice credential
automatically; voiding an invoice revokes its automatic credential.

For the customer journey, sign in as Policyholder One, acquire
`showcase-health-v1`, and use the one-time premium payment panel to activate
the policy. A Bank officer can separately review an EFT mandate. Submit a
claim with a finalized Hospital invoice ID, an amount no greater than
the invoice amount for the successful path, and an incident date within both
policy coverage and the Hospital stay. Describe the case in your own words. The invoice patient
reference must identify `policyholder1`.

Sign in as Insurer Administrator and choose **Start claim processing** for the
submitted claim. The three Oracle workers compare Hospital invoice facts;
the admin does not issue a preliminary matching verdict. Two matching
positive results approve the claim. An amount greater than the invoice total
produces an Oracle failure that the insurer can route to assigned auditors.
After an auditor rejection, Policyholder One may submit one corrected appeal;
the insurer starts a new Oracle cycle. For an approved claim, the insurer
authorizes settlement and the Bank officer confirms the payout.

The three Oracle workers use replicas derived from the same Hospital records.
Their agreement demonstrates quorum behavior and does not establish three
independent clinical sources. The dated Phase 1/2 research results below refer
to their original contract versions.

## 1. Confirm the network and contract

**Current-source note (2 October 2026):** the archived 1.4.0 package differs
from current `oracle.go` and `privacy.go`. A successful `Preflight` or an existing
1.4.0 definition does not establish that the later privacy hardening is live.
`deploy-chaincode.sh` now audits the existing package when the same version is
already committed and fails if it differs from current source. Use an
isolated channel and a new chaincode version, then audit package/source equality
before demonstrating current-source revocation or finalization behavior. The
2 October live startup attempt stopped at a peer timeout followed by Docker/WSL
errors. A later manual web/three-Oracle start reached ready health and passed
read-only browser smoke checks; it did not exercise current-source ledger writes.
Consult `.project-context/03_CURRENT_STATE.md` for the dated check.

**Current supervisor setup (3 October 2026):** the isolated
`insurance-phase2-hardening-20260927` channel ran audited then-current-source
chaincode 1.4.1-hardening. All 17 steps of the full gate and a private-collection
access probe passed there. The managed app and workers ran on
that channel at **`http://localhost:3000/showcase`** on 3 October; the current
workflow rehearsal uses the separate channel above. Use `localhost` in the browser: local
`APP_ORIGIN` is `http://localhost:3000`, so interactive sign-in from
`127.0.0.1:3000` fails the exact-origin check. The corrected showcase was checked
in Edge at desktop and phone widths. See
`docs/results/hardening-live-20261003.md` for the verification record.

### Low-memory restart on this 8 GB Windows host

The full 17-service `network.sh up` path checks the older main channel and can
launch three legacy chaincode versions on every peer. For a supervisor display
of the already deployed hardening channel, use the preserved-state Windows path
below from the repository root. It starts the orderer, five CouchDBs, five peers,
and the five current hardening runtimes in stages, stopping legacy runtimes as
they appear. The six CAs stay stopped because the demo identities are already
enrolled. No channel, volume, identity, or evidence file is removed.

```powershell
.\scripts\low-memory-network.ps1 Start
$env:FABRIC_CHANNEL_NAME = 'insurance-phase2-hardening-20260927'
$env:ORACLE_STATE_ROOT = Join-Path (Get-Location) 'data/oracle-hardening'
$env:EVENT_PROJECTION_ROOT = Join-Path (Get-Location) 'data/events-hardening'
$env:EVIDENCE_STORAGE_ROOT = Join-Path (Get-Location) 'data/evidence-hardening'
.\scripts\demo-stack.ps1 Start -ExistingNetwork -LowMemory
.\scripts\demo-stack.ps1 Status
```

`low-memory-network.ps1 Status` checks that the 11 transaction services and five
current chaincode runtimes are running and no legacy runtime remains. The web
and worker health endpoints then check the actual Gateway and Oracle path.
`demo-stack.ps1 Stop -ExistingNetwork` stops managed app processes while
retaining Fabric. Start the baseline Oracle profile again after any fault demo.
For a code rebuild on Windows, stop the managed app first, run `npm run build`
from `apps/web`, then start the stack again; the running standalone server locks
`.next/standalone`. The public catalog on `/` now reads the active channel at
request time, so rebuilding does not capture old main-channel data.
This profile cannot enroll new identities until the CAs are started. Do not use
`network.sh verify` during the low-memory presentation: it checks the old main
channel and can restart legacy runtimes. The prior full-topology and package
audit remain separate dated evidence; this profile must pass its own health and
live workflow checks.

Do not omit the channel variable when restarting: local `.env.local` defaults to
the older `insurance-channel` 1.4.0 definition. `Stop -ExistingNetwork` stops
only managed app processes and keeps Fabric and both channel ledgers. For a
short read-only evidence route, sign in as **Insurer Administrator**, choose
**Export claim dossier**, and use these verified IDs:

| Story | Claim ID | Expected result |
| --- | --- | --- |
| Exact Oracle agreement | `oracle-claim-success-1790963976036-156657` | `SETTLED`, `EXACT_CONSENSUS`, no review |
| Negative Oracle result | `oracle-claim-negative-1790964023922-422178` | `SETTLED`, `NEGATIVE_RESULT`, one review |
| Divergent Oracle result | `oracle-claim-conflict-1790964210145-643870` | `SETTLED`, `CONFLICT`, one review |

These are synthetic test assets on the hardening channel. Use unique IDs for
any new live transaction. Host available memory was low during verification;
close unnecessary applications and avoid running the full gate during the talk.

Ubuntu WSL later recovered without a configuration change. It had intermittently
timed out with `Wsl/Service/0x8007274c` while Windows had roughly 0.5–0.9 GiB
available memory and seven old experiment chaincode containers were running.
After those seven containers were stopped, repeated Ubuntu commands, normal
preflight, and `network.sh verify` passed. Resource pressure is a plausible
cause, but the exact timeout cause is unproven. For a quick check from PowerShell:

```powershell
wsl.exe -d Ubuntu -- /bin/echo WSL_OK
$env:FABRIC_CHANNEL_NAME = 'insurance-phase2-hardening-20260927'
.\scripts\low-memory-network.ps1 Status
.\scripts\demo-stack.ps1 Preflight -ExistingNetwork -LowMemory
.\scripts\demo-stack.ps1 Status
```

If Ubuntu times out again, check Windows available memory and the number of
running experiment chaincode containers. The current-channel low-memory path
above can use the Windows Docker CLI without Ubuntu. Preserve the main 1.4.0
ledger and all core container volumes for any later baseline verification.
`wsl --shutdown`
also stops Docker Desktop's WSL distribution, so first stop the demo gracefully
and use that global reset only when a Docker interruption is acceptable.

When all 17 core Fabric containers are already running but Ubuntu WSL cannot
start, use the supervisor's existing-network path for the **baseline** demo:

```powershell
.\scripts\demo-stack.ps1 Preflight -ExistingNetwork
.\scripts\demo-stack.ps1 Start -ExistingNetwork
.\scripts\demo-stack.ps1 Status
# After the presentation:
.\scripts\demo-stack.ps1 Stop -ExistingNetwork
```

This validates the running container set and starts the web, event, banking,
and three Oracle processes without invoking WSL. `Stop -ExistingNetwork` leaves
Fabric containers and ledger volumes running. The option cannot create a
channel, deploy changed chaincode, or substitute for the current-source live
verification gate.

From Ubuntu WSL at the repository root:

```bash
bash network/scripts/network.sh up
bash network/scripts/network.sh verify
```

The commands above check the preserved **baseline** channel. The hardening
channel has already been created, deployed, audited, and live-tested as recorded
above. Do not reuse the preserved 1.4.0 definition for current-source claims.

The verifier should report 17 healthy services, six reachable CAs, five ready
CouchDB instances, all five peers joined to `insurance-channel`, all three Oracle
identities enrolled, chaincode `insurance-contract` 1.4.0, and schema version 14.

## 2. Start the supervised application stack

The normal start path is non-destructive and never replaces ledger data:

```powershell
.\scripts\demo-stack.ps1 Preflight
.\scripts\demo-stack.ps1 Start
.\scripts\demo-stack.ps1 Status
```

It supervises the standalone Next.js application, durable event worker,
automatic premium-collection worker, and all three Oracle workers. `Stop` stops application services and Fabric containers while
retaining ledger volumes; add `-KeepNetwork` to leave Fabric running.

The default `-OracleScenario Baseline` gives exact positive/negative agreement.
After stopping only the managed processes with `Stop -KeepNetwork`, use
`Start -OracleScenario Conflict` for the tracked divergent Oracle 2 snapshot or
`Start -OracleScenario Oracle2Unavailable` for one-worker tolerance, or
`Start -OracleScenario QuorumUnavailable` for a deliberate timeout. No source or
private-key edit is required during the presentation.

Only after deliberately approving loss of the local development ledger, create a
clean showcase with the small policy/benefit/Oracle catalog and no old claims:

```powershell
.\scripts\demo-stack.ps1 CleanBootstrap -ConfirmReset
```

The command refuses to reset anything unless `-ConfirmReset` is present.
It clears only this project's generated Fabric identities/channel/ledger volumes
and ignored evidence, event, Oracle cursor/health, and supervisor state before
seeding; tracked source and `reference/` are untouched.

### Manual alternatives

From Windows PowerShell in `apps/web`, prepare `.env.local` from `.env.example`,
set a local `AUTH_SECRET` of at least 32 characters, and enable demo authentication.
Then use either development mode:

```powershell
npm run dev
```

For automatic event catch-up, configure the same `EVENT_WORKER_SECRET` in the
web and worker environments, then start a second terminal in `apps/web`:

```powershell
npm run events:sync
```

Use `npm run events:sync -- --once` when only a pre-demonstration catch-up is
needed. Stop the continuous worker with Ctrl+C.

For unattended EFT mandates, configure the same `BANKING_WORKER_SECRET` in the
web and worker environments. The supervised stack starts it automatically; a
manual development terminal can run:

```powershell
npm run banking:collect
```

Use `npm run banking:collect -- --once` for one idempotent business-date cycle.
The worker asks chaincode to materialize due mandate obligations, then performs
each BDT debit/credit. Its deterministic ledger work items survive restarts.

or the deployable standalone build:

```powershell
npm run build
$env:HOSTNAME = "127.0.0.1"
$env:PORT = "3000"
npm run start
```

Open `http://localhost:3000/workspace`. Fabric certificates and private keys
remain server-side throughout the demonstration.

## Presentation board and presenter route

Open `http://localhost:3000/showcase` before entering a role workspace. The board
summarizes the five institutional boundaries and the three proof stories that
anchor the demonstration. Every workspace then provides a presenter guide with
the current authority, intended proof, next handoff, and direct jumps to its
overview, operations, transaction, and ledger-evidence sections.

Use this compact presenter route:

1. **Insurer** — establish the partner network, package, and policy.
2. **Hospital** — create and finalize an invoice in the independent register.
3. **Policyholder and Bank** — demonstrate OTP or EFT premium execution, including
   the insufficient-funds bounce boundary when useful.
4. **Policyholder, Insurer, and Oracles** — submit the claim, cross-check the
   Hospital invoice, and show the exact commit/reveal outcome.
5. **Auditors** — use the fixed-quorum path only for negative, conflicting, or
   timed-out Oracle results.
6. **Insurer and Bank** — authorize the resulting liability and confirm payment,
   then close on the linked ledger asset or exported statement.

For a short overview, remain on the presentation board and explain identity,
organizational authority, failure behavior, and audit proof. For the full
demonstration, follow the role handoff above and use each workspace's highlighted
journey stages as the speaking cue.

## 3. Complete the governed journey

Use unique IDs for every rehearsal. The guided forms hash sensitive references
inside the browser and convert BDT values to exact integer poisha.

1. **Insurer Administrator** — create active Hospital and Bank agreements, create
   a package, configure its partner network, publish it, and issue a policy to
   `policyholder1`. The issued policy snapshots those partner IDs.
2. **Hospital Officer** — use the visually separate Hospital billing register to
   create and finalize an invoice. This workspace does not expose insurer claims,
   clinical evidence, Oracle operations, reviews, or settlement actions. Each
   finalized register change publishes an immutable `registry-hospital-vN`
   Oracle snapshot containing hash-only verification records.
3. **Policyholder One** — submit a claim against that policy and bind it to the
   finalized Hospital invoice. In the evidence
   panel, provide the claim/evidence IDs, choose a small original document, enter
   and safely retain a passphrase, encrypt in the browser, then store the
   ciphertext reference. Create an expiring/use-limited grant for a specific
   organization, role, certificate subject, and retrieval purpose.
4. **Insurer Administrator** — cross-check the claim against the contracted
   Hospital's invoice using agreement-scoped read access. The amount, incident
   date, Hospital, invoice status, and clinical reference must match. Then record
   the transparent advisory fraud assessment,
   then request 2-of-3 Oracle verification with the newest `registry-hospital-vN`
   snapshot prepared by the dashboard, `model-v1`,
   assigned subjects `oracle1`/`oracle2`/`oracle3`, threshold `2`, and future commit/reveal deadlines.
5. **Three Oracle services** — independently consume the committed request,
   query their own registry snapshots, submit salted commitments, and reveal only
   after the commit phase. Show identities, sources, progress, and latency in the
   Oracle operations panel.
6. **Automatic success path** — use the `11…11` registry lookup and matching claim
   description to demonstrate exact positive consensus. The claim becomes
   `APPROVED`; the insurer then authorizes settlement and BankMSP confirms it.
7. **Failure/fallback path** — use the `22…22` lookup and matching negative record.
   Both Oracles agree on `RECORD_INVALID`, producing `ORACLE_FAILED`. The insurer
   routes that request into a new four-auditor review with immutable assignments,
   quorum thresholds, and a deadline.
8. **Independent Auditors One through Four** — inspect assigned claim/evidence
   and cast certificate-bound `APPROVE` or `REJECT` votes. Three approvals or two
   rejections finalize the default 3-of-4 review; duplicate votes are rejected.
9. **Policyholder One** — if the manual review rejects the claim, submit the
   single permitted appeal after the Hospital finalizes the corrected invoice.
   The insurer cross-checks that invoice and requests fresh, version-bound Oracle
   verification. Only Oracle failure goes to a new auditor quorum; prior votes
   are never erased.
10. **Insurer Administrator** — authorize a settlement for an approved claim.
11. **Bank Officer** — confirm the authorized settlement using an external payment
   reference; only its browser-generated hash is written to the ledger.
12. **Policyholder One** — read the claim and confirm its final state is `SETTLED`.
13. **Insurer Administrator or an assigned Independent Auditor** — list evidence access records
   and show the immutable role/purpose trail created by retrievals. Enter the
   claim ID in **Export claim dossier** to download the consolidated JSON artifact.
14. **Insurer Administrator** — synchronize committed Fabric events. Show the
    transaction-aware checkpoint and role inbox, then open the thesis dashboard
    and download its reproducibility-hashed JSON snapshot.

After synchronization, open the Bank portal's **Customer delivery monitor**.
Each committed transfer result, mandate decision, and benefit payment has one
replay-safe communication record with `DEMO`, `DELIVERED`, or `FAILED` state.
Production delivery uses `EMAIL_GATEWAY_URL`; OTP values never appear here.

Each account is redirected to its canonical role workspace and cannot navigate
into another role's route. Chaincode independently rechecks MSP and certificate
attributes even if the application boundary is bypassed.

## 4. Run the reproducible integrity gate

Create the separate experiment channel from Ubuntu WSL once with
`bash network/scripts/create-phase1-channel.sh`. From the repository root in
Windows PowerShell:

```powershell
.\scripts\demo-stack.ps1 Stop -KeepNetwork
.\scripts\verify-phase1.ps1
.\scripts\demo-stack.ps1 Start
```

Stop the managed application processes while retaining Fabric before the gate.
This lets Next.js replace its standalone build on Windows and gives Playwright
exclusive Oracle ports for the baseline, divergent-snapshot, and unavailable-
Oracle phases. The verifier fails early with this instruction if those ports are
occupied; restarting afterward reopens the supervisor-ready Baseline stack.

This runs lint, TypeScript, unit and cryptographic tests, dependency audit,
event-worker syntax validation, Oracle worker tests and health, standalone production build, Go chaincode tests,
live Fabric topology/schema
verification, role isolation, WCAG 2.1 AA checks, encrypted evidence
round-trip/access logging, multi-auditor appeal adjudication, automatic Oracle
settlement, negative-result auditor fallback, isolated conflict and timeout
fallbacks, and the existing multi-session workflows.
The ignored result is written to `verification-results/latest.json`, including
the commit/branch, dirty-tree flag, selected gates, runtime versions, and timings.

The browser workflow creates uniquely named records on
`insurance-phase1-20260926`. It does not write to the preserved
`insurance-channel`. Both channels use the same development peers and orderer;
do not point this harness at shared or production state.
