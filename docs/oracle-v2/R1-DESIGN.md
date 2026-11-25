# R1 implementation and Phase 2B handoff

Date 2026-11-25 (Asia/Dhaka). Target `insurance-dev-lite-190`, LevelDB,
`insurance-contract` 1.9.0, schema 15. The Phase 2B offline R1 package
includes the default 192 MiB Go soft memory limit. The last peer
readback shows sequence 1 on all five peers, package SHA-256
`d6da2d7759681c5c50c895187844f3d6bd0e1b8a3caa31949c58e89000843ec9`.

## Route and claim 203

`CLM-2026-000203` is `SUBMITTED`, version 1, on `POL-2026-000103`
(`HLT-DGN-2026` DIAGNOSTIC) at Chattogram Metropolitan Hospital (`hospital-2`).
The retained ledger has the hospital's DIAGNOSTIC benchmark. The claim
qualifies under D7. It has no request and needs signed S-A, S-B and S-C
checkpoints, a three-subject roster, an active E2 release and a scoped OCR
receipt before a clean R1 journey. The seed has no v1 attestation for
Chattogram. R1 pins the signed feed checkpoints. An alternate claim needs
active paid diagnostic coverage, a supported hospital and service date, a
finalised dated episode with verified association and evidence, and the
same R1 source and release setup. Both choices require approval in 2B.

## Ledger interfaces and storage

Composite keys below are written with the Fabric stub. `~` separates
attributes in this description. Public state contains digests, opaque
references and governance metadata. Restricted medical payloads remain in
`oracleProofPrivateData` under its existing endorsement policy.

| Interface | State and validation | Result |
| --- | --- | --- |
| `ProposeSourceIssuer`, `ApproveSourceIssuer`, `RevokeSourceIssuer`, `ReadSourceIssuer` | `sourceIssuer~issuerId~keyVersion` and point indexes for the current authority per role/scope. Keys are unpadded base64url Ed25519 SPKI DER. Hospital approval requires InsurerMSP, AuditorMSP and that Hospital subject. Other kinds require InsurerMSP and AuditorMSP. Validity is half-open at request time. | Issuer versions and approval events. Refuse duplicate versions, wrong authority and ineligible or revoked keys. |
| `AnchorSourceFeed(issuerId,keyVersion,feedVersion,root,effectiveAt,coverageHash,signature)` | `sourceFeed~issuerId~feedVersion` and `latestSourceFeed~issuerId`. Verify signature over the canonical `oracle-v2:anchor` body. Record `anchoredAt`, submitter and signature. Retain older feeds. | Feed anchor event. Refuse bad signatures, duplicate versions, rollbacks and invalid intervals. |
| `ProposeOracleRoster`, `ApproveOracleRoster`, `ActivateOracleRoster`, `RevokeOracleSubject`, `ReadActiveOracleRoster` | Versioned `oracleRoster`, active pointer, per-subject revocation. Require InsurerMSP, AuditorMSP and OracleMSP and exactly three distinct subjects with key versions. | Roster approval and activation events. Rotation does not change the snapshot of an in-flight request. Revocation prevents further reveals by that subject. |
| `RequestOracleVerificationV2(requestId,claimId)` | Insurer-authenticated DIAGNOSTIC request using existing episode association, evidence and reservation checks. Lookup S-A by hospital and S-B/S-C by the diagnostic policy. Pin the current signed anchors, issuer versions, roster and E2 release, and store manifest hash and `diagnostic-v1`. Derive 60-second commit and 120-second reveal windows from the accepted transaction timestamp. | Standard `OracleVerificationRequested` event with protocol version. New medical v1 requests are closed on the R1 channel. Unsupported medical paths reach governed review. |
| `SubmitOracleCommitmentV2(requestId,commitmentHash)` | Existing per-subject submission keys plus `oracleCommitmentHash~requestId~hash`. Check request, clock, assignment, revocation and duplicate digest. | Standard `OracleCommitmentSubmitted` event. |
| `RevealOracleResultV2(requestId,factVectorJSON,decision,salt,workerDiagnosticsHash)` | Check canonical JSON, request and claim version, policy and manifest, pure decision and subject/channel-bound commitment. Match exactly two eligible results of three. Retain per-worker diagnostic hashes outside quorum. | Standard result and finalization events. `V2:<decision>:<factVectorHash>`; exhaustion with incompatible reveals is CONFLICT. Integrity failures and referrals are panel paths. |
| `ReadMedicalOracleSourcesForRequest(requestId)` | Require a pending, matching version and an assigned, non-revoked OracleMSP subject. Use `hospitalEpisodeByDate~hospital~invoiceDate~episode` plus a legacy read-only fallback. Scope strictly before the current invoice UTC day and at most 90 days back, with a 10,000-row post-window cap. Undated potentially prior episodes fail closed. | Current case and scoped private history; no full Hospital listing on the Oracle path. |
| Versioned benchmarks and receipt summary | Legacy benchmark lookups select latest date at or before service, with unversioned fallback. S-B is the trusted tariff/authority in v2. S-C keeps receipt or invoice number and lineage in private data with the existing amount, date and service checks. | New episode revisions require invoice date. Missing sources safely refer or block request creation with a visible recovery action. |
| Timeout, escalation and review expiry | Deadline actions for claimant, insurerAdmin or assigned auditor, with idempotent close. Escalation covers failed Oracle, unprepared review-required states and overdue medical audit. Insurer-caused access and initial preparation expiry resolve to recoverable `PROCEDURAL_FAILURE`. | Existing review and outcome events retained. Oracle failures never reject a claim. |
| Model release, hold and resume | `medicalModelRelease` and active routing pointer. New releases follow REGISTERED → SHADOW → APPROVED → ACTIVE; OracleMSP approval needs two distinct roster attestations of the same artifact. Activation delay is ten minutes. HELD and RESUME_PENDING require a fresh approval/attestation round to resume. Old promoted records retain historical compatibility. | Existing release update event and explicit activation. A single authorized approver can hold. |
| Effective certificate and settlement | Certificate binds v2 manifest, vector, decision and policy beside settlement terms. Store supersession as a separate immutable link so the original certificate bytes remain verifiable. Only effective certificates authorize/confirm. For held auto approvals retire unpaid authorizations, preserve reservations and allow panel replacement. Confirm already executed private Bank transfers with `postPaymentAuditRequired`. | Refuse a held, unpaid automatic settlement with `model held; settlement requires review`. A panel certificate remains usable. |
| `RecordLedgerInstance(id)`, `ReadLedgerInstance()` | Write-once insurerAdmin provisioning marker, with the block-1 hash retained as compatibility fallback. | App state binds to the verified ledger. A separately approved 2B transaction establishes the marker. |

The v2 evidence evaluator verifies each S-B origin against the S-A origin
closure and checks domain separation. S-C verifies transcription only.
Go validates the closed `integrity` enum and derives the verdict from the
canonical vector and pinned policy. Origin proof evaluation stays with
the assigned workers, whose signatures are part of the audited claim.
No PAYMENT source is required by the first R1 policy. D4, D5 and unmeasured
U46 optimizations remain separate. The legacy fallback for the date index
does not write during an evaluate and needs no migration transaction.

`ledgerNow` rejects skew above 15 seconds at endorsement. State uses the
validated transaction time, and calendar rules use a fixed UTC+06:00
Dhaka zone. This assumes honest, synchronized endorsers. Validation
does not repeat the wall-clock check. R1 tests cover the timing boundaries
and byte-for-byte Node/Go vectors from in-module test data. E2 has a
separate hash of its source and frozen provenance. Existing v1 requests,
commitments, results and dossiers stay on their versioned readers.

The E2 model version is `fabric-xgb-synthetic-e2`. The dev-lite profile
pins Node `v24.16.0` and E2 SHA-256
`6b0b1df713f9b28da89052bf748886d4d15d743ecd4adde30f3f15a9596f6166`.
The optional two-stage Bank path uses `ExecuteMedicalSettlementTransfer`
to bind the executed transfer and certificate privately. The ordinary
atomic `ConfirmSettlement` continues serving existing Bank clients.

[Formal checks](../results/r1-formal-2026-11-25.md)

## Phase 2B command sequence, for separate approval

The expected target is sequence **2**. Use the sequence readback and
the verified R1 package SHA-256 as conditions of the approval.
Package path `data/dev-lite/channel-artifacts/insurance-contract_1.9.0-r1.tar.gz`,
label `insurance-contract_1.9.0`, type `golang`, SHA-256
`50d2dfd84ee5083e589d165c1e5c2d40853a3da433f8b1dd9f9f8d514e5262a2`.
The reserved backup destination is
`data/dev-lite/backups/2026-11-25-pre-r1/`. Refuse to overwrite it if it
exists. These commands and operations are a handoff for 2B.

The proposed release ID is `r1-e2-20261125`, issued under
`diagnostic-v1`. The first roster is `r1-roster-001` with
`oracle1`, `oracle2` and `oracle3` at key version 1. Use the scoped
`S-A` key for `hospital-2`, `S-B` for the regulator and `S-C` for
receipt ingress. Source key versions, signed feed roots, claim fixture
IDs and the role-based signatures must agree with the approved 2B
inventory.

1. From the repository root, verify the package with `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/dev-lite/channel-artifacts/insurance-contract_1.9.0-r1.tar.gz'`. Stop the scoped app with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/dev-lite-app.ps1 -Stop`, then stop only the retained dev-lite stack with `wsl.exe -d Ubuntu --exec bash network/scripts/network.sh --dev-lite stop`. Keep named volumes.
2. After explicit backup approval, archive all six stopped, project-owned volumes and verify each archive. The cached pinned builder is used as a tar tool, mounting each source read-only. Preserve the backups and checksum inventory.

   ```powershell
   $backup = Join-Path (Resolve-Path '.') 'data/dev-lite/backups/2026-11-25-pre-r1'
   if (Test-Path -LiteralPath $backup) { throw 'Backup path already exists' }
   New-Item -ItemType Directory -Path $backup | Out-Null
   $units = 'orderer','peer-insurer','peer-hospital','peer-auditor','peer-bank','peer-oracle'
   foreach ($unit in $units) {
       $volume = "block-insure-dev-lite_$unit"
       $labels = docker volume inspect $volume --format '{{json .Labels}}' | ConvertFrom-Json
       if ($LASTEXITCODE -or $labels.'com.docker.compose.project' -ne 'block-insure-dev-lite' -or $labels.'com.docker.compose.volume' -ne $unit) { throw "Unexpected volume $volume" }
       docker run --pull never --rm --network none --mount "type=volume,source=$volume,target=/ledger,readonly" --mount "type=bind,source=$backup,target=/backup" block-insure/fabric-ccenv:2.5.16-go1.26.11 tar -czf "/backup/$unit.tar.gz" -C /ledger .
       if ($LASTEXITCODE) { throw "Backup failed for $volume" }
       tar -tzf (Join-Path $backup "$unit.tar.gz") | Out-Null
       if ($LASTEXITCODE) { throw "Archive verification failed for $volume" }
   }
   Get-FileHash -Algorithm SHA256 (Get-ChildItem -LiteralPath $backup -Filter '*.tar.gz').FullName | Export-Csv -NoTypeInformation (Join-Path $backup 'checksums.csv')
   ```

3. Resume the retained stack with `wsl.exe -d Ubuntu --exec bash network/scripts/network.sh --dev-lite up`. Run `wsl.exe -d Ubuntu --exec bash network/scripts/read-dev-lite-sequence.sh insurance-dev-lite-190 insurance-contract`. Inventory `ListOracleRequests` from Insurer with a Gateway evaluate. The Phase 2A read had zero pending medical v1 requests. The old `RouteOracleFailureToReview` accepts a finalized non-medical failure. If a new pending medical v1 request is present, stop for a revised drain approval naming the request and claim. After its reveal deadline, `FinalizeOracleTimeout` then `PrepareMedicalReview` is the deployed medical recovery path. No drain transactions are currently planned.
4. Install/approve/commit the separately approved package at sequence **2**, then verify readback.

   ```powershell
   wsl.exe -d Ubuntu --exec env DEV_LITE_PACKAGE=data/dev-lite/channel-artifacts/insurance-contract_1.9.0-r1.tar.gz DEV_LITE_SEQUENCE=2 bash network/scripts/network.sh --dev-lite deploy
   wsl.exe -d Ubuntu --exec bash network/scripts/read-dev-lite-sequence.sh insurance-dev-lite-190 insurance-contract
   ```

5. Submit `RecordLedgerInstance` once using the verified block-1 provisioning ID. Keep the existing app-state directory binding. For each of the Chattogram S-A, regulator S-B and receipt-ingress S-C owners, submit `ProposeSourceIssuer`, then the authorized `ApproveSourceIssuer` transactions. Hospital approval includes the Chattogram subject. Submit `AnchorSourceFeed` with each verified feed's issuer-signed checkpoint and coverage. Use dedicated adapter bearer tokens for the three Oracle profiles.
6. Submit `ProposeOracleRoster`, then `ApproveOracleRoster` from InsurerMSP, AuditorMSP and OracleMSP, then `ActivateOracleRoster`. Register E2 with `RegisterMedicalModelRelease`, followed by `ShadowMedicalModelRelease`. Have two assigned Oracle subjects submit `AttestMedicalModelRelease` with the same E2 artifact hash. Submit `ApproveMedicalModelRelease` from all three MSPs, wait at least ten minutes from approval, then `ActivateMedicalModelRelease`. Read back the active roster, issuer checkpoints and release.
7. Run the separately approved readied diagnostic fixtures in the following order. Each v2 request uses `RequestOracleVerificationV2` → at least two distinct `SubmitOracleCommitmentV2` → two exact `RevealOracleResultV2`, or `FinalizeOracleTimeout` after expiry when quorum is absent. On new claims, first run `SaveMedicalEpisode` → `VerifyMedicalAssociation` → `SubmitMedicalClaim` → version-bound `AddEvidenceReferenceForVersion` for the required documents → `RecordMedicalOCRSummary`. File the signed records in the scoped adapters before anchoring their next immutable checkpoints. The first journey can reuse claim 203 and its existing evidence.
   - Claim 203 clean route: `RecordMedicalOCRSummary` → v2 request and quorum → `AuthorizeSettlement` → `ConfirmSettlement`.
   - Contradiction, then U42 panel fallback: v2 request and referral → `PrepareMedicalReview` → `ShareMedicalReviewEvidence` → `ConfirmMedicalEvidence` for each assigned reviewer and document → `OpenMedicalVoting` → `RecordMedicalAuditorDecision` until the permitted threshold.
   - One worker offline: v2 request → two commits → wait for the commit deadline → two reveals → optional authorization and confirmation only if separately listed in the 2B approval.
   - Disposable A8 release: `RegisterMedicalModelRelease` → `ShadowMedicalModelRelease` → two attestations and three approvals → `HoldMedicalModelRelease` → `RequestMedicalModelResume` → two fresh attestations and three fresh approvals → wait ten minutes → `ActivateMedicalModelRelease`. Use an ADVISORY task to retain routing authority and record the release ID.
   - Failed-Oracle escalation: v2 request → `FinalizeOracleTimeout` after the reveal deadline → wait for the medical grace period → `EscalateStalledMedicalClaim`.
   - U20: v2 approval → `AuthorizeSettlement` → `HoldMedicalModelRelease` → check the refusal of a new confirmation → `PrepareMedicalReview` retires the unpaid instruction → panel vote sequence above → new `AuthorizeSettlement` → `ConfirmSettlement`. Record the specific release hold and resume operations in the signed approval.
   - U42 corrected appeal and final rejection: panel reject fixture by two distinct votes, corrected `SaveMedicalEpisode` and verified association → `SubmitMedicalAppeal` → version-bound evidence and receipt → fresh v2 request and panel review as above. Use a separate case for the final rejection by two votes and record its appeal-window status.
8. Record the actual transaction, request and claim IDs in the 2B run evidence. Update the deployed build profile after the five-peer readback and successful journeys, then run the maintained context sync checks.

## Live source data paths (25 November 2026)

- **S-A (hospital-2 invoices).** Facts are read only by the HospitalMSP
  `hospital2` identity from the Hospital peer (qscc scan of valid
  HospitalMSP-created `MedicalEpisodeSaved` events, revision hash checked
  against the Hospital's own admit inputs). No Insurer identity or Insurer
  Gateway is used. The S-A signing key stays in the adapter process under the
  ignored `data/dev-lite/source-adapters/keys/`, and `hospital2` approves the
  issuer and anchors every S-A feed version.
- **S-B (regulator).** Licence, accreditation and tariff records are
  simulated regulator data authored for the demonstration.
- **S-C (receipts).** Simulated claimant-receipt records derived from the S-A
  invoice record. The matching private receipt summary is recorded by the
  claimant against an encrypted receipt document.
