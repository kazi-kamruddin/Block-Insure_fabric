# Defence walkthrough for the retained LevelDB ledger

The retained 24 November seed uses `insurance-dev-lite-190` and chaincode
1.9.0. Verify the committed sequence and exact package against the
[dev-lite profile](../scripts/profiles/dev-lite-190.json) and five-peer
readback. Use one network and three Oracle subjects.
Start the production demo from the Fabric checkout with
`powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Start`.
The web app opens at `http://127.0.0.1:3219/workspace`. Confirm sequence
3, DEMO, and three Oracle workers in the launcher status.

[Scenario cookbook](scenario-cookbook.md) · [Dev-lite runbook](dev-lite-medical.md) · [Session A live record](results/r2-journeys-2026-11-26.md)

| Step | Record or evidence | What to show |
| --- | --- | --- |
| Onboarded customer, premium and coverage | Seeded policies `POL-2026-000101` through `POL-2026-000105` | Open the customer workspace and point to the BI member card, issued terms and premium history. |
| End-to-end automatic approval | `CLM-2026-000201` · BDT 64,000 · SETTLED | Its claim timeline binds the Oracle release and snapshot, certificate and Bank payout. Export the dossier and compare it with a separately obtained peer readback. |
| Bank handoff | `CLM-2026-000202` · `STL-2026-000202` · BDT 47,600 · SETTLEMENT_AUTHORIZED | Show the authorization and prepared signing request. A payout confirmation is a separate owner-approved ledger write. |
| R1 diagnostic AUTO and R2 payout | `CLM-2026-000204` · BDT 3,024 | Show the manifest, exact fact vector quorum and automatic certificate, then the payout confirmed in R2 block 244. |
| Oracle timeout | `CLM-2026-000206`, request `r1-206-1` | One worker committed and the claimant finalized TIMEOUT. The read-only audit confirmed the REAL escalation deadline of 15:57:27.3 Dhaka on 26 November. |
| R1 governed panel and R2 payout | `CLM-2026-000203` · BDT 13,920 | Two matching Oracle reveals required panel review. Three of four approved, and the Bank confirmed in R2 block 246. |
| R2 standby and sealed panel | `CLM-2026-000209` · BDT 2,304 | Show the held original authorization, standby replacement, DEMO v3 certificate and the replacement payout. |
| R2 corrected appeal | `CLM-2026-000207` · BDT 3,600 | Show the original rejection, matching version-2 receipt, mixed appeal panel, three sealed approval reveals and payout. |
| Audit seed default | `CLM-2026-SESSION-A-AUDIT` | Show the Oracle AUTO outcome, three seed commitments, two reveals and the panel route after the grace window. |
| Cross-hospital overlap | `CLM-2026-SESSION-A-OVERLAP` | Open the overlap in the claimant workspace, then show the authorized rationale on its assigned Auditor workspace. |
| Approval retirement | `CLM-2026-SESSION-A-RETIRE` | Show the AUTO result, later association invalidation, ineffective certificate and return to review. |
| Self-service E3 claim | `CLM-2026-SESSION-A-K2` | Show the Hospital visit and signed source manifest, then the two E3 reveals and duplicate referral. The DEMO journey reached a decision in 39.128 s through the normal Gateway routes. |
| R1 final rejection | `CLM-2026-000208` | Show the receipt discrepancy and two panel rejections. |

[Historical sequence-7 records](submission-walkthrough.md) · [September timeout ledger export](results/phase2-live-ledger.json) · [Medical rehearsal index](results/FINDINGS.md)

The successful 23 November browser runs kept the corrected appeal
`settled-workspace` and later duplicate journey
`duplicate-referral-timeline` and `settled-workspace` screenshots as PNG
attachments in the local Playwright JSON. Keep them labelled as historical.
The reviewed rejection evidence contains the run result. A matching
rejection screenshot has not been located.

- [Corrected appeal report](../data/dev-lite/medical-rehearsal/20261123-114017-4850/appeal/report.json)
- [Duplicate referral report](../data/dev-lite/medical-rehearsal/20261123-114017-4850/duplicate/report.json)
- [Evening staging record](../data/dev-lite/demo-staging/20261121-132229/summary.json)

Before the defence, run
`node scripts/validate-dev-lite-seed.mjs --defence-date 2027-01-15 --live`.
Sadik's waiting period ends 24 December 2026. Rakibul's first EFT payment of
BDT 950 committed VALID on 25 November. His policy is ACTIVE, with the next
premium due 24 December 2026. Use the current balance readback for premium
account ****7001 and reserve account ****7002.

The R1 case evidence is recorded in the [live journey table](results/r1-journeys-2026-11-25.md).
The R2 payout amounts and DEMO time above come from the dated production run. Session A measured the one-command launch. The pre-freeze audit independently rechecked the retained claims and policies by evaluating the ledger. [Session A live evidence and pre-freeze readback](results/r2-journeys-2026-11-26.md) · [Session A memory](runbooks/defence-memory-plan.md#session-a-measurement-26-november-2026)
Session A screenshot capture is BLOCKED-TECH. The scoped Playwright Chromium pass used `--workers=1`. The launcher measured 934 MB available and Playwright's immediate check measured 790 MB. The 900 MB gate blocked Chromium before launch. Take the R2 screenshots in Session B once the immediate check passes. [Screenshot gate log](../.project-context/implementation/phase3-live/session-a-screenshots.log) · [Scenario cookbook](scenario-cookbook.md)
F06 requires the separate Windows Bank operator and has no recorded result.
[Custody and F06](custody.md)
