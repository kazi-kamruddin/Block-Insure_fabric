# Defence walkthrough for the retained LevelDB ledger

The retained 24 November seed uses `insurance-dev-lite-190` and chaincode
1.9.0. Verify the committed sequence and exact package against the
[dev-lite profile](../scripts/profiles/dev-lite-190.json) and five-peer
readback. Use one network and three Oracle subjects.
The web app opens at `http://127.0.0.1:3219/workspace`. The runbook covers
the standalone production launch and the one-worker fault segment.

[Dev-lite runbook](dev-lite-medical.md) · [Supervisor running order](supervisor-running-order.md)

| Step | Record or evidence | What to show |
| --- | --- | --- |
| Onboarded customer, premium and coverage | Seeded policies `POL-2026-000101` through `POL-2026-000105` | Open the customer workspace and point to the BI member card, issued terms and premium history. |
| End-to-end automatic approval | `CLM-2026-000201` · BDT 64,000 · SETTLED | Its claim timeline binds the Oracle release and snapshot, certificate and Bank payout. Export the dossier and compare it with a separately obtained peer readback. |
| Bank handoff | `CLM-2026-000202` · `STL-2026-000202` · BDT 47,600 · SETTLEMENT_AUTHORIZED | Show the authorization and prepared signing request. A payout confirmation is a separate owner-approved ledger write. |
| R1 diagnostic AUTO | `CLM-2026-000204` · BDT 3,024 | Show the manifest, exact fact vector quorum and automatic certificate. |
| Oracle timeout | `CLM-2026-000206`, request `r1-206-1` | One worker committed and the claimant finalized TIMEOUT. Escalation requires its ledger deadline. |
| R1 governed panel | `CLM-2026-000203` · BDT 13,920 | Two matching Oracle reveals required panel review. Three of four then approved. |
| Corrected appeal | Historical `medical-c8310aca-ca07-4913-98ff-c3895cc6eab0` on the prior LevelDB ledger | The archived review has three approval votes and a recorded payout. The live carry-over candidate `CLM-2026-000207` starts with an R1 rejection. |
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
The R2 production build passed offline. [R2 journey state](results/r2-journeys-2026-11-25.md)
records the commit block and why live R2 screenshots are still pending.
F06 requires the separate Windows Bank operator and has no recorded result.
[Custody and F06](custody.md)
