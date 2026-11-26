# Phase 3 coverage audit

Session A update, 26 November 2026, Asia/Dhaka. A DONE row has evidence for the stated scope. Live R2 results are tracked in the [journey record](results/r2-journeys-2026-11-26.md). The Phase 3 baseline was 31 DONE, 25 PARTIAL, four DEFERRED-BY-PLAN, one BLOCKED-TECH and one owner drill.

Session A closed with 52 DONE, five PARTIAL, four DEFERRED-BY-PLAN and one owner drill. The 26 November pre-freeze audit downgraded U13 and U17. Current counts are **U1–U52: 41 DONE, seven PARTIAL, three DEFERRED-BY-PLAN and one owner drill**. Across all 62 items there are **50 DONE, seven PARTIAL, four DEFERRED-BY-PLAN and one owner drill**. The screenshot gate remains BLOCKED-TECH within the browser acceptance rows. [Read-only audit evidence](results/r2-journeys-2026-11-26.md#pre-freeze-readback)

| ID | Status | Evidence | Remaining limitation |
| --- | --- | --- | --- |
| U1 | DONE | [R2 receipt and dossier verification](results/r2-journeys-2026-11-26.md) | Five local receipts independently rehashed. Four matched committed reveal hashes. The fifth receipt's E2 commitment remained unopened. |
| U2 | DONE | [Dossier verifier](../tools/verify-dossier/verify_dossier.py), [R2 independent readback](results/r2-journeys-2026-11-26.md) | Dossiers for 207 and 209 both reproduced the separate peer sections with `--require-readback`. |
| U3 | DONE | [Reason receipt implementation](../apps/web/components/review-reason-receipts.tsx), [verifier](../tools/verify-dossier/verify_dossier.py) | Gateway-custodied reason encryption. |
| U4 | DONE | [R1 source registrations](results/r1-journeys-2026-11-25.md) | HospitalMSP exports remain within the synthetic institutional scope. |
| U5 | DONE | [R2 journey 209](results/r2-journeys-2026-11-26.md), [v3 mutation tests](../tools/verify-dossier/test_approval_v3.py) | DEMO certificate v3 issued after the sealed panel and used for the replacement payout. Historical certificates also settled. |
| U6 | PARTIAL | [Role review UI](../apps/web/components/medical-review.tsx), [defence walkthrough](defence-walkthrough.md) | Live ledger panel paths verified. Chromium stopped at 790 MB against the 900 MB floor before workspace capture. |
| U7 | DONE | [Frozen alignment](frozen-xgboost-alignment.md), [adapter sensitivity](results/adapter-sensitivity-2026-11-25.md) | Synthetic distributions and calibrated label limits remain. |
| U8 | DONE | [Thesis contribution](paper/contribution.md) | Scope is provenance-aware routing on synthetic facts. |
| U9 | DONE | [Phase 3 model evidence](results/r2-formal-2026-11-25.md) | Finite model. The JS default report path has a pre-existing sandbox write failure. |
| U10 | DONE | [Oracle experiment](results/oracle-v2-phase3-2026-11-25.md) | Multi-source agreement assumes its supplied authority and independence facts. |
| U11 | DONE | [R2 transaction and DEMO journey latency](results/r2-latency-2026-11-26.md) | One 8 GB host. K.4 replaces the throughput trials with journey latency and commit outcomes. |
| U12 | DONE | [ML evidence tables](paper/ml-evidence.md), [challenger replay](results/challenger-replay-2026-11-25.md) | Synthetic labels and workload. |
| U13 | PARTIAL | [Auditor disclosure test](../chaincode/insurance-contract/src/medical_r2_test.go), [R2 journey 209](results/r2-journeys-2026-11-26.md) | The assigned Auditor peer reproduced exact disclosure live. Altered transient bytes were refused in Go. No live refusal of altered bytes is recorded. |
| U14 | DONE | [Auditor roster](../chaincode/insurance-contract/src/medical_auditor_roster.go), [R2 journeys 209 and 207](results/r2-journeys-2026-11-26.md) | Six-person roster activated. Claim 209 replaced one unacknowledged seat, and claim 207 drew two reviewers from its prior panel and two alternates. |
| U15 | DONE | [Provenance](provenance.md) and [archive index](archive/README.md) | Some historical provisioning IDs were unrecorded. |
| U16 | DONE | [Oracle v2 vectors](../chaincode/insurance-contract/src/oracle_v2_vectors_test.go), [live R1 quorum](results/r1-journeys-2026-11-25.md) | Identical copied commitments cannot be counted as distinct responses. |
| U17 | PARTIAL | [Ledger clock](../chaincode/insurance-contract/src/ledger_time.go), [v2 phase checks](../chaincode/insurance-contract/src/oracle_v2.go), [R2 timing design](oracle-v2/R2-DESIGN.md) | The 15 s endorsement tolerance remains intact. It equals the whole DEMO commit window. A strict peer-observed phase boundary is unverified and needs a sequence-4 design and tests. |
| U18 | PARTIAL | [Escalation chaincode](../chaincode/insurance-contract/src/medical_escalation.go), [R2 evidence](results/r2-journeys-2026-11-26.md) | Live two-minute DEMO claimant escalation worked for the overlap case. Historical 206 retains 26 Nov 15:57 Dhaka eligibility. The defaulted audit fixture used ordinary selection after grace. |
| U19 | DONE | [Vote visibility](vote-visibility.md), [R2 journey 209](results/r2-journeys-2026-11-26.md) | Four commitments preceded three approval reveals and v3 issuance. Old rounds retain their original visibility. |
| U20 | DONE | [R2 journey 209](results/r2-journeys-2026-11-26.md) | The Bank refused confirmation while E2 was held. A fresh panel certificate and authorization settled under a replacement ID. |
| U21 | DONE | [R1 live release governance](results/r1-journeys-2026-11-25.md), [R2 release journeys](results/r2-journeys-2026-11-26.md) | E2 resumed in block 281, the separate ADVISORY activated in 289 and E3 took routing in 387. |
| U22 | DONE | [R1 issuer, roster and live commits](results/r1-journeys-2026-11-25.md) | Same three assigned subjects and exact threshold. |
| U23 | DONE | [Hospital registration and R1 journeys](results/r1-journeys-2026-11-25.md), [source recovery](runbooks/medical-source-recovery.md) | Supports scoped current diagnostic sources. |
| U24 | DONE | [Scoped source reader](../chaincode/insurance-contract/src/medical_oracle_v2_sources.go), [worker tests](../services/oracle-worker/test/v2-protocol.test.mjs) | Window and maximum size remain bounded. |
| U25 | DONE | [R2 live transaction and journey measurements](results/r2-latency-2026-11-26.md), [R1 historical results](results/r1-journeys-2026-11-25.md) | One R2 pass, with small samples for some transaction types. |
| U26 | DONE | [R1 design](oracle-v2/R1-DESIGN.md), [governance tests](../chaincode/insurance-contract/src/oracle_r1_test.go) | Only registered diagnostic feeds are active on this ledger. |
| U27 | DONE | [Worker source paths](../services/oracle-worker/src/v2/worker.mjs), [R1 evidence](results/r1-journeys-2026-11-25.md) | Simulated institutions share the host. |
| U28 | DEFERRED-BY-PLAN | [Memory-first scope and limitations](defence-checklist.md) | SBE pilot dropped with A6 per D9. Existing endorsement policy remains. |
| U29 | NOT-RUN (owner drill) | [Custody and F06](custody.md) | No separate Windows operator result located. |
| U30 | DEFERRED-BY-PLAN | [Visibility inventory](visibility-table.md), [limitations](defence-checklist.md) | D8 drops new public data minimization. Existing blocks keep original fields. |
| U31 | DONE | [R2 nonce and E3 design](oracle-v2/R2-DESIGN.md), [independent live E3 dossier](results/r2-journeys-2026-11-26.md) | E3 epoch 1, exact quorum and nonce-bound referral at peer height 400. |
| U32 | DONE | [Three-share sampling](../chaincode/insurance-contract/src/medical_audit_sampling_v2.go), [live default](results/r2-journeys-2026-11-26.md) | Three commitments and two reveals defaulted one frozen AUTO candidate to panel review with recorded panel load 1. |
| U33 | DONE | [Overlap bucket and explanation](../chaincode/insurance-contract/src/medical_cross_hospital.go), [live overlap](results/r2-journeys-2026-11-26.md) | Hospital 3 versus Hospital 2 overlap committed and the assigned Auditor peer returned the exact private claimant rationale. |
| U34 | DONE | [Bank binding](../chaincode/insurance-contract/src/bank_subject.go), [R2 payouts](results/r2-journeys-2026-11-26.md) | Retained Bank identity confirmed historical and v3 payouts on R2. The earlier public signcert check found the scoped bank-demo enrollment mapping. |
| U35 | DONE | [Retirement and reservation test](../chaincode/insurance-contract/src/medical_r2_test.go), [live retirement](results/r2-journeys-2026-11-26.md) | An unpaid DEMO v3 approval became ineffective and its cover reservation was released after association invalidation. |
| U36 | DONE | [Web authorization and tests](../apps/web/lib/auth/accounts.ts), [custody limits](custody.md) | Demonstration authentication. |
| U37 | DONE | [R1 receipt comparison](results/r1-journeys-2026-11-25.md), [browser OCR acceptance](results/medical-review-ocr-2026-11-19.md) | Claimant-supplied receipt/OCR is scoped evidence. |
| U38 | DONE | [Worker identity tests](../services/oracle-worker/test/evaluator-identity.test.mjs), [Go vectors](../chaincode/insurance-contract/src/oracle_v2_vectors_test.go) | E3 is separately pinned. v1 and E2 are unchanged. |
| U39 | DONE | [Visibility table](visibility-table.md), [policy notes](oracle-v2/SPEC.md) | Public minimization was dropped under D8. |
| U40 | DONE | [Supervisor running order](supervisor-running-order.md), [preflight](../scripts/dev-lite-preflight.ps1) | Use current account readback for BDT balances. |
| U41 | PARTIAL | [R1 two-of-three and timeout trials](results/r1-journeys-2026-11-25.md), [memory plan](runbooks/defence-memory-plan.md) | Full three-worker profile was healthy. The warmed memory sample was 967 MB, below the 1,000 MB operating target. |
| U42 | PARTIAL | [Defence walkthrough](defence-walkthrough.md), [live corrected appeal](results/r2-journeys-2026-11-26.md) | R2 corrected appeal and payout passed. Claim 206 retained its REAL deadline. Chromium was blocked at 790 MB. |
| U43 | DONE | [Production launcher](../scripts/r2-demo.ps1), [full profile](runbooks/defence-memory-plan.md) | Production launcher reported HEALTHY on the verified R2 package and ran the corrected-appeal processing stack. |
| U44 | DONE | [Worker cursor](../services/oracle-worker/src/ordered-events.mjs), [restart state](../services/oracle-worker/src/decision-store.mjs) | Bounded local persistence and node restarts are tested. |
| U45 | DONE | [Dev-lite profile](../scripts/profiles/dev-lite-190.json), [preflight](../scripts/dev-lite-preflight.ps1) | Profile tracks committed sequence separately from installed candidate artifacts. |
| U46 | DEFERRED-BY-PLAN | [Memory scope](runbooks/defence-memory-plan.md), [Gateway](../apps/web/lib/fabric/gateway.ts), [MVCC attribution](results/r2-latency-2026-11-26.md#mvcc-attribution) | Pooled connections and preflight remain. The pass observed 20 code-11 conflicts across four requests. Per-actor counters remain deferred. |
| U47 | DONE | [Source recovery runbook](runbooks/medical-source-recovery.md) | Withheld original credentials must remain available for live restoration. |
| U48 | DONE | [R1 provisioning marker](results/r1-journeys-2026-11-25.md), [marker reader](../scripts/read-dev-lite-ledger-instance.mjs) | Ledger-bound state retains block-1 namespace. |
| U49 | DONE | [Projection and delivery](../apps/web/lib/events/projection.ts), [Phase 2A progress](../.project-context/implementation/PROGRESS.md) | Demonstration notification delivery and deduplication. |
| U50 | PARTIAL | [Defence walkthrough](defence-walkthrough.md), [Phase 2A results](../.project-context/implementation/reports/phase-2a-report.md) | Seven retained-UI checks passed in 2A. The single R2 pass stopped before Chromium launch at 790 MB against the 900 MB floor. |
| U51 | DONE | [Defence checklist](defence-checklist.md), [measured full profile](runbooks/defence-memory-plan.md), [ccaas compose](../network/compose/compose-dev-lite.yaml) | Full profile measured. The shared runtime and one-host limitations remain documented. K16 is scoped to this channel and K19 was dropped. |
| U52 | DONE | [API and badge regression](../apps/web/app/api/medical/review/route.test.ts), [TypeScript model](../apps/web/lib/fabric/types.ts), [R2 held-model journey](results/r2-journeys-2026-11-26.md) | The test renders `MODEL_HELD` as “Model on hold”. The 209 held-authorization replacement paid in block 274. |
| A1 | DONE | [Oracle v2 specification](oracle-v2/SPEC.md), [R2 journey results](results/r2-journeys-2026-11-26.md), [R2 latency](results/r2-latency-2026-11-26.md) | Signed sources, exact E2 and E3 quorum, and DEMO timing verified live. |
| A2 | DONE | [Challenger table](paper/ml-evidence.md), [replay](results/challenger-replay-2026-11-25.md) | Shadow only. Promotion HOLD. |
| A3 | DONE | [Pinned roster and exact decision](oracle-v2/R1-DESIGN.md), [R1 live record](results/r1-journeys-2026-11-25.md) | Three subjects and two exact results. |
| A4 | DONE | [R2 journey 209](results/r2-journeys-2026-11-26.md), [TLC configuration](../formal/medical-certificate/MedicalCertificateSealed.cfg) | The current roster supplied a replacement seat, then completed a sealed approval. |
| A5 | DONE | [Live default path](results/r2-journeys-2026-11-26.md), [verifier mutations](../tools/verify-dossier/test_approval_v3.py) | Audit default committed after the reveal grace, then the frozen claim selection routed to panel. |
| A6 | DEFERRED-BY-PLAN | [Defence limitations](defence-checklist.md) | D9 drops the SBE pilot and adoption. |
| A7 | DONE | [Medical certificate models](../formal/medical-certificate/MedicalCertificate.tla), [R2 formal report](results/r2-formal-2026-11-25.md) | Abstract model and bounded state space. |
| A8 | DONE | [Release model](../formal/medical-certificate/MedicalModelRelease.cfg), [R2 release drill](results/r2-journeys-2026-11-26.md) | The separate ADVISORY release activated and the routing pointer stayed on E2. |
| A9 | DONE | [E3 implementation](../services/oracle-worker/src/e3-worker.mjs), [live E3 proof](results/r2-journeys-2026-11-26.md), [referral and nonce mutations](../tools/verify-dossier/test_oracle_v2.py) | E3 promoted last. The first E3 request used epoch 1 and verified with separate peer readback. |
| A10 | DONE | [Custody design](custody.md) | WebAuthn remains a design item and does not change Gateway signing. |

## Earlier partial work reconciled

- Phase 1's owner-gated read-only browser and TLC work was run in 2A. Its package gate was resolved by the verified 2B R1 deployment. Historical v1 dossiers and receipt checks stay valid. R2-specific acceptance is listed above.
- Phase 2A's offline E2 vectors, source restrictions and model governance were exercised on R1. The optional S-D live adapter remains outside the selected diagnostic release. Persistent notification dedup and the OOD wording were incorporated during 2A.
- Phase 2B's R1 approval/timeout/rejection evidence remains valid, with the latest rows tracked in the R2 journey register. Phase 3 verified the post-R1 backup and completed Rakibul's premium. The remainder of the R2-dependent checks retain their recorded status.
