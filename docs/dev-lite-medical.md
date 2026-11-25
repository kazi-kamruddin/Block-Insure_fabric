# Medical development workflow

Dev-lite uses `insurance-dev-lite-190` and `data/dev-lite`. The accepted
deployment has a separate channel, package, identities and storage.

In Ubuntu/WSL, with Docker Desktop running, start the isolated profile:

LevelDB `up` and `ca-start` reuse existing service containers and their volumes.
Compose settings such as the builder image apply when a missing container is
created. Existing containers start with their stored settings.

On 21 November, a LevelDB start and stop with deliberately different rendered
peer settings preserved all 12 existing Compose container IDs and six named
volume mounts. All five peers read back the retained 1.9.0 sequence-5 ledger.
Fabric replaced its five peer-managed chaincode runtime containers during the
cycle. The accepted 1.8.0 and CouchDB profiles stayed stopped. The local evidence is
`data/dev-lite/startup-preservation-20261121/summary.json`.

```bash
DEV_LITE_CHAINCODE_BUILDER=block-insure/fabric-ccenv:2.5.16-go1.26.11 \
  bash network/scripts/network.sh --dev-lite up
DEV_LITE_PACKAGE=data/dev-lite/channel-artifacts/insurance-contract_1.9.0-schema.tar.gz \
  bash network/scripts/network.sh --dev-lite deploy
```

Use a package built from this source with the matching Go toolchain and vendor
tree. For this local run the vendor tree came from the accepted package with
SHA-256 `79132734225c138f30a3a16909981c893ba8935271568bdbee8220f1758de396`.
The staging step verified the same `go.sum` before copying the vendor files
into dev-lite. The first deployment uses sequence 1. On an existing dev-lite
channel, an upgrade requires the exact next `DEV_LITE_SEQUENCE` and an
explicit `DEV_LITE_PACKAGE`. The 20 November run committed the corrected
response-schema package at sequence 2, retaining the existing ledger.

In PowerShell, run `./scripts/dev-lite-app.ps1` and open
`http://127.0.0.1:3219/workspace`. The controller uses local demo sessions,
starts the event worker and Oracle workers, and keeps dev-lite application
data and secrets under the same profile root. The normal demo uses all three
workers. During the fault-tolerance segment, `-TwoOracles` leaves the third
worker offline. The two available workers wait about 60 seconds for the
commit deadline before revealing. With that
controller running, use `./scripts/test-dev-lite-medical.ps1` on the
activated channel. Add `-Activate` for the first rehearsal on a freshly
deployed, empty channel. The switch performs the one-time activation.

### Production-mode demonstration

Stop the application controller and the dev-lite Fabric containers, retaining
their volumes. Run `npm --prefix apps/web run build` with Fabric stopped.
Bring up the same retained LevelDB profile, then launch
`./scripts/dev-lite-app.ps1 -Production -Onboarding`. It serves the standalone
build at `http://127.0.0.1:3219` and refuses a missing or stale build. Starting
without `-Production` returns to the development server.

For an approved verification session, add `-ReadOnly`. The launcher still
starts the web app and the three Oracle health services. Oracle event
processing, Gateway submissions, automatic premium collection and the
projection/sender are disabled. Read-only startup also verifies the
Insurer peer's provisioning block before choosing local application state.
See the [R1 design](oracle-v2/R1-DESIGN.md) for the separately approved upgrade.

Run `.\scripts\dev-lite-preflight.ps1 -ClockOnly` after dev-lite starts,
before the R1 lifecycle upgrade and at the start of each later live session.
The check compares Windows UTC with the Insurer peer and fails when the
absolute difference exceeds five seconds. If it fails, stop the session.
The owner can restart Docker Desktop with Fabric stopped and repeat the check.

## Restore the pre-R1 ledger

This recovery procedure requires the owner's separate approval after an
upgrade failure. The pre-R1 backup contains all six ledger volumes and
the selected app state. Use the exact pre-R1 profile and verify every
archive before moving any state. The commands retain the displaced volume
and app data in named recovery directories. Run them only while the
LevelDB dev-lite stack is the selected network.

```powershell
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath '.').Path
$state = (Resolve-Path -LiteralPath 'data/dev-lite').Path
$backup = Join-Path $state 'backups/2026-11-25-pre-r1'
$units = 'orderer','peer-insurer','peer-hospital','peer-auditor','peer-bank','peer-oracle'
$archives = @($units | ForEach-Object { "$_.tar.gz" }) + 'app-state.tar.gz'
$seen = @()
foreach ($line in Get-Content -LiteralPath (Join-Path $backup 'SHA256SUMS')) {
    if ($line -notmatch '^([a-f0-9]{64})  ([a-z-]+\.tar\.gz)$') { throw 'Invalid manifest line' }
    $expected, $file = $Matches[1], $Matches[2]
    if ($file -notin $archives -or $file -in $seen) { throw "Unexpected archive: $file" }
    $seen += $file
    $archive = Join-Path $backup $file
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -cne $expected) { throw "Checksum failed: $file" }
    tar.exe -tzf $archive | Out-Null
    if ($LASTEXITCODE) { throw "Invalid archive: $file" }
}
if ($seen.Count -ne $archives.Count) { throw 'The backup manifest is incomplete' }
$inventory = Get-Content -Raw -LiteralPath (Join-Path $backup 'app-state-inventory.json') | ConvertFrom-Json
if ($inventory.channel -ne 'insurance-dev-lite-190' -or $inventory.sequence -ne 1) { throw 'Wrong backup identity' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/dev-lite-app.ps1 -Stop
if ($LASTEXITCODE) { throw 'App stop failed' }
wsl.exe -d Ubuntu --cd $repo --exec bash network/scripts/network.sh --dev-lite stop
if ($LASTEXITCODE) { throw 'Network stop failed' }
$running = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -or $running.Count) { throw 'Expected Docker services to be stopped' }
if (@(Get-NetTCPConnection -LocalPort 3219,3311,3312,3313,3330 -State Listen -ErrorAction SilentlyContinue).Count) { throw 'Expected app services to be stopped' }
foreach ($unit in $units) {
    $volume = "block-insure-dev-lite_$unit"
    $owner = docker volume inspect $volume --format '{{index .Labels "com.docker.compose.project"}}/{{index .Labels "com.docker.compose.volume"}}'
    if ($LASTEXITCODE -or $owner -cne "block-insure-dev-lite/$unit") { throw "Unexpected volume identity: $volume" }
}

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
$stashName = "displaced-before-pre-r1-restore-$stamp"
$appStash = Join-Path $state $stashName
New-Item -ItemType Directory -Path $appStash | Out-Null
$appPaths = 'oracle','evidence','events','journal','otp','research-findings','customers.json','customer-wallet','customer-email-codes.json','ledger-insurance-dev-lite-190.json','ledger-insurance-dev-lite-190.legacy.json','registry-archive'
foreach ($name in $appPaths) {
    $item = Join-Path $state $name
    if (Test-Path -LiteralPath $item) {
        $resolved = (Resolve-Path -LiteralPath $item).Path
        if ((Split-Path -Parent $resolved) -ne $state) { throw "Unexpected app-state location: $name" }
        Move-Item -LiteralPath $resolved -Destination $appStash
    }
}
tar.exe -xzf (Join-Path $backup 'app-state.tar.gz') -C $state
if ($LASTEXITCODE) { throw 'App-state restore failed' }
foreach ($unit in $units) {
    $volume = "block-insure-dev-lite_$unit"
    docker run --pull never --rm --network none --mount "type=volume,source=$volume,target=/ledger" --mount "type=bind,source=$backup,target=/backup,readonly" block-insure/fabric-ccenv:2.5.16-go1.26.11 bash -c 'set -e; shopt -s dotglob nullglob; stash="/ledger/$1"; mkdir -m 700 "$stash"; for item in /ledger/*; do if [[ "$item" != "$stash" ]]; then mv -- "$item" "$stash/"; fi; done; tar -xzpf "$2" -C /ledger' -- $stashName "/backup/$unit.tar.gz"
    if ($LASTEXITCODE) { throw "Volume restore failed: $volume" }
}
wsl.exe -d Ubuntu --cd $repo --exec bash network/scripts/network.sh --dev-lite up
if ($LASTEXITCODE) { throw 'Network start failed' }
& .\scripts\dev-lite-preflight.ps1 -ClockOnly
if ($LASTEXITCODE) { throw 'Peer clock check failed' }
$definitions = @(wsl.exe -d Ubuntu --cd $repo --exec bash network/scripts/read-dev-lite-sequence.sh insurance-dev-lite-190 insurance-contract)
if ($LASTEXITCODE -or $definitions.Count -ne 5 -or @($definitions | Where-Object { $_ -notmatch '^(insurer|hospital|auditor|bank|oracle) Version: 1\.9\.0, Sequence: 1$' }).Count -or @($definitions | Sort-Object -Unique).Count -ne 5) { throw 'Expected 1.9.0 sequence 1 on all five peers' }
$definitions
```

Resolve any failed restore check before restarting the app. Verify the
block-1 binding and the historical medical claims with a read-only readback.
Before a later post-2B backup, include `data/dev-lite/source-adapters/` so
the restored issuer keys and signed feeds match the public keys on the ledger.

The historical teardown uses Compose down for the entire dev-lite project,
including its CA containers. If an earlier approved rebuild removed those
containers, `network.sh --dev-lite ca-start` recreates the CA services from
retained material. Use `ca-stop` before launching the onboarding controller
so it can start its own Insurer CA. An ordinary demo retains containers and
volumes through `stop`.

### Isolated CouchDB acceptance profile

`network.sh --dev-lite-couchdb` uses the independent Compose project and
network `block-insure-dev-lite-couchdb`, data root `data/dev-lite-couchdb`,
and eleven project-owned volumes. Five CouchDB 3.3.3 services are reachable
only on that Docker network. Each peer waits for its own database health
check. The two development projects share the loopback ports and the
chaincode's dev-lite channel name, but each creates its own genesis block,
credentials, ledger and database files.

Stop the development app controller and LevelDB project before selecting
the CouchDB profile. Use the same `up` and `deploy` commands above with
`--dev-lite-couchdb` and an explicit audited package. Then run
`./scripts/dev-lite-app.ps1 -CouchDB` and
`./scripts/test-dev-lite-medical.ps1 -CouchDB -Activate` for the first
rehearsal. The browser output, keys and app state stay in the CouchDB data
root. The `stop` action retains volumes, including the existing LevelDB
ledger. Leave the accepted deployment outside this procedure.
After removing the CouchDB test volumes, archive the CouchDB profile data
root before a fresh replay so the old browser receipts, event cursors and
application journal stay linked to their original run.

1. As Insurer, activate approval certificates once. The transaction writes
   the activation point and stores the duplicate-screening key in private data.
   Every medical approval on this fresh channel requires a certificate.
2. After intake and patient association, propose a registry snapshot for the
   Hospital. The assigned Hospital officer attests the exact displayed root.
   Start processing after activation. Pending requests retain their original
   snapshot even when the next snapshot becomes active.
3. A material correction, appeal or suspected duplicate requires review.
   Hard rejection for duplicate filing is limited to the same episode
   identity. Separate but similar episodes trigger scrutiny and leave their
   private linkage outside public state.
4. The claimant may escalate a submission after 24 hours or a pending
   Oracle request after its reveal deadline. The assigned auditors can open
   escalated voting once evidence is ready. Transaction timestamps govern
   these rules. The Insurer still authorizes settlement and the Bank confirms
   it. The dev-lite gateway retains demo custody of the enrolled identities.

The provider-only experiment uses the original local CSVs and a fixed
observation cutoff. It excludes injected fields, keeps provider splits
disjoint, and measures residual beneficiary overlap. It does not supply
reimbursement approval or remove mandatory review.

```powershell
python benchmarks/provider-review/evaluate.py --raw datasets/hybrid-v1/raw --output data/dev-lite/provider-review/results.json
```

## Local verification on 20 November 2026

All five peers committed chaincode 1.9.0 at sequence 2. The package SHA-256
was `830efd3f571ba0382d6168706947f43de8ce54ce1d148a97ecf3301c4501df70`.
The browser rehearsal used two Oracle workers and produced these results.

- Routine claim `medical-ce40149f-b8bd-47e4-9019-9ac58b84da16` settled once
  for BDT 40. After a failed underfunded payment and subsequent funding, the
  browser lost the response to the successful confirmation. The journal
  recovered the committed result and rejected an extra confirmation.
- Corrected appeal `medical-bfb0ea57-241c-43d6-add7-080390f9d0b0` required
  duplicate review and obtained three fresh approval votes at version 3.
  The browser verified the settlement certificate digest and one BDT 40
  payout, then rejected a second confirmation. The same claim resumed at
  its recorded clarification and approval checkpoints after test harness
  interruptions.

Local Playwright reports are under
`data/dev-lite/medical-rehearsal/20261120-120542-8205`, in `routine`,
`appeal`, `appeal-resumed`, and `appeal-settlement`. Transaction-time
escalation was exercised in Go tests. The browser rehearsal did not wait
for the live stall deadline.

The fixed provider-disjoint Medicare test split had 1,061 providers and
86 weak `PotentialFraud` positives (8.1% prevalence). Provider features
used source reimbursement values of 0–125,000 on retained test claim rows,
then aggregated their log-transformed values. At 213 review slots,
logistic regression reached 73.3% recall and 29.6% precision. The
additive-bin model reached 70.9% recall and 28.6% precision. These are
[provider triage results](results/provider-advisory-shadow-2026-11-20.md).
Promotion remains **HOLD**.

## Operator rehearsal

Use the dev-lite workspace on port 3219 with two Oracle workers and the local
demo accounts. The browser runner creates new synthetic policies, bank
accounts, and claims and records each journey in a separate report under
`data/dev-lite/medical-rehearsal/`. It selects an unused recent service date
for the routine claim and uses that date for the appeal and duplicate fixtures.
The accepted deployment uses separate identities, application data, and ledger
state.

| Journey | What the operator should see |
| --- | --- |
| Routine payout recovery | Associate the patient, accept the reimbursement statement, attest the Hospital registry and complete Oracle verification. The medical claim timeline shows Oracle approval and asks the Insurer to authorize. On the Bank dashboard, load that settlement ID and compare the certificate digest. The test submits an underfunded payment, funds the reserve and suppresses the response to the successful confirmation. **Check saved action** recovers it. The claimant timeline shows the same certificate and one confirmed BDT 40 transfer. |
| Corrected appeal | Follow the review timeline through clarification. Grant evidence, confirm decryption as each assigned auditor and record the initial rejection. The Hospital corrects the statement and the claimant appeals. Check that the new round requires fresh evidence acknowledgements and three fresh approvals. The claimant and Bank views show the certificate for the corrected version and one confirmed payout. |
| Suspected duplicate | File another episode with the same synthetic service facts as the paid routine claim. The Oracle result supports automatic approval, but the case stays in panel review. The timeline displays the duplicate referral reason and names the Insurer as the next actor. Three auditors can approve the review and the Bank can confirm one payout against the panel certificate. |

In the claimant, Insurer and assigned auditor workspaces, enter the claim ID
under **Medical review and appeal** and select **Load medical case** to refresh
the timeline. Expand **Ledger milestones** for the transaction timestamps. In
the Bank workspace, use **Load medical settlement** with the settlement ID.
This view shows payment and approval details for that bank. It omits clinical
facts, evidence and review notes. The Insurer can download the complete claim
history and current approval certificate in **Export claim dossier**. On
dev-lite, an assigned auditor can export the medical dossier once the current
round is finalized.

These rehearsals exercise local demo custody and a pinned Oracle evaluator.
The provider-level experiment remains offline. Model promotion and hold
transitions are outside this release.

### 20 November 2026 integration results

The automated operator rehearsal passed all three journeys on
`insurance-dev-lite-190` with chaincode 1.9.0, sequence 2. Each recorded one
successful BDT 40 transfer and refused a second confirmation.

| Journey | Claim | Approval and observed outcome |
| --- | --- | --- |
| Routine recovery | `med-concurrent-c2f299ef-2f1` | `ORACLE_AUTO` at version 1. The saved action recovered the committed payout after the response was dropped. |
| Corrected appeal | `medical-070abf8e-0808-4438-9f82-3ab602e114b0` | `PANEL` at version 3. The corrected version received three fresh approval votes after the evidence checks. |
| Suspected duplicate | `medical-6f4c56bd-d55c-4aa2-9f95-bfde8c55f1a4` | `PANEL` at version 1 with no appeal. The Oracle returned `XGB_AUTO`, and the duplicate referral still required three auditor approvals. |

The local reports are under `data/dev-lite/medical-rehearsal/20261120-125308-6317`.
The routine journey resumed its existing policy and episode fixtures after
a browser refresh fired before the role workspace mounted. The appeal and
duplicate journeys each completed in one run. The browser compared the Bank
view, claimant timeline and insurer dossier against the settlement digest.
A separate read-only check confirmed that an assigned auditor could export
the finalized panel dossier and was denied access to the unassigned routine
dossier. Three focused unit tests covered expired clarification, voting,
and evidence-grant guidance. A separate human operator rehearsal remains
pending.

### 20 November 2026 maintenance integration

The isolated five-peer LevelDB deployment committed chaincode 1.9.0,
sequence 3. These are synthetic, one-host, live observations. The
accepted 1.8.0 deployment stayed untouched.

| Check | Observed outcome | Evidence |
| --- | --- | --- |
| Uninterrupted corrected appeal | `medical-e6d1d017-12e0-4889-8112-9f818afb545d` had new evidence acknowledgements and three fresh approvals at version 3. Bank confirmed one BDT 40.00 payment. The standalone verifier matched the v2 digest to a direct Insurer peer read. | Local `data/dev-lite/maintenance-seq3-appeal-final/report.json` and `data/dev-lite/maintenance-seq3-appeal-receipt.json`. |
| Claimant escalation with short deadline | `maint-escalation-ec742a664ac9` used three intentionally inactive synthetic assignments. The early request was refused. After the on-ledger reveal deadline, the claimant opened panel preparation and the Oracle request ended FAILED. | Local `data/dev-lite/maintenance-live-escalation.json`. |
| Explicit organization-pair validation | On sequence 4 only Bank + Insurer endorsed and committed both operations. The other 18 checks stopped during endorsement. | [Pair matrix and transaction IDs](results/dev-lite-endorsement-pairs-2026-11-20.md). |
| Pending release hold | The release became HELD while its request was pending. Sequence 3 refused panel preparation. After the sequence-4 fix, the same request ended FAILED with MODEL_HELD, and the current version entered panel preparation. | [Finding F13](results/FINDINGS.md) and local `data/dev-lite/maintenance-live-hold.json`. |

The appeal used the existing gateway-held demo Bank identity. It establishes
no separate signer custody, CouchDB acceptance, or clinical validity.

The audited hold correction was deployed to all five peers as sequence 4.
The lifecycle transaction was
`512e71fb8768d275429869128b5855458d3a69fc730a57bc877ce0cc2c400e6a`.
The recovered preparation committed VALID as
`7d001e87f281f03e17e81b1647da4344b70844deeb951e0443db615b8f3e27b3`.
A successor with the same installed evaluator artifact was promoted before
the rehearsal release was held.

### 20 November 2026 CouchDB acceptance

The separate CouchDB project ran the audited 1.9.0 package at sequence 1
with two Oracle workers. This was a synthetic, one-host rehearsal. Each
journey confirmed one BDT 40.00 payout. The standalone verifier checked
internal consistency of all three exported dossiers.

| Journey | Claim | Approval | Settlement |
| --- | --- | --- | --- |
| Routine recovery | `medical-3e944683-41a1-48d0-bc86-b396ca3b6da2` | ORACLE_AUTO, version 1. Recovered a committed payout after losing its response. | `med-settlement-67821fcf-fc9` |
| Corrected appeal | `medical-5b17c158-1652-4203-b3dd-4f6aa9d2c2b3` | PANEL, version 3. Fresh evidence checks and three fresh approvals. | `med-settlement-b5a250b9-4dd` |
| Suspected duplicate | `medical-9bb13fab-b6eb-477d-b441-7f7ca1b9b848` | PANEL, version 1. A positive Oracle result retained mandatory review. | `med-settlement-e841c0bf-8df` |

The three Playwright reports are under
`data/dev-lite-couchdb/medical-rehearsal/20261120-163552-6249/`. The local
`data/dev-lite-couchdb/maintenance-journeys.json` links the final
certificates and transfer IDs. These cases establish workflow acceptance
on the tested database backend. Deployment scale and real-world clinical
performance remain outside the evidence.

Teardown removed exactly the 11 volumes owned by
`block-insure-dev-lite-couchdb`. The accepted 1.8.0 containers and channel
were untouched. Docker reported the same names and sizes for all six
accepted volumes before and after. The six LevelDB development volumes
were retained.

### Rejected-claim coverage release (source, 21 November 2026)

Source after `d554f09` adds `ReleaseMedicalReservation` on this channel. A rejected medical claim keeps its reserved cover while an appeal or procedural recovery can still change it. That window is 30 days from the rejecting round's close. The claimant or insurer can return the cover at once when both paths are already used, or after the window closes. Late appeals and recoveries are refused. The Medical review panel shows the reserved amount and a **Return reserved cover to the policy** action.

On 21 November the LevelDB dev-lite channel advanced from sequence 4 to 5. Go build and vet passed. The rebuilt `insurance-contract_1.9.0-reservation-seq5.tar.gz` matched all 44 audited source files. Its SHA-256 is `03245043975c1facb582542e964f012952e8775d226726de869877fea5c0cc01`. Lifecycle transaction `f3d0944f88351a4b31a17ade8da2e210561a1414730597b71341c2a66e408908` was VALID on all five peers, and each read back version 1.9.0 with all five MSP approvals. The routine, corrected appeal, suspected duplicate and separate deadline browser rehearsals passed.

- **F01 Gateway visibility.** In an OPEN round with one vote, the holder and second auditor saw no decisions, the voting auditor saw their own vote, and the insurer could see it. The second auditor's direct decision lookup returned 403. After TIMED_OUT, all four viewers saw the vote and the direct lookup returned 200. Public ledger decisions remain outside this Gateway protection.
- **F19 coverage release.** The claimant released the timed-out claim after its one recovery was used. Insurer peer readback confirmed `UsedMinor` went from 4,000 to 0. Release transaction `2c1571d852e0aae7b0de79b6bd3d5e8b4a7cb250229ec30bac3bdd29a2f3ab42` committed in block 645. Holder and insurer notifications carried the same transaction. A second release, appeal quote and procedural recovery each returned 409.

These are synthetic, one-host LevelDB dev-lite results. The inventory had no pre-upgrade rejected medical claims, and the 30-day expiry and non-certificate F18 behavior were outside the live checks. Compose recreated the six dev-lite core containers during startup. Teardown stopped the app and dev-lite network and retained all six named ledger volumes. The accepted 1.8.0 and CouchDB profiles were untouched. See `data/dev-lite/live-check-20261121/summary.json` and `data/dev-lite/maintenance-seq5-deploy.log` for the run evidence and recovered setup errors.

### Submission closeout re-run (21 November 2026, afternoon)

This run used the committed source at `32ff6e8` with the same sequence-5 package. Before it started, all five peers read back 1.9.0 sequence 5 at height 646. `scripts/test-dev-lite-medical.ps1` passed the routine, corrected appeal and suspected duplicate journeys. Its reports are under `data/dev-lite/medical-rehearsal/20261121-084753-0812`. The separate deadline journey also passed and is under `data/dev-lite/closeout-20261121/deadline`. It left claim `medical-11cf830e-a30e-4aef-b976-70e4af3a8113` REJECTED with its recovery used. In the claimant panel this claim offers **Return reserved cover to the policy**. The release was deliberately left for the operator walkthrough.

The Insurer exported the routine claim `medical-dd367ca9-cca7-4ac1-9753-f947b14bc084`. The new read-only `network/scripts/read-dev-lite-certificate.sh` read its certificate hash `5b94b770…84d5` directly from the Insurer peer. The standalone verifier accepted the dossier against that hash and rejected an altered hash.

`MEDICAL_STOP_BEFORE_BANK=true` stops a rehearsal journey after Insurer authorization. Settlement `med-settlement-cbb65431-1ec` was staged this way and awaits Bank confirmation. With `FABRIC_DEV_LITE_BANK_CUSTODY=external`, the Gateway refused the Bank confirmation with 409 and issued the unsigned request saved at `data/dev-lite/closeout-20261121/bank-signing-request.json`. The separate-OS-account signature is an owner step in the [submission walkthrough](submission-walkthrough.md). The app and network were stopped afterwards with the six volumes retained.

## Premium flows and bank links on sequence 6 (21 November 2026)

Sequence 6 completes the customer–Bank premium path on the LevelDB dev-lite
channel. The medical rules are unchanged from sequence 5.

- **Chaincode.** A policyholder can ask a contracted Bank to link an account
  (`RequestBankAccountLink`). The Bank approves it with the private token and
  balance in transient data (`ReviewBankAccountLink`), which opens the
  verified CUSTOMER account for the requester. The policyholder can cancel a
  pending request. The Insurer can retry a bounced EFT collection up to three
  attempts (`RetryPremiumCollection`). Policy lifecycle, collection
  scheduling and queueing, mandate expiry and collection processing now
  refuse dates later than the transaction's Asia/Dhaka business date (F20,
  F21).
- **Web app.** The policyholder has **My bank and premiums**: link requests,
  linked accounts, and per-policy **Pay first premium now** / **Pay next
  installment by OTP**, which fills the OTP card, plus **Set up automatic EFT
  payment**. The Bank has **Account link requests** on its Accounts page and
  **Waiting for the Bank** on its Mandates & collections page (verify links,
  approve mandates, collect premiums, record deposits). The Insurer has **Premium
  collections and policy status** (schedule due collections, retry bounces,
  check grace and lapse). Endorsement errors now show the chaincode's reason
  (F23).
- **Operations.** `dev-lite-app.ps1 -Collections` starts the automatic
  collection worker. `-Email` starts the local Brevo connector
  (`tools/email-gateway/`). `dev-lite-preflight.ps1` is a read-only pre-demo
  check, and `stage-dev-lite-demo.ps1` prepares demo cases the evening before.

Identity and evidence:

| Item | Value |
| --- | --- |
| Package | `insurance-contract_1.9.0-premium-seq6.tar.gz`, SHA-256 `27a6b4e4ef031feae14de9d7c222a1a973891f93ec6b7e556d9c6c5e1acaf225`, label `insurance-contract_1.9.0`. All 45 packaged source files matched the working tree (`data/dev-lite/premium-20261121/package-audit.json`). Built with Go 1.26.11 in the pinned builder; `go build` and `go vet` passed. |
| Lifecycle | Sequence 6 committed VALID in transaction `898ea0eab044695e835839e89bcb8c3b3b8652474c0dfe34d684dea28719f436`. All five peers read back version 1.9.0, sequence 6, with all five approvals. |
| Backup | Before the upgrade, the six stopped volumes were archived read-only to `data/dev-lite/backups/pre-seq6-20261121-104844/` with SHA-256 sums. |
| Preservation | After the upgrade the routine claim `medical-dd367ca9-…` still read SETTLED from the Insurer peer with certificate hash `5b94b770…84d5`. |
| Offline | Go `gofmt`, `vet` and the full test suite passed in the pinned container, including four new tests. Web lint, typecheck and 145/145 unit tests passed. The worker check, TLA+ model and the email connector's 3/3 tests passed. |
| Live premium journey | `scripts/test-dev-lite-premium.ps1` passed in 1.9 minutes (`data/dev-lite/premium-journey/20261121-111226-5005`). Three link requests (two verified, one rejected), two first premiums by OTP, two mandates approved, an early schedule and a future lapse refused with 409, an automatic run that completed one collection and bounced the other with INSUFFICIENT_FUNDS, a deposit, an Insurer retry, a completed second attempt, and a mandate cancellation. |
| Medical regression | `scripts/test-dev-lite-medical.ps1` passed the routine (3.8 min), corrected appeal (10.1 min) and duplicate (3.6 min) journeys on sequence 6 (`data/dev-lite/medical-rehearsal/20261121-111444-9375`). |

Limits: synthetic data on one host. The demo Bank has no core system, so a
random vault token stands in for the account number on approval. The
collection worker and the scripted journey must not run at the same time,
because the worker may collect an installment before the scripted Bank click.
Retroactive coverage (F22) is open. The older general workflow specs that use
future dates were not re-run against this package.

## Customer onboarding (21 November 2026 onward)

On `insurance-dev-lite-190`, start the existing lab and run
`.\scripts\dev-lite-app.ps1 -Onboarding` from PowerShell. The
controller starts the existing stopped Insurer CA by container ID and stops
it when the controller exits. It adds the wallet and profile HMAC keys to the
existing app secret store when those entries are absent. The default rehearsal
uses browser-visible codes on loopback. It does not need the email connector.

An email code expires in ten minutes and allows five attempts. Resends wait
60 seconds, with five sends per address and sixty per source per hour. The
loopback-only listener shares a single source bucket, so the source cap is
sized for a whole demo day of rehearsals (it was twenty until the review
below). Completed sign-in rotates
the signed session, and suspension blocks further Gateway signatures. An
email-verified customer who interrupted sign-up can use **Customer sign-in** to
recover the profile form before KYC. Only active customers get a ledger session.

The Insurer approves the off-chain profile, then the CA issues an X.509 client
certificate with `role=policyholder` and `subjectId=<memberId>`. The app
persists an encrypted enrollment credential before registration and an
encrypted P-256 private key before enrollment. It clears the enrollment
credential after saving the key and certificate. The same member ID is used
for the insurance card and for the signed policy and claim writes. The Bank's
existing identity still executes the simulated money movements.

The Hospital enters the member ID from the card when recording a stay. The
episode stores the hash, and only the Insurer can look up the corresponding
active profile and see the name and date of birth. The Insurer still confirms
the association on-chain. Email, phone, date of birth, consent and the KYC
decision stay off-chain. The national ID is retained as a keyed digest and a
three-digit suffix.

Run `.\scripts\test-dev-lite-onboarding.ps1` against the running app.
It checks all five peer definitions before running Playwright, disables
traces, video and screenshots, and writes a sanitized journey and peer
readback under `data/dev-lite/onboarding-20261121/`. Requests from failed
attempts still count toward the hourly limit. If a run stops after confirmed
payment, `-ResumeRun <dated evidence directory name>` checks the existing
settlement and finishes the account checks within the same code-limit window.

| Check | Result and evidence |
| --- | --- |
| Peer definitions | All five peers reported 1.9.0 sequence 7. See `data/dev-lite/onboarding-20261121/peer-definitions.txt`. |
| Enrollment through settlement | Two customers registered and enrolled with CA HTTP 201 for each operation. The rejected profile had no wallet. The Insurer peer returned the enrolled member as policy owner. A BDT 1,250 OTP premium activated cover and the Insurer confirmed the Hospital match. Oracle auto-approval led to one BDT 64,000 payout. The 156.8-second run completed payment, then stopped on a certificate assertion in the wrong response. See `data/dev-lite/onboarding-20261121/20261121T1541558972Z/journey.json`. |
| Settlement readback and remaining checks | The 120.8-second continuation matched the settlement certificate to the Bank view without replaying the payout. The insurance card fit at 320 px. The second member's policy and claim reads returned 403, and a cross-customer write returned 409. Both customer sign-in and an existing session transaction returned 401 after suspension. The sixth code request returned 429 after the resend cooldown. See `data/dev-lite/onboarding-20261121/20261121T1547254384Z/journey.json`. |
| Premium regression | One legacy-policyholder journey passed in 1.8 minutes, including OTP, EFT, a bounced debit, funding and retry. See `data/dev-lite/premium-journey/20261121-154939-8647/report.json`. |
| Medical regression | All three legacy-policyholder cases passed: routine and payout recovery (192.5 s), corrected appeal (537.0 s) and suspected duplicate (171.3 s). The reports are in the `routine/`, `appeal/` and `duplicate/` subdirectories of `data/dev-lite/medical-rehearsal/20261121-155136-3140/`. |
| Shutdown | All five peers still reported 1.9.0 sequence 7 after testing. The app, Insurer CA and development network were stopped. All six volume names and twelve Compose container IDs matched the pre-run inventory. See `data/dev-lite/onboarding-20261121/network-after.json`. |
| Offline gates | Web lint (16.0 s), typecheck (7.3 s), Vitest 169/169 (12.6 s), connector 6/6 (0.46 s), Oracle worker syntax (1.8 s) and both unchanged Go packages passed. The production build (30.1 s) and its offline browser suite, 11/11 (30.9 s), passed. The generated build was deleted and the original build and Next declaration were restored. See `data/dev-lite/onboarding-20261121/offline-gates-final.log`. |

The scope is synthetic, one-host, live LevelDB dev-lite. This setup uses a custodial Gateway, an
in-process file-store lock, an off-chain KYC record, a single host and
synthetic people. Suspension is an application control. The run does not
verify CRL revocation, real email delivery, identity verification against a
national registry or automated certificate renewal.

### Review fixes (21 November 2026, night)

A source review of the onboarding commit `940e842` found five business-rule
gaps and one operational limit, fixed before the demonstration (F37–F42 in
[FINDINGS](results/FINDINGS.md#onboarding-review--21-november-2026-night)):
member IDs typed at the Hospital are normalised before hashing; the
KYC-verified name is locked for the customer; the Insurer can reactivate a
suspended customer; a national ID already held by an active or suspended
customer blocks a second approval; a policyholder must be 18 to 100 years
old; and the shared source cap is sixty codes per hour.

| Check | Result and evidence |
| --- | --- |
| Offline | Web lint, typecheck and Vitest 176/176 (seven new tests), connector 6/6 and the Oracle worker check passed. With the network and app stopped, the 19 November `.next` was moved aside; `next build` passed with the same four pre-existing tracing warnings (F36) and the offline e2e suite passed 11/11; the original `.next` was then restored. |
| Live onboarding | The first re-run stopped at its first sign-up code with HTTP 429: earlier runs that evening had used all twenty shared-source sends (F42). After the cap change the full journey passed in 5.0 minutes (`data/dev-lite/onboarding-20261121/20261121T1623357127Z`), including the new checks: a KYC-verified name change refused (409), reactivation (200), and sign-in again with the same member ID (200), alongside the existing suspension, cross-customer and sixth-code refusals. |
| Not re-run | The medical rehearsals could not run again on 21 November, because all three routine service categories already had a claim that day; the changes do not touch the claim path, and the hospital form keeps legacy references unchanged (unit test). |

### Demonstration readiness (21 November 2026, late night)

The live order for the supervisor meeting is the
[supervisor running order](supervisor-running-order.md). A browser-only
rehearsal of that order found ten gaps (F43–F52 in
[FINDINGS](results/FINDINGS.md#demonstration-readiness--21-november-2026-late-night)).
The most important was F49: an intake without a billing date stops automatic
Oracle routing for all of that Hospital's claims until it is corrected. After
the fixes, a new synthetic customer completed the whole order in the browser,
from sign-up to a Bank-confirmed BDT 64,000 payout (claim SETTLED, balance
BDT 87,750.00). See the [rehearsal record](supervisor-running-order.md#rehearsal-record).

Two additive synthetic ledger records were made for the demonstration through
ordinary Insurer and Bank transactions:

- Package `demo-hospital-care-plus-v1` ("Block-Insure Hospital Care Plus"),
  PUBLISHED. BDT 1,250 per installment, BDT 300,000 cover, partners
  `hospital-demo` and `bank-demo`. Its INPATIENT rules are a BDT 150,000
  sublimit, a 10% deductible capped at BDT 5,000, an 80% Insurer share, no
  waiting period, 30 days to file and no mandatory evidence. The published
  packages list shows it first.
- Insurer account `insurer-claims-reserve` ("Block-Insure claims reserve",
  `**** 7001`) at `bank-demo`, opened with BDT 50,00,000 so that repeated
  demonstration payouts do not bounce.

The 40 earlier rehearsal packages remain PUBLISHED. Retiring them is a ledger
change that cannot be undone and needs the owner's decision. A retired package
blocks only new purchases and renewals; existing policies keep their premiums
and claims.

### Onboarding implementation files

| Directory | Files and responsibilities |
| --- | --- |
| `apps/web/app/api/auth/` | `signup/route.ts` verifies and submits profiles, `login/route.ts` rotates customer sessions, and `session/route.ts` returns the active account view. |
| `apps/web/app/api/customer/`, `apps/web/app/api/insurer/` | `profile/route.ts` provides self-service profile and email changes. `customers/route.ts` serves the Insurer queue, KYC decisions and member-ID matching. |
| `apps/web/lib/auth/` | `customer-auth.ts` handles enrollment and sign-in code responses and cookies, `email-code.ts` persists code digests and limits, and `customer-recipient.ts` resolves the current premium recipient. `current-session.ts` checks active status and the current session ID, `session-token.ts` carries that ID, and `accounts.ts` maps a customer session for the workspace. |
| `apps/web/lib/customers/` | `settings.ts` scopes the feature, `member-id.ts` allocates IDs, `pii.ts` digests the national ID, `state-file.ts` provides serialized atomic storage, `store.ts` defines the records and response view, `wallet.ts` encrypts signing material, and `onboarding.ts` applies KYC decisions and resumes certificate issuance. `customers.test.ts` exercises those controls and the code limits. |
| `apps/web/lib/fabric/` | `ca-client.ts` generates the CSR and calls the Insurer CA. `gateway.ts` selects the active customer's wallet and checks the session before signing. `ca-client.test.ts` verifies the wire format and CSR, and `gateway-customer.test.ts` checks refusal before credentials load. |
| `apps/web/app/api/banking/` | `otp/route.ts` binds the challenge to the customer's email. `premium-payment/route.ts` checks the same recipient when consuming it. `otp/route.test.ts` covers the existing Bank OTP behavior with that dependency. |
| `apps/web/app/`, `apps/web/components/` | `signup/page.tsx`, `signin/page.tsx`, `workspace/page.tsx`, `workspace/[workspace]/page.tsx` and `globals.css` wire customer entry, workspace and print layout. `customer-access-page.tsx`, `customer-access.tsx` and `customer-api.ts` provide the shared forms and client. `customer-portal.tsx` shows the profile and card. `customer-onboarding-queue.tsx`, `workspace-client.tsx` and `medical-intake.tsx` integrate the Insurer queue and matching. `apps/web/lib/workflows/forms.ts` labels the Hospital's member-ID field. |
| `tools/email-gateway/`, `scripts/` | `gateway.mjs` adds recipient policy and customer templates, with cases in `gateway.test.mjs`. `dev-lite-app.ps1` manages the existing CA and the two new key entries. `test-dev-lite-onboarding.ps1` gates and runs the isolated journey. |
| `apps/web/` | `e2e/onboarding-journey.spec.ts` exercises the live case, and `playwright.onboarding.config.ts` gives it a separate runner. `playwright.premium.config.ts` and `playwright.medical.config.ts` support protected regression artifacts. |
| Documentation | This runbook, `docs/submission-walkthrough.md`, `docs/results/FINDINGS.md`, and the local `.project-context/03_CURRENT_STATE.md` record the journey and its limits. The numbered local handoff mirrors those updates. |

## Realistic amounts and cover rules on sequence 7 (21 November 2026)

Sequence 7 makes the dev-lite demonstration use realistic Bangladeshi taka
amounts and adds medical cover rules R1–R6. All money is simulated BDT, and
the frozen XGBoost weights, threshold and adapter are unchanged. Policies
issued before sequence 7 keep their issued terms, and non-medical products
keep their recorded behaviour. Findings F22 and F24–F31 in
[FINDINGS](results/FINDINGS.md#realistic-amounts-and-medical-cover-rules--21-november-2026-night)
describe each change.

- **Amounts.** The demo product is BDT 1,250 per 30-day installment, with
  BDT 300,000 of cover, a BDT 150,000 sublimit, a 10% deductible capped at
  BDT 5,000 and an 80% insurer share. A routine BDT 85,000 hospital bill
  pays BDT 64,000; the governed BDT 190,000 bill is capped at BDT 150,000
  and its correction to BDT 85,000 pays BDT 64,000. The realistic benchmark
  range is BDT 50,000–120,000. Amounts display as `BDT 150,000.00`, and
  forms and OCR accept `150000`, `150,000.00` or `1,50,000.00`.
- **R1 term.** A medical policy starts between the ledger's Asia/Dhaka date
  and 60 days ahead, for at most one year. Cover is never backdated.
- **R2 cover start.** Cover starts on the later of the start date and the
  day the first premium settles (`coverStartDate`). The first premium is
  accepted until the start date plus the 15-day grace period; then the offer
  expires.
- **R3 claims.** A stay must begin on or after cover start, after the
  waiting period, and within a paid installment. Hospital episode dates,
  claim incident dates and benefit event dates cannot be in the future.
- **R4 grace.** An installment paid within grace keeps cover continuous.
  After the due date plus grace, payment is refused and the policy has
  lapsed.
- **R5 reinstatement.** Missed installments cannot be paid. The Insurer's
  **Reinstate from today** (`ReinstatePolicy`, hashed reason) restarts the
  policy: the reinstatement premium is accepted that day only, the gap stays
  uncovered, waiting periods restart, active mandates are re-dated to today
  and older open collections become SUPERSEDED. Only expiry moves a policy
  out of LAPSED through `AdvancePolicyLifecycle`.
- **R6 EFT first premium.** A PENDING_PAYMENT policy can set up an EFT
  mandate whose first debit is the start date, so the first premium need not
  be paid by OTP.
- **Clean-up.** Cancellation and a paid death or surrender benefit cancel
  open collections and mandates. A policy holds one PENDING or ACTIVE
  mandate and one non-rejected benefit request. A cancelled policy still
  covers treatment before its cancellation date.

Identity and evidence:

| Item | Value |
| --- | --- |
| Package | `insurance-contract_1.9.0-realism-seq7.tar.gz`, SHA-256 `d6da2d7759681c5c50c895187844f3d6bd0e1b8a3caa31949c58e89000843ec9`, label `insurance-contract_1.9.0`. All 46 packaged source files matched the working tree (`data/dev-lite/realism-20261121/package-audit.json`). Built in the pinned Go 1.26.11 builder; `go build` and `go vet` passed. |
| Lifecycle | Sequence 7 committed VALID in transaction `4c2db2c338eb9f00d3c23fda24dde9197380a523c347787df71aaebbdd7a7f77`. All five peers read back version 1.9.0, sequence 7, with all five approvals. |
| Backup | Before the upgrade, the six stopped volumes were archived to `data/dev-lite/backups/pre-seq7-20261121-124702/` with SHA-256 sums. |
| Preservation | After the upgrade the routine claim `medical-dd367ca9-…` still read SETTLED from the Insurer peer with certificate hash `5b94b770…84d5`. |
| Offline | Go `gofmt`, `vet` and the full suite passed in the pinned container, with ten new cover-rule tests and extended benefit tests. Web lint, typecheck and 153/153 unit tests passed, and the email connector's 3/3. Offline paired model cases are in `data/dev-lite/realism-20261121/model-paired-cases.mjs`. |
| Live premium journey | `scripts/test-dev-lite-premium.ps1` passed in 2.2 minutes (`data/dev-lite/premium-journey/20261121-130013-6880`). A backdated purchase returned 409 "never backdated". One policy paid its first premium by OTP. Two EFT-first policies collected on their start date: one completed, and one bounced with INSUFFICIENT_FUNDS and stayed PENDING_PAYMENT until a deposit and Insurer retry completed it. |
| Live medical journeys | Under `data/dev-lite/medical-rehearsal/20261121-130242-3406`: the routine INPATIENT journey passed in 3.4 minutes and the corrected SURGERY appeal in 9.5 minutes. The first duplicate attempt failed when it re-registered the routine service's immutable benchmark (409 "already exists"). The spec now reuses an identical earlier range, and the re-run `duplicate-rerun` passed in 3.0 minutes, on the routine claim's policy. |
| Evening staging | `scripts/stage-dev-lite-demo.ps1` passed every stage (`data/dev-lite/demo-staging/20261121-132229/summary.json`): EFT-first policies `prem-policy-rich-dc7d1795` and `prem-policy-poor-dc7d1795` due 22 November plus OTP-paid `prem-policy-otp-dc7d1795` (1.6 min); final rejection `medical-580007c9-…` (6.3 min); a fresh routine claim, then its duplicate `medical-328c1075-…` left SETTLEMENT_AUTHORIZED with settlement `med-settlement-cca3c736-52c` (2.8 min). |
| Production build | With the network and app stopped, the 19 November `.next` (`qNmlApXQ…`) was moved aside. `next build` and the standalone preparation passed, and the offline e2e suite passed 11/11 against `npm run start`. The new build was then removed and the original `.next` restored by directory move. |

Limits: synthetic data on one host. The 15-day grace expiry, reinstatement
and offer expiry need ledger time to pass and were tested in Go only. The
dev-lite SURGERY benchmark is an immutable BDT 250–750 record from earlier
sequences, so the routine rotation uses INPATIENT, OTHER and CONSULTATION
(three routine runs per day). The governed appeal still uses SURGERY, where
BDT 190,000 is out of range under either benchmark. Claims and cases staged
before sequence 7 keep their small amounts. There is no pro-rata refund on
cancellation, and waiting periods do not vary by cause.

## Registry snapshot backup and recovery

Include `data/dev-lite/registry-archive/` with the private dev-lite application
backup. It contains the exact snapshot bytes and input digests by registry root.
Apply the same access controls as for the working registry under
`data/dev-lite/oracle/registries/`.

To recover a missing working snapshot, obtain the root hash from the existing
ledger proposal or pinned Oracle request and run:

```powershell
node scripts/restore-registry-snapshot.mjs ROOT_SHA256
```

The command verifies the stored bytes and recomputes the root with the frozen
worker encoding, including the original snapshot timestamp. It restores the
snapshot ID from the archive and refuses to overwrite a different working
file. Registry snapshots published before the archive feature need their
corresponding historical application backup unless the publisher reused and
archived the same snapshot later.

For incomplete registry source diagnostics, see the
[medical source recovery runbook](runbooks/medical-source-recovery.md).

## Fresh ledger and demonstration seed (24 November 2026)

The owner approved rebuilding only the LevelDB dev-lite ledger, because the
old one had collected many test packages, partners and claims. The CouchDB
dev-lite profile, the candidate and main networks, the CA state under
`data/dev-lite/organizations/`, `app-secrets.json` and `email-gateway.json`
were not touched. Source is commit `9322808` plus this session's
uncommitted changes. Chaincode is unchanged.

Procedure, in order:

1. Stop the app. Move the ledger-bound app state (`oracle`, `evidence`,
   `events`, `otp`, `journal`, `research-findings`, `customers.json`,
   `customer-wallet`, `customer-email-codes.json`) into
   `data/dev-lite/archive-ledger-<date>/`. The Oracle cursors and event
   projection hold block positions of the old chain. If they stay, the
   workers skip events on the new one.
2. `network.sh --dev-lite teardown --confirm-dev-lite`. This removes the six
   LevelDB volumes and every dev-lite container, the CA containers included.
3. `network.sh --dev-lite up` with
   `DEV_LITE_CHAINCODE_BUILDER=block-insure/fabric-ccenv:2.5.16-go1.26.11`.
   It rejoins the channel from the retained
   `channel-artifacts/insurance-dev-lite-190.block`.
4. `DEV_LITE_PACKAGE=…/insurance-contract_1.9.0-realism-seq7.tar.gz`
   (SHA-256 `d6da2d77…3ec9`) and `network.sh --dev-lite deploy`. A first
   deployment must use sequence 1. All five peers read back 1.9.0,
   sequence 1.
5. `network.sh --dev-lite ca-start`, then stop the CA containers again.
   `dev-lite-app.ps1 -Onboarding` refuses to start until the stopped
   Insurer CA container exists.
6. `dev-lite-app.ps1 -TwoOracles -Onboarding` without `-Email`, then
   `scripts/seed-dev-lite-demo.ps1` once. The seed refuses a ledger that
   already has packages.

Seeded set (`data/dev-lite/demo-seed/20261123-182904/seed-summary.json`):

- Four partner agreements.
- Five single-service plans. `ConfigureMedicalRules` accepts one service per
  draft package, so each plan covers one service.
- INPATIENT and DIAGNOSTIC benchmarks for Dhaka Central and Chattogram.
- The Insurer's premium and claims-reserve accounts.
- Five onboarded customers (`@example.com` addresses), each with a verified
  account and a policy from 24 November. Four paid by OTP; one has an
  approved EFT mandate with the first premium due.
- Claims `CLM-2026-000201` (SETTLED, BDT 64,000), `CLM-2026-000202`
  (SETTLEMENT_AUTHORIZED, BDT 47,600) and `CLM-2026-000203` (SUBMITTED).
  Both Oracle-routed claims were approved by the two running workers.

The seed passed in 5.8 minutes after two aborted attempts:

- The first was stopped by Windows PowerShell treating a Node warning on
  stderr as an error. The script now relaxes the error preference around
  the Playwright call.
- The second was refused by the one-service rule after four agreements and
  one draft plan. The ledger was rebuilt again rather than leave a draft
  whose description no longer matched.

A headless Edge pass over each role's pages showed only the seeded records,
and the package list shows exactly the five plans.

Limits:

- The maintained journeys (`test-dev-lite-*.ps1`) and
  `stage-dev-lite-demo.ps1` were not run on this ledger. They add their own
  test partners, packages and customers, and the medical journey's
  benchmark assumptions were written for the old ledger.
- No appeal, suspected duplicate or finally rejected case is seeded.
- The Khulna and Sylhet staff sign-ins have no partner agreement.
- The Bank's display name still contains "Demo", and the identity
  attributes `bank-demo` and `hospital-demo` are unchanged because they are
  bound to enrolled certificates.

## R1 ledger-instance marker (sequence 2)

On 25 November 2026 the write-once `RecordLedgerInstance` marker on
`insurance-dev-lite-190` was set to this ledger's block-1 digest
`85f5bae841c2c1826db6f898f27954d26ff85c0f43e15f84b0e92e110a7bd71b`
(tx `4d9818e7…6aed`, block 92). This is by design: the digest was recomputed
from the peer immediately before submission. Any future rebuild must write a
fresh random marker from the seed script instead.
