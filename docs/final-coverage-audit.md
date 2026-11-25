# Phase 3 coverage audit

Date 25 November 2026, Asia/Dhaka. A DONE row has evidence for the stated scope. PARTIAL separates passing code or historical evidence from the remaining acceptance step. Live R2 results are tracked in the [journey record](results/r2-journeys-2026-11-25.md).

| ID | Status | Evidence | Remaining limitation |
| --- | --- | --- | --- |
| U1 | PARTIAL | [R1 verification](results/r1-journeys-2026-11-25.md), [worker diagnostics](../services/oracle-worker/src/v2/diagnostics.mjs) | Historical v1 receipts checked in 2A. Complete live R2 per-worker receipt exports still needed. |
| U2 | PARTIAL | [Dossier verifier](../tools/verify-dossier/verify_dossier.py), [v3 mutations](../tools/verify-dossier/test_approval_v3.py) | Historical peer comparisons and v3 offline checks passed. Live R2 independent readback pending. |
| U3 | DONE | [Reason receipt implementation](../apps/web/components/review-reason-receipts.tsx), [verifier](../tools/verify-dossier/verify_dossier.py) | Gateway-custodied reason encryption. |
| U4 | DONE | [R1 source registrations](results/r1-journeys-2026-11-25.md) | HospitalMSP exports remain within the synthetic institutional scope. |
| U5 | PARTIAL | [R2 certificate builder](../chaincode/insurance-contract/src/medical_approval_v3.go), [v3 mutation tests](../tools/verify-dossier/test_approval_v3.py) | v3 and historical compatibility tested offline. Live v3 issuance and payout pending. |
| U6 | PARTIAL | [Role review UI](../apps/web/components/medical-review.tsx), [defence walkthrough](defence-walkthrough.md) | R2 workspace screenshots and live walkthrough pending. |
| U7 | DONE | [Frozen alignment](frozen-xgboost-alignment.md), [adapter sensitivity](results/adapter-sensitivity-2026-11-25.md) | Synthetic distributions and calibrated label limits remain. |
| U8 | DONE | [Thesis contribution](paper/contribution.md) | Scope is provenance-aware routing on synthetic facts. |
| U9 | DONE | [Phase 3 model evidence](results/r2-formal-2026-11-25.md) | Finite model. The JS default report path has a pre-existing sandbox write failure. |
| U10 | DONE | [Oracle experiment](results/oracle-v2-phase3-2026-11-25.md) | Multi-source agreement assumes its supplied authority and independence facts. |
| U11 | BLOCKED-TECH | [R2 journey record](results/r2-journeys-2026-11-25.md), [offline experiment](results/oracle-v2-phase3-2026-11-25.md) | Live 0.2 and 0.5 tx/s trials need a verified post-journey ledger and pre-measure restores. Analytical times are separate. |
| U12 | DONE | [ML evidence tables](paper/ml-evidence.md), [challenger replay](results/challenger-replay-2026-11-25.md) | Synthetic labels and workload. |
| U13 | PARTIAL | [Auditor disclosure](../chaincode/insurance-contract/src/medical_review_disclosure.go), [collection config](../network/config/collections_config.json) | Ledger hash against exact transient bytes verified in source. Live Auditor-peer read pending. |
| U14 | PARTIAL | [Auditor roster](../chaincode/insurance-contract/src/medical_auditor_roster.go), [R2 transition tests](../chaincode/insurance-contract/src/medical_r2_test.go) | Enrollment, roster activation, replacement and mixed appeal live evidence pending. |
| U15 | DONE | [Provenance](provenance.md) and [archive index](archive/README.md) | Some historical provisioning IDs were unrecorded. |
| U16 | DONE | [Oracle v2 vectors](../chaincode/insurance-contract/src/oracle_v2_vectors_test.go), [live R1 quorum](results/r1-journeys-2026-11-25.md) | Identical copied commitments cannot be counted as distinct responses. |
| U17 | DONE | [Ledger clock](../chaincode/insurance-contract/src/ledger_time.go), [R1 live evidence](results/r1-journeys-2026-11-25.md) | Operator checks Windows-to-peer skew before writes. |
| U18 | PARTIAL | [Escalation chaincode](../chaincode/insurance-contract/src/medical_escalation.go), [timeout journey](results/r2-journeys-2026-11-25.md) | Claim 206 retains its elapsed-time guard. R2 grace deadline path needs live exercise. |
| U19 | PARTIAL | [Vote visibility](vote-visibility.md), [sealed code](../chaincode/insurance-contract/src/medical_sealed_votes.go) | R2 has no live sealed ballot evidence yet. Old rounds preserve visible ledger votes. |
| U20 | PARTIAL | [Hold and certificate tests](../chaincode/insurance-contract/src/oracle_r1_test.go) | 209 hold-before-confirm and reauthorization are pending. |
| U21 | DONE | [R1 live release governance](results/r1-journeys-2026-11-25.md) | E2 active history verified. E3 and E2 resume have separate pending journey acceptance. |
| U22 | DONE | [R1 issuer, roster and live commits](results/r1-journeys-2026-11-25.md) | Same three assigned subjects and exact threshold. |
| U23 | DONE | [Hospital registration and R1 journeys](results/r1-journeys-2026-11-25.md), [source recovery](runbooks/medical-source-recovery.md) | Supports scoped current diagnostic sources. |
| U24 | DONE | [Scoped source reader](../chaincode/insurance-contract/src/medical_oracle_v2_sources.go), [worker tests](../services/oracle-worker/test/v2-protocol.test.mjs) | Window and maximum size remain bounded. |
| U25 | PARTIAL | [R1 live results](results/r1-journeys-2026-11-25.md), [Phase 3 offline comparison](results/oracle-v2-phase3-2026-11-25.md) | R2 live journey and transaction measurements pending. |
| U26 | DONE | [R1 design](oracle-v2/R1-DESIGN.md), [governance tests](../chaincode/insurance-contract/src/oracle_r1_test.go) | Only registered diagnostic feeds are active on this ledger. |
| U27 | DONE | [Worker source paths](../services/oracle-worker/src/v2/worker.mjs), [R1 evidence](results/r1-journeys-2026-11-25.md) | Simulated institutions share the host. |
| U28 | DEFERRED-BY-PLAN | [Memory-first scope and limitations](defence-checklist.md) | SBE pilot dropped with A6 per D9. Existing endorsement policy remains. |
| U29 | NOT-RUN (owner drill) | [Custody and F06](custody.md) | No separate Windows operator result located. |
| U30 | DEFERRED-BY-PLAN | [Visibility inventory](visibility-table.md), [limitations](defence-checklist.md) | D8 drops new public data minimization. Existing blocks keep original fields. |
| U31 | PARTIAL | [R2 nonce and E3 design](oracle-v2/R2-DESIGN.md), [signed worker fixture](../services/oracle-worker/test/v2-worker.test.mjs) | E3 release promotion and live nonce-bound dossier pending. |
| U32 | PARTIAL | [Three-share sampling](../chaincode/insurance-contract/src/medical_audit_sampling_v2.go), [Go test](../chaincode/insurance-contract/src/medical_r2_test.go) | Default and grace verified offline. No live governance period yet. |
| U33 | PARTIAL | [Overlap bucket and explanation](../chaincode/insurance-contract/src/medical_cross_hospital.go) | Cross-hospital live fixture and rationale disclosure pending. |
| U34 | PARTIAL | [Bank binding](../chaincode/insurance-contract/src/bank_subject.go), [Go compatibility](../chaincode/insurance-contract/src/medical_r2_test.go) | Legacy certificate lacks subjectId. Its verified enrollment mapping and Bank mutation checks need live R2 payout. |
| U35 | PARTIAL | [Retirement and reservation test](../chaincode/insurance-contract/src/medical_r2_test.go) | Retirement of a live unpaid approval pending. |
| U36 | DONE | [Web authorization and tests](../apps/web/lib/auth/accounts.ts), [custody limits](custody.md) | Demonstration authentication. |
| U37 | DONE | [R1 receipt comparison](results/r1-journeys-2026-11-25.md), [browser OCR acceptance](results/medical-review-ocr-2026-11-19.md) | Claimant-supplied receipt/OCR is scoped evidence. |
| U38 | DONE | [Worker identity tests](../services/oracle-worker/test/evaluator-identity.test.mjs), [Go vectors](../chaincode/insurance-contract/src/oracle_v2_vectors_test.go) | E3 is separately pinned. v1 and E2 are unchanged. |
| U39 | DONE | [Visibility table](visibility-table.md), [policy notes](oracle-v2/SPEC.md) | Public minimization was dropped under D8. |
| U40 | DONE | [Supervisor running order](supervisor-running-order.md), [preflight](../scripts/dev-lite-preflight.ps1) | Use current account readback for BDT balances. |
| U41 | PARTIAL | [R1 two-of-three and timeout trials](results/r1-journeys-2026-11-25.md), [memory plan](runbooks/defence-memory-plan.md) | Three-worker readiness exists. Full defence-profile memory target still unmeasured. |
| U42 | PARTIAL | [Defence walkthrough](defence-walkthrough.md), [seed validator](../scripts/validate-dev-lite-seed.mjs) | The January offline seed validator passed. Retained R1 Gateway validation stopped when the cached runtime exited with code 2. R2 corrected-appeal and screenshots remain pending. |
| U43 | PARTIAL | [Production launch](../scripts/dev-lite-app.ps1), [R1 and old browser evidence](defence-walkthrough.md) | Stopped-stack build evidence is separate from a live production R2 rehearsal. |
| U44 | DONE | [Worker cursor](../services/oracle-worker/src/ordered-events.mjs), [restart state](../services/oracle-worker/src/decision-store.mjs) | Bounded local persistence and node restarts are tested. |
| U45 | DONE | [Dev-lite profile](../scripts/profiles/dev-lite-190.json), [preflight](../scripts/dev-lite-preflight.ps1) | Profile tracks committed sequence separately from installed candidate artifacts. |
| U46 | DEFERRED-BY-PLAN | [Memory scope](runbooks/defence-memory-plan.md) and [Gateway](../apps/web/lib/fabric/gateway.ts) | Existing pooled connections and preflight kept. Optional per-actor index change dropped. |
| U47 | DONE | [Source recovery runbook](runbooks/medical-source-recovery.md) | Withheld original credentials must remain available for live restoration. |
| U48 | DONE | [R1 provisioning marker](results/r1-journeys-2026-11-25.md), [marker reader](../scripts/read-dev-lite-ledger-instance.mjs) | Ledger-bound state retains block-1 namespace. |
| U49 | DONE | [Projection and delivery](../apps/web/lib/events/projection.ts), [Phase 2A progress](../.project-context/implementation/PROGRESS.md) | Demonstration notification delivery and deduplication. |
| U50 | PARTIAL | [Scoped Chromium spec](../apps/web/e2e), [Phase 2A results](../.project-context/implementation/reports/phase-2a-report.md) | Seven retained-UI checks passed in 2A. R2 live browser acceptance and screenshots pending. |
| U51 | PARTIAL | [Defence checklist](defence-checklist.md), [memory plan](runbooks/defence-memory-plan.md), [ccaas compose](../network/compose/compose-dev-lite.yaml) | Shared runtime and one-host limits documented. Full defence profile pending; K16 remains scoped to this channel and K19 was dropped. |
| U52 | DONE | [Medical timeline](../apps/web/lib/fabric/medical-timeline.ts), [TypeScript model](../apps/web/lib/fabric/types.ts) | MODEL_HELD replacement still needs the separate live drill. |
| A1 | PARTIAL | [Oracle v2 specification](oracle-v2/SPEC.md), [R1 live](results/r1-journeys-2026-11-25.md), [Phase 3 harness](results/oracle-v2-phase3-2026-11-25.md) | Live R2 measurement pending. |
| A2 | DONE | [Challenger table](paper/ml-evidence.md), [replay](results/challenger-replay-2026-11-25.md) | Shadow only. Promotion HOLD. |
| A3 | DONE | [Pinned roster and exact decision](oracle-v2/R1-DESIGN.md), [R1 live record](results/r1-journeys-2026-11-25.md) | Three subjects and two exact results. |
| A4 | PARTIAL | [Sealed votes](../chaincode/insurance-contract/src/medical_sealed_votes.go), [TLC configuration](../formal/medical-certificate/MedicalCertificateSealed.cfg) | Live sealing, replacement and standby under current roster pending. |
| A5 | PARTIAL | [Sampling tests](../chaincode/insurance-contract/src/medical_r2_test.go), [verifier mutations](../tools/verify-dossier/test_approval_v3.py) | Live three-party default fixture pending. |
| A6 | DEFERRED-BY-PLAN | [Defence limitations](defence-checklist.md) | D9 drops the SBE pilot and adoption. |
| A7 | DONE | [Medical certificate models](../formal/medical-certificate/MedicalCertificate.tla), [R2 formal report](results/r2-formal-2026-11-25.md) | Abstract model and bounded state space. |
| A8 | PARTIAL | [Release model](../formal/medical-certificate/MedicalModelRelease.cfg), [live drill status](results/r2-journeys-2026-11-25.md) | Non-ROUTING ADVISORY live drill pending. |
| A9 | PARTIAL | [E3 implementation](../services/oracle-worker/src/e3-worker.mjs), [revision proof mutations](../tools/verify-dossier/test_approval_v3.py) | Live E3 promotion, request and nonce proof pending. |
| A10 | DONE | [Custody design](custody.md) | WebAuthn remains a design item and does not change Gateway signing. |

## Earlier partial work reconciled

- Phase 1's owner-gated read-only browser and TLC work was run in 2A. Its package gate was resolved by the verified 2B R1 deployment. Historical v1 dossiers and receipt checks stay valid. R2-specific acceptance is listed above.
- Phase 2A's offline E2 vectors, source restrictions and model governance were exercised on R1. The optional S-D live adapter remains outside the selected diagnostic release. Persistent notification dedup and the OOD wording were incorporated during 2A.
- Phase 2B's R1 approval/timeout/rejection evidence remains valid, with the latest rows tracked in the R2 journey register. Phase 3 verified the post-R1 backup and completed Rakibul's premium. The remainder of the R2-dependent checks retain their recorded status.
