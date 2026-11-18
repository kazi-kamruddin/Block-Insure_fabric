# Medical review, appeal and OCR acceptance

19 November 2026. Fabric items 12–15, developed from `2e431a0` for schema 15.
The live BDT 40 rehearsal remains associated with `1.7.0-medical`, sequence 1,
on `insurance-medical-reimbursement`.

## Changes and acceptance

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

## Verification evidence

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
- **UNTESTED** live 1.8.0-medical review, appeal, cross-peer private-data
  authorization and end-to-end OCR receipt commit. The successful 1.7.0
  browser payout remains a separate deployment result.

Local logs and outputs are under `.local-reference/medical-review-20261119/`.
See `package-03/build.log`, `package-03/source-audit.json`, `build-03.log`,
`regressions-02.log`, `browser-02/report.json` and `browser-03/report.json`.
The audited package ID is
`insurance-contract_1.8.0-medical:79132734225c138f30a3a16909981c893ba8935271568bdbee8220f1758de396`.
The source audit matched all 36 deployable Go files and module manifests.
Docker showed zero running containers and 49 volumes after verification.
This run did not start a Fabric peer or write to a channel.

## Rehearsal after authorized activation

Keep the existing demo bound to its original build, package and data roots.
Before using this candidate, review a medical-channel-only activation,
capture the existing definitions and ledger heads, verify the exact new
package and collection definition on all five peers, and confirm the next
lifecycle sequence. Use an isolated web build, worker roots and evidence
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
