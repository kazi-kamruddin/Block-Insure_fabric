# Current candidate demonstration

From the Fabric repository root in PowerShell:

```powershell
.\scripts\workflow-demo.ps1 Start
.\scripts\workflow-demo.ps1 Status
.\scripts\workflow-demo.ps1 Stop
```

Open http://127.0.0.1:3200/workspace. The default Candidate profile resumes the
existing insurance-workflow-alignment-20261108 channel, schema15,
insurance-contract 1.6.3-xgb-alignment/sequence 4. Its package SHA256 is
bc2a30f5b434c73649f765a31232892941ced4f617c7f5518cf399af8457c44a.
No channel creation, package deployment, seeding, enrollment or reset occurs.
Solidity is neither used nor modified. The October profile remains available
explicitly with -Profile Historical, using its own matching application build.

## Prerequisites and custody

Docker Desktop must be healthy; existing identities, peer/CouchDB/orderer volumes,
candidate archive, patched builder image and web dependencies must already exist.
Build apps/web before startup if its source changed; Start does not rebuild.
The Go source/archive check refuses changed chaincode or a missing exact archive.
Five-peer installed/approved/committed checks precede read-only schema warming.
The guarded launcher drains historical cold-start runtimes before adding load.
Keep compilation separate from cold network startup on this8GB machine.

Restore data/candidate-demo/secrets.json from the protected local backup. It holds
the original AUTH_SECRET, OTP_SECRET and ORACLE_REGISTRY_API_TOKEN as string
properties. The launcher requires at least32 characters for each; it never prints
or regenerates them. Existing ciphertext, protected OTP/journal state and worker
decisions require their original custody material. This machine's original values
were restored once during the launcher migration, with no value committed.
The supervisor does not depend on ignored test helper scripts. Back up its private
configuration with the deployment's identities and all retained data roots.

The selected roots remain data/oracle-alignment-20261108,
data/events-alignment-20261108, data/evidence-alignment-20261108,
data/otp-alignment-20261108 and data/workflow-operations-alignment-20261108.
The local profile explicitly disables external email delivery; OTP codes appear
as labeled demo codes. This does not establish real provider/inbox delivery.
Private keys stay behind the Gateway. Secret encryption is server custody.

## Supervision and recovery

Start runs the web app, three Oracles and the event projection/notification
worker. Readiness checks the selected ledger/schema, all workers and exact owned
process identities. Repeating Start on a ready profile reuses its processes.
An incomplete owned application set is restarted. Reused PIDs are preserved as
unrelated processes; an occupied unrelated application port rejects Start. A file
lock prevents simultaneous launcher actions. Timestamped
logs and process/network ownership records remain under ignored data/candidate-demo.
Background Node processes use hidden detached execution with file logs and ignored
input. PowerShell5.1 and7 decode the same ownership records. The automated rehearsal
keeps a task-owned host session alive; Node pipe-capture behavior on this Windows
host is recorded separately from in-process launcher return and service readiness.
Status prints JSON with READY or STOPPED_OR_NOT_READY; it does not create business
transactions. Detailed package verification is saved at startup.

Stop validates process start times and exact container IDs before stopping only
owned resources. It retains every volume, identity, ciphertext, journal and
checkpoint, including ownership records. Replaced resources require inspection;
the supervisor will not assume ownership from a familiar name. For an application
rebuild, use Stop -KeepNetwork, build, then Start to reuse the running network.

Scheduled EFT execution remains available. Default startup leaves queued
collections for the ordinary Bank form, avoiding automatic processing of old
synthetic fixtures during a presentation. Explicit Start -AutomaticCollections
also runs the existing recurring collection worker against this candidate only;
it can process all due candidate work. Stop before changing modes. The event and
collection workers use local URLs and server-derived internal credentials.

## Browser rehearsal

Use the sign-in cards, guided action selector and labeled forms, not raw JSON.
Only synthetic data belongs in these demonstrations. Keep all newly created IDs
unique. Historical dates below are explicit fixture dates, not live banking time.

1. Insurer creates/publishes a package and its Hospital/Bank network. Bank opens
   customer/premium/reserve accounts. Holder acquires the published terms.
2. Request/approve a mandate and queue its first installment. Holder authorizes
   that same installment with a demo OTP. Bank reconciles the queued work without
   another debit, then collects the next installment by EFT. Download the holder's
   statement and check two payments and consistent balances.
3. Hospital creates a finalized invoice and immutable model source facts using
   ordinary forms. A different Hospital cannot change it. Holder submits a claim,
   encrypts/uploads the invoice, retrieves and actually decrypts it. Insurer starts
   processing and waits for the request-pinned exact2-of-3 Oracle result.
4. Demonstrate a separate documented synthetic model-only review case. Share
   primary/optional evidence with exactly four auditors before opening the clock.
   Sign the owner out; an assigned auditor decrypts the original document locally.
   Two rejections reject the first review.
5. Holder appeals with a corrected Hospital reference and the committed version2
   APPEAL_DOCUMENT. Optional documents are accepted with the initial claim;
   the retained appeal rule rejects other document types or mismatching content.
   Old votes cannot decide the new round, and an old document's grant cannot
   authorize the corrected document. Assigned reviewers retain authorized case
   history access; historical evidence does not count as current primary evidence.
   Open a new four-person review; two
   approvals leave it open and the third approves. Model advice does not decide
   fraud or substitute for human authority.
6. Insurer authorizes settlement. Bank records insufficient funding, credits the
   synthetic reserve and completes one payment. A repeated settlement cannot
   credit the customer again. Check the essential role screens at320px.

The maintained automated rehearsal makes business mutations through those visible
controls. Authenticated API reads observe ledger state; one stale-evidence access
probe is explicitly an API denial check. Actual browser encryption/decryption and
plaintext/statement downloads are verified. It does not establish every optional
workflow, real medical truth, production security or new performance results.

The model-only fixture uses `synthetic-ui-context-v1`: before inference it selects
the newest unused synthetic calendar year from2025 down to2000 using the invoice
archive. Existing records are neither deleted nor filtered out of inference.
The fixture adds one prior invoice datedJune3 and evaluates a June12 invoice;
the actual pinned observation must contain exactly one nine-day prior, the
paired history feature and frozen score90846555. Relative dates, BDT mapping,
weights and operating point remain unchanged. These are explicit historical
business-date simulations, not claims about contemporary patients. Repeating a
fixed June2026 date on this used ledger previously added eligible history and
correctly changed the model recommendation; that failure/comparison is retained.
If no unused cohort remains, the test stops for fixture review. It never searches
scores or changes thresholds to obtain the desired outcome.

After the candidate is READY, run from the Fabric root:

```powershell
$env:FABRIC_CHANNEL_NAME = 'insurance-workflow-alignment-20261108'
node apps/web/node_modules/@playwright/test/cli.js test --config apps/web/playwright.rehearsal.config.ts
```

The config requires that exact isolated channel and checks the running server's
actual channel/chaincode/schema before any mutation. It uses one browser worker and no
automatic retries, and creates unique synthetic fixtures. Reports/traces stay in
ignored apps/web/test-results/rehearsal unless an explicit ignored output directory
is selected. Preserve original failures before fixes and reruns. The maintained
alignment record and [10 November results](results/candidate-rehearsal-2026-11-10.md)
qualify the final acceptance status. The complete two-test batch, an additional
preflight-enabled recovery run, 11 offline tests and five mobile role viewports
passed. All task-owned services were stopped after verification; Start resumes
the preserved candidate state.

Evidence upload distinguishes a definite endorsement rejection or committed
INVALID from an unknown submit/status outcome. Ciphertext is retained in each
case. Pending uploads show Retry original ciphertext beside the form and freeze
identifiers/re-encryption until that attempt is reconciled. Keep that page open;
this is not a promise of restoring unsaved browser File objects after reload.
