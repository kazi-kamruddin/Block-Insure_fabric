# Session B scenario cookbook

Run these recipes on the retained `insurance-dev-lite-190` LevelDB channel. Session A committed R2 at sequence 3, verified all five organizations, activated the six-auditor roster and set DEMO. Check the latest journey outcomes before choosing cases. All recipe durations are **DEMO estimates** for prepared inputs and signed-in operators. Policy dates and audit-period dates use the real calendar. [R2 journey record](results/r2-journeys-2026-11-26.md) · [R2 timing design](oracle-v2/R2-DESIGN.md)

## Start and verify

From the Fabric checkout in PowerShell, with Docker Desktop available and the current production web build prepared while Fabric was stopped, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Start
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Status
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Stop
```

The launcher starts the retained orderer and five peers, waits for Insurer, Hospital and Oracle to see each other by Fabric discovery, checks all five definitions and local packages, starts the pinned ccaas server, then starts the source adapter and publisher, its mirror, three workers, and the production web app. `HEALTHY` shows seven required containers, three worker subjects, six adapter listeners, the web URL and a readable timing profile. Confirm `DEMO` and `BusinessMemoryReady : True` before a DEMO write. `Status` reports the timing profile from the ledger. The launcher refuses to run against the sequence-2 candidate state. [Profile](../scripts/profiles/dev-lite-190.json) · [R2 supervisor](../scripts/r2-demo.ps1)

The read-only prerequisite check is `powershell -ExecutionPolicy Bypass -File .\scripts\dev-lite-preflight.ps1 -R2Demo`. Add `-Ledger` while the five peers are running. For health inspection, `Start -ReadOnly` starts the same retained runtime with ledger submission, publisher writes and Oracle event consumption disabled. Use ordinary `Start` for the claim recipes. The supervisor requires 700 MB before starting the full demo. Ledger readbacks require 500 MB. [Read-only R2 audit](results/r2-journeys-2026-11-26.md#pre-freeze-readback)

Open the workspace at [Block-Insure on loopback](http://127.0.0.1:3219/workspace). Keep the customer and staff in separate browser profiles. Prepare distinct auditor sessions for panel votes because each sealed ballot must be revealed from the browser that committed it. The regular start keeps automatic EFT scheduling off, so the EFT recipe can use the manual Insurer and Bank controls.

| Role | Sign-in and scope |
| --- | --- |
| Customer | Use **Customer sign-in** and the seeded customer's registered email. For the local demo, retrieve the verification code on the sign-in screen. Keep the session open through the claim and payout. |
| Insurer | Select **Insurer Administrator** (`insurer-admin`). |
| Hospital | Select **Chattogram Metropolitan Hospital** (`hospital-officer-2`, `hospital-2`) for signed S-A publication. For a cross-hospital fixture also use the registered first hospital, such as **Dhaka Central Medical Hospital**, where the selected policy covers it. |
| Auditor | Use the numbered **Independent Auditor** accounts that match the assigned subject IDs. The six-subject roster requires the retained `auditor1` through `auditor4` and the new `auditor5` and `auditor6` enrollments. |
| Bank | Select **Bangladesh Demo Commercial Bank** (`bank-officer`, `bank-demo`). |
| Oracle | The supervisor starts `oracle1`, `oracle2` and `oracle3` as separate service identities. The signed Oracle portions of release governance use those enrolled identities. |

The demo reads the existing `data/dev-lite/app-secrets.json`, client identities under `data/dev-lite/organizations/`, customer wallets in the retained app state, and signing keys inside the adapter processes. Use the owner's existing evidence storage for receipt files and their recovery material. [Dev-lite runbook](dev-lite-medical.md) · [Identity custody](custody.md)

## Customer eligibility and setup

| Customer | Starting eligibility on 26 November 2026 |
| --- | --- |
| Kazi | Hospital Care Plus `POL-2026-000101` for covered inpatient care and Diagnostics Care `POL-2026-000106`. Both were ACTIVE. Check the patient's previous visits before choosing an automatic approval fixture. |
| Sumit | Inpatient cover `POL-2026-000102` and Diagnostics Care `POL-2026-000107`. Both were ACTIVE. Prior diagnostic activity can affect Oracle advice on a new claim. |
| Abdullah | ACTIVE Diagnostics Care `POL-2026-000103`. Use the retained repeat-visit history for the model referral demonstration. |
| Rakibul | Inpatient cover `POL-2026-000105`. The first EFT already completed, the policy is ACTIVE and the next premium is due 24 December 2026. Use a separate eligible customer for the bounced EFT drill. |
| Sadik | Surgical Shield `POL-2026-000104`. Stage a surgery claim only after 24 December 2026 and check current premium standing. |

Read the policy's active term, waiting period, paid-through date, covered hospital and service on the day of the demo. Prefer a fresh diagnostic policy and a customer with no prior qualifying invoices for the clean case. The retained diagnostic policies already have claim history. [Read-only policy evidence](results/r2-journeys-2026-11-26.md#pre-freeze-readback)

To add a synthetic customer, stop any current R2 run and use `Start -Onboarding` for the existing Insurer CA. The customer selects **Create an insurance account**, verifies their email, then enters the synthetic profile and identity details. The Insurer opens **Customers**, finds the request under **Customer onboarding** and selects **Approve customer**. The customer signs in, notes the new member ID on **Overview**, then requests an account link under **Payments**. The Bank uses **Accounts → Verify and link** with the agreed synthetic opening balance. The customer opens **Policies → Accept terms and acquire medical policy**, loads the published packages, chooses the matching service and acquires the policy. The first successful premium starts cover, subject to the actual policy wait. [Onboarding and payment workflow](supervisor-running-order.md)

## Claim and panel controls

For a new diagnostic case, the Hospital opens **Patient billing → Save patient intake**. Enter the exact invoice number in **Hospital episode reference**, current revision `0`, the customer's member ID, DIAGNOSTIC, the documented service and billing dates, and the bill. The Insurer opens **Customers → Refresh episodes → Resolve association**, verifies the suggested member and submits. The customer opens **Claims → Refresh episodes**, selects the eligible policy and episode, then **Prepare claim and calculate reimbursement → Accept statement and submit claim**. Record the resulting claim ID.

For receipt evidence, the customer opens **Documents → Encrypt, store, and anchor evidence** with document type `RECEIPT` and the synthetic receipt. Select **Encrypt in browser**, then **Store ciphertext and record reference**. Under **Claims → Medical review and appeal**, enter the claim ID and select **Load medical case**. Under **Confirm receipt details**, choose the evidence and enter its actual invoice number and amount in poisha. Select **Save private receipt summary**. The Insurer uses **Claims → Start claim processing → Submit verified transaction**. That action publishes and anchors the Hospital and receipt feeds, pins the static simulated S-B regulator feed and opens the Oracle round. Refresh **Load medical case** to inspect the result. [Source controls](../apps/web/components/medical-oracle-v2.tsx) · [Hospital intake roles](oracle-v2/R1-DESIGN.md)

For a referred case, the Insurer opens **Claims → Medical review and appeal → Load medical case → Prepare four-auditor review**. Where shown, select **Disclose facts to the audit panel**. The claimant selects **Grant listed evidence to these four reviewers**. Each assigned auditor opens **Reviews**, loads the case, selects **Acknowledge review facts**, then uses **Open granted evidence** and **Confirm decryption for this review** for each required document. Keep all sessions ready before the Insurer selects **Open voting**. On a sealed round, each auditor selects the reason, commits with **Commit sealed ballot**, and returns to **Reveal sealed ballot** in the same browser. Reveal begins at the ledger commit cutoff or when all four commitments arrive. Three approvals approve, two rejections reject. For claimant-escalated cases an assigned auditor can select **Open escalated voting** after disclosure and evidence preparation. [Review controls](../apps/web/components/medical-review.tsx) · [R2 reviewer governance](oracle-v2/R2-DESIGN.md)

For an approved claim, the Insurer uses **Overview → Prepare settlement** or **Claims → Authorize settlement**. Verify the source is the claims reserve (`**** 7002`) and the destination is the claimant's verified linked account. Use **Find payout accounts** to populate them if needed, then **Submit verified transaction**. The Bank uses **Overview → Execute payout** or **Payouts → Confirm settlement**, enters a fresh synthetic Bank reference and selects **Submit bank instruction**. Refresh the customer claim and verify **SETTLED** and the posted BDT payout. [Payout procedure](supervisor-running-order.md)

## 1. Clean automatic approval and payout

Use a fresh eligible diagnostic case at Chattogram with a matching receipt and no qualifying prior visits. Complete the claim controls, then start processing. Under **Oracle evidence decision**, expect **Automatic approval**, `MATCH`, `AUTO` advice and an approved claim. Authorize and confirm the payout, then verify **SETTLED**. **DEMO estimate:** 2–4 minutes with the claimant already covered. **Needs:** full signed-source stack, three workers and Bank peer. [Historical clean fixture](results/r1-journeys-2026-11-25.md)

## 2. Receipt mismatch to panel

Use a documented synthetic bill and a separately prepared receipt whose actual amount differs. Capture those actual values in **Patient billing** and **Confirm receipt details**. Start processing and check **Receipt comparison** for `MISMATCH`, then **Panel review**. Have the Insurer prepare the four-auditor review. The panel outcome follows its own evidence checks and votes. **DEMO estimate:** up to 45 seconds for the Oracle windows, then around 2–5 minutes for a prepared panel. **Needs:** full signed-source stack, three workers and Auditor peer. [Historical mismatch cases](results/r1-journeys-2026-11-25.md)

## 3. ML repeat visit to panel

Use an eligible Abdullah diagnostic case with a prior matching-patient visit inside the frozen evaluator's prior window. The prior invoice day must precede the new invoice day. Use a matching receipt and choose dates that avoid a duplicate interval so the **Model advice** can be observed separately. Start processing. Check `MATCH` together with `REVIEW`, then prepare the panel. **DEMO estimate:** 1–2 minutes to the referral with both records prepared. **Needs:** full signed-source stack, three workers, historical Hospital records and Auditor peer for review. [Repeat-visit evidence](results/r1-journeys-2026-11-25.md)

## 4. Duplicate claim

File two distinct Chattogram episodes for the same customer and diagnostic service with overlapping admission and discharge dates. Use distinct real fixture invoice references. Open the second claim from **Claims** and process it with its own receipt. Expect a duplicate-review referral and no automatic payout on the second case. Follow the panel controls. **DEMO estimate:** 2–4 minutes after both billing records are ready. **Needs:** signed-source stack, three workers and Auditor peer. [Duplicate indexing](../chaincode/insurance-contract/src/medical_duplicates.go)

## 5. Cross-hospital duplicate

Choose a diagnostic policy covering both hospitals. File distinct claims for the same member and service with overlapping admission and discharge dates. The live run used Chattogram (`hospital-2`) and Rajshahi (`hospital-3`). In the second customer case, select **Explain overlapping care at different hospitals** and **Send explanation to reviewers**. For a second case at Chattogram, use normal Oracle processing. For a second case outside the signed S-A authority, refresh **Load medical case** after its pinned two-minute DEMO wait and select **Escalate after processing deadline**. The Insurer then uses **Disclose facts to the audit panel**. Assigned auditors can see the explanation. **DEMO estimate:** 2–5 minutes with the prior claim and second billing entry staged. **Needs:** Hospital, Insurer, Oracle and Auditor peers, the six-auditor roster, and signed-source workers for the Chattogram request. [Live overlap](results/r2-journeys-2026-11-26.md)

## 6. One worker down, quorum reached

Stop `oracle3` with the scoped command below. With `oracle1` on the direct adapters and `oracle2` on the mirror, start a fresh eligible request. The Insurer's **Verification** workspace should show two workers and quorum available. Expect the two live workers to reach matching results after the commit window boundary. Confirm the selected decision and restart `oracle3`. **DEMO estimate:** about 15–45 seconds from request issuance, plus commit and refresh time. **Needs:** the signed-source stack, direct and mirror listeners, `oracle1` and `oracle2`. [Historical two-worker case](results/r1-journeys-2026-11-25.md)

## 7. Two workers down, timeout and escalation

Stop `oracle2` and `oracle3` with `StopWorker -Worker 2` and `StopWorker -Worker 3` before a new DEMO request. Start a claim with its evidence ready for a panel. Refresh **Load medical case** after the ledger reveal deadline and select **Close timed-out Oracle request**. Verify `TIMEOUT` and the failed Oracle state. Refresh again after the displayed DEMO escalation deadline and select **Escalate after processing deadline**. Expect **PREPARING** with four assigned reviewers. Restore both workers with `RestartWorker`. The old claim `CLM-2026-000206` follows its REAL guard at 15:57:27.3 Dhaka on 26 November. **DEMO estimate:** around three minutes for a new request. **Needs:** Hospital, Insurer and Oracle peers, publishers and `oracle1`, plus Auditor peer for the panel. [Timeout evidence](results/r1-journeys-2026-11-25.md) · [Read-only deadline](results/r2-journeys-2026-11-26.md#pre-freeze-readback)

## 8. Panel rejection, appeal and approval

Use a prepared mismatch case and record two evidence-based rejection ballots. In the claimant case select the disputed decision, explain what changed, select **New appeal document** and **File medical appeal** within the displayed deadline. Confirm the actual corrected receipt summary for the new version. Start the new processing round as the Insurer. Prepare the assigned mixed appeal panel with its new disclosure and grants, then obtain three approval reveals if the corrected evidence supports payment. Verify the original rejection, appeal approval and latest certificate together, then use the payout controls. **DEMO estimate:** 5–10 minutes after the original decision, with all reviewer profiles open. A new DEMO rejection's appeal window is 30 minutes. **Needs:** full signed-source stack, three workers, Auditor and Bank peers, active six-auditor roster. [Corrected carry-over case](results/r2-journeys-2026-11-26.md) · [DEMO windows](oracle-v2/R2-DESIGN.md)

## 9. Approval retired before payment

Start with an approved synthetic case and a documented reason to invalidate its intake association. Keep the Bank from executing the settlement. In **Customers → Refresh episodes → Review association → Verify patient association**, select `REVOKE` for this exact revision and submit the decision basis. The Insurer reloads the original case and uses **Retire an invalidated approval → Retire approval and release cover** with the documented reason. Expect a return to review and release of reserved cover. An unpaid authorization, if present, becomes `RETIRED`. Session A retired the approval before creating an authorization. **DEMO estimate:** 1–3 minutes after approval. **Needs:** Hospital, Insurer and Oracle peers for the association, Bank peer if checking the payout state, and the selected ccaas runtime. [Live retirement](results/r2-journeys-2026-11-26.md)

## 10. Audit sampling and defaulted seed

Stage a submitted new claim without an Oracle request. The Insurer opens **Claims → Medical audit sampling**, sets a unique period ID, future start, end at least one minute after start, the approved rate and at least one minute of reveal grace, then selects **Propose period**. Insurer in **Claims**, Auditor in **Reviews**, and Hospital in **Registry** each use **Read period** and **Commit seed share** before it starts. At the start, select **Open period and freeze claim versions**. Start an AUTO-eligible claim before the period ends. After the end, each participant can use **Reveal seed share** in the same browser. Three reveals followed by **Finalize audit period** produce `FINALIZED`. For the default drill, leave one share unopened and finalize after grace. Expect `AUDIT_SEED_DEFAULTED` and a nonzero defaulted panel count. The live proof resolved the waiting claim through a separate `ResolveMedicalAuditSelection` service action, which has no workspace button. To exercise the separate UI path, refresh the claimant case after grace and use **Escalate after processing deadline**. This latter branch still needs live acceptance. **DEMO estimate:** 3–6 minutes for a short owner-approved period and grace, governed by the actual period clocks. **Needs:** Insurer, Auditor and Hospital peers for shares, plus signed-source adapters and Oracle workers. [Sampling controls](../apps/web/components/medical-audit-period.tsx) · [Live default evidence](results/r2-journeys-2026-11-26.md)

## 11. Model hold and resume

Before a prepared automatic payout is executed, the Insurer or Auditor opens **Verification → Oracle source and release governance → Hold release** for the active routing release, with the approved reason hash. Confirm `HELD`. The Bank's pending payout should be refused while the automatic approval depends on that held release. The Insurer uses **Request held release resume**. The independent Oracle operator submits two fresh artifact attestations with enrolled Oracle subjects and the OracleMSP approval using the approved service-side governance path. Insurer and Auditor use **Approve model release** in their own workspaces. At **Activation window open**, the Insurer selects **Activate approved release**. Start a new eligible case to confirm the resumed release handles a request. The hold and the staff actions are available in the UI, and full resume needs the service-side Oracle actions. **DEMO estimate:** about 30 seconds from final approval to eligibility, plus operator signing and the next request. **Needs:** Insurer, Auditor, Oracle and Bank peers, the signed-source stack and worker identities for the new request. [Release governance](oracle-v2/R2-DESIGN.md)

## 12. Insufficient-balance EFT and OTP premium

Use a new due policy and verified synthetic Bank account with a balance below the actual installment. In **Payments** choose **Set up automatic EFT payment**. The Bank uses **Mandates & collections → Approve mandate**. The Insurer uses **Premiums → Schedule due EFT collections**, then the Bank selects **Collect premium**. Expect `BOUNCED` with `INSUFFICIENT_FUNDS`, and unchanged paid-through dates. After the approved simulated deposit, the customer selects **Pay first premium now** or **Pay next installment by OTP** under **Payments**, then **Email OTP**, enters the displayed demo code and selects **Authorize premium**. Verify payment completion, updated dates and one debit for the installment. **DEMO estimate:** 2–4 minutes with due dates and roles prepared. **Needs:** production web, paired Insurer and Bank peers, ccaas. [Premium controls](../apps/web/components/bank-desk.tsx) · [Customer payment workspace](../apps/web/components/premium-center.tsx)

## Troubleshooting

- **Discovery and dissemination.** Wait for the supervisor's mutual-visibility check after any peer restart. Hospital, Insurer and Oracle must be available together for two-peer dissemination of medical private writes. If the ledger reports dissemination refused, inspect membership and the stopped/started scope before one controlled repair. Read back the claim or transaction before repeating a click. [Memory and peer plan](runbooks/defence-memory-plan.md)
- **Memory.** Use the 500 MB readback floor, 700 MB before full startup and business writes, and 900 MB immediately before one Chromium screenshot worker. If health is green but `BusinessMemoryReady` is false, wait for warm-up, check status again and apply only the scoped remediation in the memory plan. Keep builds and Go or TLC runs offline with Fabric stopped. [Memory and peer plan](runbooks/defence-memory-plan.md)
- **Sources.** Check the six adapter listeners and the exact Hospital 2 invoice and receipt details. The current publisher binds the retained S-A issuer to Chattogram. Wait for the mirror health and new feed version before diagnosing Oracle divergence. Review `data/dev-lite/logs/r2-demo/` for startup and publisher logs.
- **Worker recovery.** Restart a single owned worker and check status. For a quorum drill use **StopWorker** first. Terminal health stays partial while a worker is stopped by design.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 StopWorker -Worker 3
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 RestartWorker -Worker 3
```
