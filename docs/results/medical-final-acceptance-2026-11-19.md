# Final isolated Fabric medical acceptance

**PASSED** on 19 November 2026 for the isolated medical demonstration.
The routine recovery and governed appeal cases each had exactly one
BDT 40 payout. The governed case ran for 475.3 seconds with zero retries
against a standalone build of the current web sources.

## Deployment and scope

- Channel `insurance-medical-reimbursement`, chaincode `1.8.0-medical`,
  sequence 2, schema 15. The package is
  `insurance-contract_1.8.0-medical:79132734225c138f30a3a16909981c893ba8935271568bdbee8220f1758de396`.
  All five peers reported the exact package and schema after Docker resumed.
  The archive matched all 36 runtime files, including the module manifests.
- Frozen evaluator `fabric-xgb-synthetic-v1`,
  `4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4`.
  The separately pinned challenger artifact is
  `1bc58b5db36a73bf07a5333c139c2ba085236f13a409b7e60bb0f9ac08cc1f67`.
- Synthetic local identities and BDT accounts, Fabric Gateway and a real
  Chromium Edge browser. Demo OTP delivery stayed local. The lost HTTP
  response was injected in the browser after the real Bank operation
  returned a valid commit. The workers, Bank transfer and ledger were live.

## Acceptance results

| Point | Result | Evidence |
| --- | --- | --- |
| 6. Patient–episode association | PASSED | An unresolved episode could not be quoted. The insurer verified the intended match, and the holder could neither discover nor quote another patient's verified episode. Caller-controlled amount, stale revision and wrong accepted-terms hash were refused. |
| 11. Bank payout and recovery | PASSED | Concurrent filings for one episode produced one claim and one MVCC rejection. The authorized payout bounced at zero reserve, then a later funding operation enabled one valid BDT 40 payout. The browser dropped the valid response and recovered the saved action after reload. A second confirmation was refused and the ledger contained one settled transfer and one bounced transfer. |
| 16. Separate research finding | PASSED | The designated insurer investigator explicitly recorded a finding for the settled version. Hospital and holder were denied. The same submission recovered the original finding, a conflicting one was refused, and the settled claim stayed unchanged. |
| 18. Challenger comparison and shadow | PASSED for offline comparison and live shadow | Both active workers scored the same eligible packet using the same artifact and input hashes. The two integer scores matched exactly, while the frozen evaluator finalized the authoritative result with two reveals and one assigned worker offline. Challenger promotion remains HOLD. |
| 19. Final governed browser leg | PASSED | Clarification led to version 2 and superseded the first review. Four assigned auditors confirmed decryption with the holder signed out. A corrected PNG OCR receipt matched its committed event. Two rejections closed the initial decision. Hospital corrected the episode and the holder appealed at version 3. The stale grant was denied, the same panel reviewed again and three approvals overturned the rejection. The Bank paid once and refused a duplicate. The routine payout remained settled. |

The routine case was `medical-e019cbd4-eccc-4c2d-8ab5-d5a5e4b856b8`.
Its authoritative readback joined the policy, episode, claim version,
payment of 4,000 minor units (BDT 40) and settled transfer. Fabric emitted the
settlement confirmation in block 279 in transaction
`31e1149bf8b6bc58ae1911b27f664184894f111f5cd42ba4aee0cf04504f7824`.
The same request produced challenger scores 6,506,573 and 9,005,829
integer units on both active workers. This is one paired live input.

The governed claim is `medical-90a942be-01ac-4792-9d8b-f94e17f7fc66`.
Oracle versions 1 and 2 reached matching negative results, and version 3
reached matching positive results. The three requests preserved the same
frozen identity and quorum. The dossier confirmed three version-bound
reviews, all using the same four auditors and published thresholds.
The appeal `appeal-706cdd54-0ce8-4cd7-85b7-4dc0b235dcd8` was
`OVERTURNED` and the claim was `SETTLED`. OCR receipt
`ocr-2bbf0e55-f36c-4f61-8261-29febace73a3` committed in block 313.
Transfer `med-payout-ed53f713-cfd` committed in block 358 in transaction
`0ee0bf86551e1f333a9d02f54ae48abc547ec38e1cdebffce6ef48074b624707`.

The current isolated build passed web typecheck, lint, production build and
126 unit tests. Oracle worker tests passed 29/29, challenger tests 2/2,
frozen identity verification passed and all 144 integer scores matched
for the 24 primary and sealed replay inputs. The five role pages passed
a browser width check at 320px.
No lifecycle write or new enrollment was needed.

## Failure and recovery

The first payout browser attempt reached the underfunded bounce and later
funding. Its retry reused the bounced transfer's external bank reference.
Fabric correctly refused the reused reference before submitting another
payout. The browser fixture now assigns separate references. The retry
resumed the same funded claim and verified the bounce, funding and one
settlement without creating another claim or funding movement. The original
failure remains in `browser-payment-01.log` and its Playwright report.

The initial independent readback required a positive Oracle outcome on
every claim version. Fabric uses a separate negative finalization code
for versions 1 and 2 in this case. The corrected checker requires both
precise outcomes and at least two matching result hashes per version.
The repeat was read-only. The original assertion remains in
`final-audit.log` and its verified replacement in `final-audit-02.log`.

The first shutdown helper encountered already-retired chaincode runtimes
after stopping the peers. The follow-up checked exact container identities.
All 11 core containers were retained and stopped, their five ephemeral
runtimes had retired, and all five app processes had stopped. All 20
protected peer/channel heads and all 49 original volumes matched. No
rehearsal listeners or running containers remained.

## Evidence and limits

The private local evidence root is `.local-reference/medical-final-20261119/`.
Use `payment-verified.json`, `browser-payment-02/report.json`, the first
attempt's trace and the two Oracle logs to inspect the routine leg. The
[medical demonstration guide](../medical-reimbursement-candidate.md)
describes how to resume this deployment. Use `browser-governed-01/report.json`,
`final-verified.json`, `mobile-current.json`, `regressions-current.json`,
`warm-resume.log`, `preservation.json` and `resource-shutdown.json`
for final browser, source and preservation evidence. The
[sequence-2 review and OCR record](medical-review-ocr-2026-11-19.md)
covers the earlier separately verified deadline and PDF/JPEG fixtures.
The [challenger report](../fabric-ml-challengers.md) records sealed synthetic
workloads and the scientific eligibility limits.

The investigation record stores a version-bound outcome and a hash of an
independent investigation reference under an access-controlled local root.
Hospital intake, routing, claim status and missing outcomes do not assign
fraud labels. Investigation outcomes are separate from synthetic cohort
labels and the immutable historical study. No live findings enter training.

**HOLD** remains the challenger promotion decision. External email
delivery and preserved-channel activation were outside this isolated
rehearsal. The verified demo can use the existing isolated package with its
matching web build and retained state.
