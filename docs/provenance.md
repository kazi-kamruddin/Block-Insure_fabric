# Fabric deployment provenance

Each row identifies a separate ledger or a later definition on the same ledger. A source commit is the commit that contains the cited evidence or package inputs where the evidence records it. Older rows with unrecorded identifiers remain historical.

| Lineage and channel | Ledger provisioning identity | DB | Source / evidence commit | Chaincode and lifecycle sequence | Package SHA-256 | Web port | Dated evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preserved main `insurance-channel` | Unrecorded | CouchDB | Historical, source equivalent package unverified | 1.4.0, historical baseline | See package audit history | 3000 | [October preservation check](results/hardening-live-20261003.md) |
| September experiment `insurance-phase2-20260926` | Unrecorded | CouchDB | `de0c65a9a0aa0c3e1c14333513d3e0a62b64a124` plus recorded local changes | 1.4.0-phase2, 1 | [Manifest](results/phase2-manifest.json) | Isolated experiment | [Study evidence](results/phase2-evidence-index.md) |
| October `insurance-workflow-20261005` | Unrecorded | CouchDB | Historical | 1.5.1-workflow, isolated | [Runbook](local-demonstration.md) | Historical profile | [Rehearsal details](local-demonstration.md) |
| November `insurance-workflow-alignment-20261108` | Unrecorded | CouchDB | Archived candidate checkout | 1.6.3-xgb-alignment, 4 | `bc2a30f5b434c73649f765a31232892941ced4f617c7f5518cf399af8457c44a` | 3200 | [2026-11-10](results/candidate-rehearsal-2026-11-10.md) |
| Isolated `insurance-medical-reimbursement` | Unrecorded | CouchDB | Archived medical checkout | 1.8.0-medical, 2 | `79132734225c138f30a3a16909981c893ba8935271568bdbee8220f1758de396` | Historical profile | [2026-11-19](results/medical-final-acceptance-2026-11-19.md) |
| Earlier 1.9.0 LevelDB rehearsal `insurance-dev-lite-190` | Superseded ledger, archived 24 November | LevelDB | Historical | 1.9.0, 7 | `d6da2d7759681c5c50c895187844f3d6bd0e1b8a3caa31949c58e89000843ec9` | 3219 | [2026-11-21–23](dev-lite-medical.md) |
| 24 November seed `insurance-dev-lite-190` | Block-1 marker `85f5bae841c2c1826db6f898f27954d26ff85c0f43e15f84b0e92e110a7bd71b` | LevelDB | R1 baseline | 1.9.0, 1 | `d6da2d7759681c5c50c895187844f3d6bd0e1b8a3caa31949c58e89000843ec9` | 3219 | [Seed and R1 read-back](results/r1-journeys-2026-11-25.md) |
| R1 `insurance-dev-lite-190` | Same 24 November LevelDB ledger | LevelDB | `eaa3cff` / live evidence `28dc7a0` | 1.9.0, 2 | `50d2dfd84ee5083e589d165c1e5c2d40853a3da433f8b1dd9f9f8d514e5262a2` | 3219 | [2026-11-25](results/r1-journeys-2026-11-25.md) |
| R2 candidate `insurance-dev-lite-190` | Same 24 November LevelDB ledger | LevelDB | Phase 3 working tree | 1.9.0, installed and approved for 3 on all peers | `cd97ee4e93a191227b52146a9fa33e952cf4e33d50298eb2b8dcede7b0a41100` | 3219 | [2026-11-25](results/r2-journeys-2026-11-25.md) |

The runtime package SHA binds the R2 binary SHA through metadata. Installation and approval are separate from commitment. The active sequence and package in the [dev-lite profile](../scripts/profiles/dev-lite-190.json) are updated only after the corresponding peer read-back.
