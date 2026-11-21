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
data and secrets under the same profile root. `-TwoOracles` leaves the third
worker offline for the quorum and payment recovery rehearsal. With that
controller running, use `./scripts/test-dev-lite-medical.ps1` on the
activated channel. Add `-Activate` for the first rehearsal on a freshly
deployed, empty channel. The switch performs the one-time activation.

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
`./scripts/dev-lite-app.ps1 -CouchDB -TwoOracles` and
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

The held-out ML set had 1,061 providers and 86 weak positives. At 213 review
slots, logistic regression retrieved 73.3% of those positives at 29.6%
precision. The additive-bin challenger retrieved 70.9% at 28.6% precision.
The figures use provider-level labels and are local to this dataset and split.

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
