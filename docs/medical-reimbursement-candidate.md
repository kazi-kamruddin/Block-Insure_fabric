# Isolated medical reimbursement candidate

The isolated candidate passed its first full browser rehearsal on 19 November
2026. It completed one BDT 40.00 Bank payout. See the
[live acceptance record](results/medical-rehearsal-2026-11-19.md) for the exact
package, outcome, startup fixes and preservation checks.

The isolated medical channel now runs `1.8.0-medical` at sequence 2 and
schema 15. Use the matching web build with `FABRIC_MEDICAL_REVIEW_ENABLED=true`
and its retained server-held review note key. The 1.7.0-medical payout is
historical evidence for sequence 1 on this channel.
See the [review and OCR acceptance record](results/medical-review-ocr-2026-11-19.md)
for the passed combined browser rehearsal through one new BDT 40 payout,
the feature gate and package verification.
The [final medical acceptance record](results/medical-final-acceptance-2026-11-19.md)
tracks the later private-match, Bank recovery, insurer finding, shadow and
governed browser checks tied to this same deployment.

The verified medical archive contains the Go 1.26.10 module directive.
The later Go 1.26.11 security patch changes the development source, so use
the matching medical source at `8a79b9c` for the existing archive's
package check. Keep the recorded medical builder and web build together.

The existing November demonstration is tied to source revision `cc37af2` and
its verified `1.6.3-xgb-alignment` package. Keep its built application, channel,
identities, secrets and data roots together. The existing launcher checks the
package against its checkout. Use the matching revision in a separate local
checkout for that demonstration while developing the medical candidate.

The new medical workflow is scoped to `insurance-medical-reimbursement`.
Do not point development commands at a preserved channel. Production-shaped
rules and synthetic fixture dates should be explicit, including the billing
intervals, published waiting and filing periods, and Asia/Dhaka dates.

The insurer configures one covered service on a draft package, then publishes
it. A holder accepts the resulting terms digest and activates coverage by
paying the first installment. Hospital users on this candidate have one
intake action. They use the same opaque institution references for corrections
and provide the current revision. Patient reference commitments and routine
clinical fields enter Fabric as transient inputs and are retained in the
Hospital/Insurer/Oracle private collection. A digest and revision number
identify the committed record. Use synthetic data for rehearsal.

## Acceptance scope

Items 1–5 add issued medical terms, the existing shared OTP/EFT schedule,
hospital intake without suspicion labels, and stable private episode revisions.
Items 6–10 add insurer verification of patient associations, private discovery,
filing receipts, prefilled and reconfirmed claims, reimbursement quotes, coverage
reservation, and version-pinned frozen XGBoost verification. The Bank reads only
the existing financial claim and settlement fields. Legacy claim submission and
appeals are unavailable on the new channel so they cannot bypass the medical
rules. The prior channel retains its existing workflows.

An optional research finding form is available to one designated insurer
investigator on the medical channel. Set `MEDICAL_FINDINGS_INVESTIGATOR` to
the insurer demo account ID and `MEDICAL_FINDINGS_ROOT` to a private absolute
directory specific to the deployment. Secure and back up that directory.
Record a finding only after completing an independent investigation against
the current settled or rejected claim version. Supply a reference to that
investigation. The stored record contains its hash, the finding, claim version,
designated account and timestamp. It is stored by the web service. It leaves
the ledger and any training datasets unchanged. The same finding can be
confirmed again after an uncertain response.

## Isolated run

The preserved 1.8.0 medical acceptance channel is committed at sequence 2. To resume that isolated profile,
use the read-only checks below. Verify all five peer definitions
and compare the package archive to the source before running the app. Use schema
15, the medical channel name, `FABRIC_XGBOOST_ENABLED=true`, a protected local Oracle
registry token, and separate evidence, operation journal, OTP, event and Oracle
state roots. Build and start the web server in a separate Fabric checkout or
build directory so the November standalone demo stays intact. Configure three
existing Oracle profiles for the same medical channel, its private registry URL,
and those deployment-specific worker roots. Use local demo delivery when rehearsing.
On Windows, check the host TCP reservation ranges if the Oracle peer port is
unavailable. Set `FABRIC_ORACLE_HOST_PORT` before guarded Compose startup and
point `FABRIC_ORACLE_PEER_ENDPOINT` at the same host port. The peer's internal
port and identity stay the same. The default host port is 13051.

After the medical web server on port 3210 and all three workers are ready, run the
dedicated browser rehearsal from the Fabric root:

```powershell
$env:FABRIC_CHANNEL_NAME = 'insurance-medical-reimbursement'
$env:MEDICAL_REVIEW_LIVE = 'true'
$env:MEDICAL_BENCHMARK_EXISTS = 'true'
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path (Get-Location) ".local-reference/medical-live-$(Get-Date -Format yyyyMMdd-HHmmss)"
node apps/web/node_modules/@playwright/test/cli.js test --config apps/web/playwright.medical.config.ts
```

Set `MEDICAL_DEADLINE_LIVE=true` for the separate recovery and PDF/JPEG
rehearsal. Set `MEDICAL_EVENT_PROJECTION_PATH` to the isolated medical event
projection JSON to match OCR receipts against committed events. Short
deadlines are supplied through the authenticated API for the test. Reviewer
access and OCR use the ordinary browser controls.

For final acceptance, first run `MEDICAL_FINAL_PAYMENT=true` with only
Oracle workers 1 and 2 running and the challenger shadow artifact configured.
Use an existing synthetic SURGERY benchmark via
`MEDICAL_BENCHMARK_EXISTS=true`. The fixture performs a concurrent filing,
an underfunded transfer, later funding and a browser-side lost response.
Keep its saved case and journal if it is interrupted. Read back any transfer
before creating a new Bank instruction. Then unset `MEDICAL_FINAL_PAYMENT`,
restore the third worker and run the governed rehearsal above with
`MEDICAL_PRIOR_CLAIM_ID` set to the settled routine case for a readback after
the corrected appeal's payout.

On the rehearsal machine the medical channel and fixtures already exist.
If no other Fabric profile is running, the retained local helpers can resume it
without another lifecycle deployment:

```powershell
$env:FABRIC_ORACLE_HOST_PORT = '23051'
$env:FABRIC_CHAINCODE_BUILDER = 'block-insure/fabric-ccenv:2.5.16-go1.26.10'
$live = '.local-reference/medical-review-20261119/live-180'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
.\scripts\low-memory-network.ps1 Start -CoreOnly -ChaincodeVersion 1.8.0-medical
& "$live/run-native.ps1" -Action warm -LogName "warm-resume-$stamp.log"
& "$live/server-controller.ps1"
```

Use the port if it is still available. The existing local controller uses
23051 and serves the app on `http://127.0.0.1:3210/workspace`. It reads the
already built medical app and private medical state. The `warm` action audits
the exact archive, peer definitions and schema without writing business state.

1. Register synthetic Hospital and Bank partners and accounts, publish a package
   with medical rules, acquire it as the holder and pay a covered installment.
2. Save a synthetic Hospital episode with its documented service and invoice
   dates. Find it in the insurer's queue and verify the association using a
   source reference known to the insurer. Use another synthetic episode to
   exercise an ambiguous association without exposing it to the holder.
3. Register an insurer-sourced benchmark for each participating hospital and
   service. Its expected charge range and recorded license status must come
   from the documented fixture. The frozen evaluator will fall back to review
   when required context is missing, including unlinked history. It never fills
   missing values with inferred hospital labels.
4. Load verified episodes as the holder. Prepare the claim, review the calculation
   and submit using the same original deadline. Attach the invoice if required.
   Start processing as insurer and confirm the pinned request uses the calendar
   and model identity expected by all three workers.

Source tests use the BDT 100/80/8/57.60/40 example, an unverified association,
a second claimant and a corrected revision. A live browser rehearsal and
new-package/channel verification are separate from these source tests.

## Verification on 18 November 2026

| Checkpoint | Result |
| --- | --- |
| After items 1–5 | PASSED full Go suite, 122 web unit tests and web typecheck |
| After items 6–10 | PASSED full Go suite and Go vet, 123 web unit tests, lint and typecheck, 27 worker tests and the frozen evaluator hash check |
| Isolated standalone build | PASSED on final source, with existing filesystem tracing warnings. The first refresh failed on stale copied TypeScript types. Synchronizing the matching source files resolved it. The filing warning was moved out of render and uses the recorded preparation timestamp |
| Medical package | PASSED offline source match for all 30 runtime files, `1.7.0-medical`, SHA-256 `29a873fb43d093482b53f536e8ce83c1a76da7c1a79152c3bee61538d7d53594` |
| Live medical channel | UNTESTED at this source checkpoint. See the 19 November live acceptance record above for the subsequent deployment and browser results |

Final local package and evidence are under
`.local-reference/medical-reimbursement-20261118/`. Use the archive in
`final-package/`, which includes the duplicate association confirmation fix.
The intermediate archive is retained as earlier evidence. Existing Fabric
volumes and channel definitions were not reset or upgraded.
