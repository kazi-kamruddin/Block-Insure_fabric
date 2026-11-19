# Medical review, appeal and OCR acceptance

19 November 2026. Fabric items 12–15, developed from `2e431a0` for schema 15.
The original BDT 40 rehearsal was on `1.7.0-medical`, sequence 1,
on `insurance-medical-reimbursement`.

## Live activation and combined rehearsal

**PASSED** on 19 November 2026. All five peers reported the source-matched
`1.8.0-medical` package at sequence 2 and schema 15 on
`insurance-medical-reimbursement`. Lifecycle approvals were limited to that
channel. The collection definition and endorsement policy were retained.

The final Playwright run passed 1/1 in 9.8 minutes with zero retries. It
used the real Next.js Gateway, three Oracle worker identities and all
five Fabric peers. The combined case covered these checks.

| Check | Live result |
| --- | --- |
| Clarification | A BDT 950.00 synthetic bill triggered `XGB_REVIEW`. Voting was disabled while the clarification was pending. The holder committed and uploaded the exact encrypted attachment, version 2 received fresh matching Oracle results, and the old review was superseded. |
| Review and OCR | The four assigned auditors decrypted the evidence after the holder signed out. Three confirmations denied opening with an actionable message. The fourth opened voting. Auditor 1 confirmed and downloaded a corrected OCR receipt for the PNG invoice, and the test matched the `MedicalOCRConfirmed` ledger event to the same evidence and hashes. Two reasoned rejections closed the initial review. |
| Corrected appeal | Hospital corrected the bill to BDT 500.00. The holder confirmed the recalculated BDT 40.00 amount and uploaded the new evidence. Version 3 reached positive exact Oracle consensus and still required adjudication. The same four auditors received fresh grants and confirmed both documents. The prior grant was denied. Three approvals overturned the appeal. |
| Finality | The Bank made exactly one BDT 40.00 payout, duplicate confirmation was denied, and independent readback found the new claim `SETTLED` and its appeal `OVERTURNED`. The earlier sequence-1 claim remained `SETTLED`. |
| Preservation | All 20 protected peer/channel heads and all 49 original Docker volumes matched before and after. The November demo build and the sibling Solidity repository were left intact. |

The final claim is `medical-0a05d6af-19a2-49c6-8792-4c72cfa6fe38`. The
appeal is `appeal-6dd2226d-e7ab-4aca-94dd-19dfe895854c`, the OCR receipt is
`ocr-1679ddbf-ee97-4983-96a6-c4fc04cbb023`, and the Bank transfer is
`med-payout-c0791a6e-ef0`. The frozen evaluator was
`fabric-xgb-synthetic-v1` at
`4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4`.
Typecheck, lint, production build and all 125 web tests passed after the
Gateway error fix.

The first live browser run was interrupted after Playwright stalled reading
the OCR response body. Its download and committed OCR event were recorded.
The revised test checks the actual downloaded JSON and ledger event. The
second run confirmed the ledger denied early voting but exposed the Gateway's
generic error. The web route now returns the missing-auditor message. The
same three-confirmation case reproduced the expected denial with readable
feedback before the full rerun. Both partial cases had zero payouts.

Local evidence is under `.local-reference/medical-review-20261119/live-180/`.
See `deploy-180.log`, `warm-180.log`, `browser-03/report.json`,
`live-verified.json`, `preservation.json`, `browser-01-disposition.json`,
`browser-02/report.json`, `review-denial-rerun.json` and
`resource-shutdown.json`. Shutdown stopped the five owned app processes and
16 owned containers and released the rehearsal ports.
The combined case used PNG and completed on time. A separate live case below
exercised expiry, procedural recovery, PDF and JPEG.

## Live deadline recovery and PDF/JPEG follow-up

**PASSED** on the same package, sequence 2 and schema 15. All five peers
verified the package on resume.

1. Fabric denied early expiry. After the preparation deadline, a valid
   commit closed the original review as `ACCESS_FAILED`. One procedural
   recovery kept the same four auditors, the same claim version and the
   BDT 40.00 reservation.
2. The recovered round denied an original grant. Each assigned auditor
   decrypted both freshly granted documents while the holder was signed out
   and acknowledged readiness. The same-origin browser extracted the
   invoice number, service date and total from the PDF and JPEG. It accepted
   an edited total, downloaded each private receipt, and matched both
   receipts to committed Fabric events.
3. Fabric denied opening with only three confirmations per document. Voting
   opened with all four. One approval did not reach quorum. Actual voting
   expiry committed `TIMED_OUT`, the claim remained `REJECTED`, and Fabric
   denied a second procedural recovery. This fixture made zero payouts.

The first run committed preparation expiry and recovery, then timed out
during a browser role switch. The runner now allows up to 45 seconds for
role navigation. The resumed test checked the recorded claim, review and
attachment IDs, then continued the same case without paying another
premium. The resumed run passed 1/1 in 4.3 minutes. The case ID is
`medical-ccf57591-37fc-443f-a5e8-ec03d1a774fb`.

All 20 protected peer/channel heads and 49 Docker volumes matched. The
prior successful appeal claim was still settled. The five owned app
processes and 16 owned containers were stopped. Evidence is retained under
`.local-reference/medical-deadline-ocr-20261119/`, including both browser
reports, `live-verified.json`, `preservation.json` and
`resource-shutdown.json`.

## Implementation and initial source acceptance

| Item | Requirement and behavior | Result |
| --- | --- | --- |
| 12 | An insurer may request one pre-vote clarification per substantive round. An answer or explicit unavailability leaves the claim version in place. Material clarification supersedes the old review, keeps the episode reservation, and requires fresh pinned Oracle verification. A committed new attachment must be registered before that verification. | PASSED in the combined Go scenario, including denial while the question is pending and denial of a second request following a successor. |
| 13 | Review prepares before the voting clock starts. The holder grants each listed attachment to the assigned four. Each auditor opens their own grant, decrypts, validates the content hash, and acknowledges readiness. All four receipts and grants valid through the deadline are required per attachment. Structured-only cases use the verified episode and accepted statement where eligible. A preparation failure or vote timeout can use one claim-wide recovery with the same panel and fresh grants. The decision thresholds remain three approvals or two rejections. | PASSED for readiness denial, stale grants, access-preparation expiry, one recovery, and reasoned votes in Go. The browser test verified decryption against synthetic ciphertext. |
| 14 | The appeal disputes a recorded rejection and commits a newly registered document or an accepted quote for a corrected episode. Its successor requires verification and then a new review with the same four even when Oracle consensus is positive. The episode keeps one coverage reservation. | PASSED in Go for the new-document appeal, reserved BDT 40, unassigned voter denial, and overturn by three votes after two initial rejections. Corrected-episode appeal and timeout recovery remain UNTESTED live. |
| 15 | Policyholder or assigned auditor runs OCR on authorized decrypted evidence. English PNG, JPEG and PDF are supported up to 10 MiB, with a selected PDF page among the first ten. The user compares invoice number, date and BDT total with the source and can correct the fields. The private receipt contains the suggestions and confirmed fields. The chaincode binds the source evidence and records the engine identity, low-confidence flag and salted hashes. OCR leaves claim terms, amounts, model features and votes intact. | PASSED for the receipt transaction in the combined Go scenario and for real browser AES decryption, PNG/PDF OCR, field correction and receipt download on synthetic invoices. JPEG was UNTESTED in the browser rehearsal. |

Audit receipts identify the authorized account and bound document. A reviewer
acknowledges the successful browser integrity check before voting. The Gateway
encrypts clarification and appeal text with AES-256-GCM before sending it as
transient input. The existing multi-organization collection stores ciphertext.
The Gateway opens messages for authorized case participants. Votes expose a
controlled reason code and a digest of the
reviewer's private reference. The frozen evaluator, its operating point, and
the exact 2-of-3 Oracle agreement remain in use. The worker recognizes the
new version-pinned non-appeal clarification successor.

## Offline verification before activation

- **PASSED** Go tests, vet, module verification and offline package/source
  comparison using the patched Fabric builder. The combined Go test runs
  real chaincode methods against the repository's in-memory ledger fixture.
- **PASSED** web typecheck, lint, production build and 124 web tests, including
  the encrypted note round trip and rejection under the wrong key or context. The
  isolated browser ran the standalone build with no Fabric identities and
  mocked evidence retrieval and receipt posting. The final PNG/PDF test
  passed twice in succession. It checked
  that the OCR code made no off-origin HTTP requests and that the receipt
  request contained hashes without the invoice field values.
- **PASSED** 28 Oracle worker tests, including the medical successor guard
  and retained evaluator fixtures. Frozen evaluator identity and the workflow
  and research regression checks passed.
- **PASSED** npm audit at the CI high-severity threshold. The report listed
  seven moderate findings in the pre-existing ESLint dependency path to
  `minimatch`.
- **FAILED, fixed and rerun** the first production typecheck used an option
  removed from the locked PDF.js API. The Go verification command also first
  passed a Bash-specific expansion to `sh`. The source option was removed and
  the test command rerun with Bash.
- **FAILED, fixed and rerun** the second browser run exposed stale OCR controls
  during a new retrieval. The view clears prior decrypted evidence as retrieval
  starts, and the test checks that each receipt binds its own access ID. The
  first offline rebuild following the note privacy fix pointed Go at the wrong
  module cache mount. The final build used the explicit cache path.
- **FAILED, fixed and rerun** lint after a build picked up the browser assets
  copied from dependencies. The lint configuration now excludes that generated
  directory.
- The live 1.8.0-medical paths were UNTESTED at this offline checkpoint.
  The live results above apply to the later activation.

Local logs and outputs are under `.local-reference/medical-review-20261119/`.
See `package-03/build.log`, `package-03/source-audit.json`, `build-03.log`,
`regressions-02.log`, `browser-02/report.json` and `browser-03/report.json`.
The audited package ID is
`insurance-contract_1.8.0-medical:79132734225c138f30a3a16909981c893ba8935271568bdbee8220f1758de396`.
The source audit matched all 36 deployable Go files and module manifests.
Docker showed zero running containers and 49 volumes after verification.
This run did not start a Fabric peer or write to a channel.

## Repeat rehearsal on the activated medical channel

Keep the existing demo bound to its original build, package and data roots.
Verify the committed medical channel, sequence and exact package on all five
peers before starting the matching app. Use an isolated web build, worker roots and evidence
stores. Set `FABRIC_MEDICAL_REVIEW_ENABLED=true` for that web profile and
provision `FABRIC_MEDICAL_REVIEW_NOTE_KEY` as 32 random bytes encoded as 64
hex characters. Preserve the same key across restarts and protect its backup.
It is a server-held key for review messages. Uploaded evidence keeps its own
browser encryption and recovery path. Verify the three Oracle workers use the
matching registry and channel.

1. Submit a synthetic medical claim that reaches review. As insurer, load it
   in **Medical review and appeal**, prepare four-auditor review and send a
   clarification. Try opening voting while the response is pending.
2. As holder, give a material response, upload its exact committed bytes as
   `CLARIFICATION_DOCUMENT`, and request fresh verification. After the
   successor enters review, grant the listed evidence to the four reviewers.
   Verify the original review and grants cannot be used. Provide the document
   passphrase to the assigned reviewers through the rehearsal's private
   key-sharing channel before the holder signs out. The ledger grant controls
   ciphertext access.
3. Sign out the holder. In each auditor role, open the assigned evidence and
   confirm decryption. On an invoice, compare OCR against the page, correct
   a field, record the confirmation and retain the private receipt. Before
   the fourth reviewer confirms, verify that opening voting fails.
4. Open voting. After two reasoned rejections, file an appeal for the
   disputed decision with supporting new evidence or a corrected episode.
   Commit the new attachment as `APPEAL_DOCUMENT` where applicable. Verify
   the appeal with a fresh request and prepare the same panel.
5. Confirm the appeal's evidence with the new grants. Open voting, record
   three approvals, and verify Bank settlement and duplicate denial. On a
   separate claim, exercise expired preparation and the single recovery.

The combined browser test runs with the isolated application ready on port
3210. It begins with a synthetic BDT 950.00 bill outside the registered
SURGERY benchmark and ends with a corrected BDT 500.00 bill. Both quotes
retain the BDT 40.00 coverage cap. It uses a new fixture identity per run.

```powershell
$env:FABRIC_CHANNEL_NAME = 'insurance-medical-reimbursement'
$env:MEDICAL_REVIEW_LIVE = 'true'
$env:MEDICAL_BENCHMARK_EXISTS = 'true'
$env:PLAYWRIGHT_OUTPUT_DIR = Join-Path (Get-Location) ".local-reference/medical-live-$(Get-Date -Format yyyyMMdd-HHmmss)"
node apps/web/node_modules/@playwright/test/cli.js test --config apps/web/playwright.medical.config.ts
```

Set `MEDICAL_BENCHMARK_EXISTS` after confirming the previously registered
synthetic SURGERY benchmark. Set `MEDICAL_PRIOR_CLAIM_ID` to include the
before-and-after readback of an earlier settled synthetic claim.
