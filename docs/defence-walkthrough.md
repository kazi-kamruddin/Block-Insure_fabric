# Defence walkthrough for the retained LevelDB ledger

The fresh 24 November seed uses `insurance-dev-lite-190`, chaincode 1.9.0,
sequence 1. The package is the sequence-7 build. Verify the definition and
five peers before the meeting. Use one network and the three-worker roster.
The web app opens at `http://127.0.0.1:3219/workspace`. The runbook covers
the standalone production launch and the one-worker fault segment.

[Dev-lite runbook](dev-lite-medical.md) · [Supervisor running order](supervisor-running-order.md)

| Step | Record or evidence | What to show |
| --- | --- | --- |
| Onboarded customer, premium and coverage | Seeded policies `POL-2026-000101` through `POL-2026-000105` | Open the customer workspace and point to the BI member card, issued terms and premium history. |
| End-to-end automatic approval | `CLM-2026-000201` · BDT 64,000 · SETTLED | Its claim timeline binds the Oracle release and snapshot, certificate and Bank payout. Export the dossier and compare it with a separately obtained peer readback. |
| Bank handoff | `CLM-2026-000202` · `STL-2026-000202` · BDT 47,600 · SETTLEMENT_AUTHORIZED | Show the authorization and prepared signing request. A payout confirmation is a separate owner-approved ledger write. |
| Diagnostic intake | `CLM-2026-000203` · SUBMITTED | Show the submitted statement. Its hospital has no attestation in the seed evidence. Attestation and claim processing require separately approved transactions. |
| Oracle timeout to panel | Historical `oracle-claim-timeout-1790443078388-651364` on the September CouchDB experiment | Explain the timeout, panel fallback and settled result using the dated evidence. For a closer medical-panel example, show the sequence-7 duplicate referral below. |
| Panel approval | Historical `medical-328c1075-969c-4726-a454-28127ba8f4be` on the replaced LevelDB ledger | The same stay entered the panel under the duplicate-screening rule. Three approvals authorized `med-settlement-cca3c736-52c`. |
| Corrected appeal | Historical `medical-c8310aca-ca07-4913-98ff-c3895cc6eab0` on the replaced LevelDB ledger | The version-3 review obtained fresh evidence checks and three approval votes. Show the archived appeal report's `settled-workspace` screenshot. |
| Final rejection | Historical `medical-580007c9-2b0c-467f-9d4f-5c5fa5810a6b` on the replaced LevelDB ledger | The procedural window expired, the permitted recovery was used and the later review also expired. The staging report records the reserved-cover state. |

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
`node scripts/validate-dev-lite-seed.mjs --defence-date 2026-12-06`.
Sadik's waiting period ends 24 December 2026. The 25 November peer
readback shows Rakibul pending his first EFT premium with zero confirmed
payments. His grace remains open on 6 December and ends 9 December 2026.
The retained ledger has four hospital/service benchmarks. As of the same read,
the premium collection account ****7001 held BDT 5,550 and the reserve
****7002 held BDT 2,436,000. The scheduled F06 signing drill uses a separate
Windows operator. [Custody and F06](custody.md)
