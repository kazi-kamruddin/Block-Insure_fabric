# Medical development workflow

Dev-lite uses `insurance-dev-lite-190` and `data/dev-lite`. The accepted
deployment has a separate channel, package, identities and storage.

In Ubuntu/WSL, with Docker Desktop running, start the isolated profile:

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
