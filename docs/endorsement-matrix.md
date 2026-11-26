# Fabric transaction endorsement matrix

Source review dated 25 November 2026. The matrix includes legacy paths and records the original sequence-1 deployment. The retained LevelDB ledger now runs R2 1.9.0, committed sequence 4 (26 November 2026), with the same endorsement policy and collection configuration as sequence 3. The signatures listed here come from deployment source. Use the dated R2 readback and journey record for current package identity and live collection evidence. [R2 readback](results/r2-journeys-2026-11-26.md#pre-freeze-readback)

Each row uses chaincode endorsement **C**, `OutOf(2, InsurerMSP.peer, HospitalMSP.peer, AuditorMSP.peer, BankMSP.peer, OracleMSP.peer)`. The collection column records conditional private-state accesses. Collection writes use the applicable collection endorsement policy. Private reads need an eligible peer with the data needed for simulation. The public portions of a transaction still use **C**. The collection endorsement policies each provide two qualifying organizations, so the same two signatures can satisfy **C** on paths writing to one collection. [Dev-lite definition](../network/scripts/dev-lite.sh#L121) · [Legacy definition](../network/scripts/deploy-chaincode.sh#L21)

| Collection notation | Member MSPs | Endorsement for private writes | Dissemination |
| --- | --- | --- | --- |
| **B**, `bankInsurerPrivateData` | Bank and Insurer | `AND(BankMSP.peer, InsurerMSP.peer)` | `requiredPeerCount: 1`, `maxPeerCount: 2` |
| **O**, `oracleProofPrivateData` | Hospital, Insurer and Oracle | `OutOf(2, HospitalMSP.peer, InsurerMSP.peer, OracleMSP.peer)` | `requiredPeerCount: 2`, `maxPeerCount: 3` |

Both collections use member-only reads and writes with `blockToLive: 0`. A write to **O** requires peers to disseminate the private payload to two **other** eligible peers. The one-peer-per-MSP dev-lite topology therefore needs all three members available for that write even though two member organizations satisfy its signature policy. Oracle application consensus independently counts two exact matching results from three named worker subjects in the medical frozen-model path. The Auditor panel separately counts three approvals or two rejections from its four assigned subjects. [Collection configuration](../network/config/collections_config.json) · [Oracle assignment and reveal](../chaincode/insurance-contract/src/oracle.go) · [Medical panel](../chaincode/insurance-contract/src/medical_review.go)

Caller abbreviations give the MSP and required certificate role. **I** means InsurerMSP `insurerAdmin`, **P** InsurerMSP `policyholder`, **H** HospitalMSP `hospitalOfficer`, **A** AuditorMSP `auditor`, **Bkr** BankMSP `bankOfficer` and **Opr** OracleMSP `oracle`. The caller is the signed transaction creator. Endorsing peers execute the same checks against that creator. The guard column highlights the identity or version/assignment constraint and selected branch conditions.

Keys use `type(id)` notation for Fabric composite key spaces. The public and private columns include conditional writes. **Routing defaults** refers to lazy initialization of `medicalModelRelease(genesis ID)` and `activeMedicalModelRelease(ROUTING)` when the active routing pointer is missing. **Duplicate buckets** are the collection's raw `medical-duplicate-v1-<HMAC>` and `medical-duplicate-v2-<HMAC>` indices. **Certificate** refers to `medicalApprovalCertificate(revision key)` or the separately keyed `medicalHeldReplacementCertificate(revision key)` on a held-release replacement. [State helpers](../chaincode/insurance-contract/src/helpers.go#L76) · [Routing initialization](../chaincode/insurance-contract/src/medical_model_release.go#L165) · [Duplicate indexes](../chaincode/insurance-contract/src/medical_duplicates.go) · [Certificate keys](../chaincode/insurance-contract/src/medical_approval.go#L164)

## Policies, premiums and benefit plans

| Transaction | Caller and guard | Public keys written under C | Collection reads and writes |
| --- | --- | --- | --- |
| `CreatePartnerAgreement` | I. Valid partner type, dates and terms hash. | `partnerAgreement(id)` | — |
| `SetPartnerAgreementStatus` | I. Valid transition from current agreement status. | `partnerAgreement(id)` | — |
| `ConfigurePolicyPackagePartners` | I. Draft package with active partner IDs. | `policyPackage(id)` | — |
| `CreatePolicyPackage` | I. Valid premium, limit and terms hash. | `policyPackage(id)` | — |
| `PublishPolicyPackage` | I. Draft package. | `policyPackage(id)` | — |
| `RetirePolicyPackage` | I. Published package. | `policyPackage(id)` | — |
| `IssuePolicy` | I. Eligible published package and valid policy term. | `policy(id)` | — |
| `AcquirePolicy` | P. Bound to caller subject and published non-medical package. | `policy(id)` | — |
| `AcquireMedicalPolicy` | P. Caller subject accepts current medical terms for published package. | `policy(id)` | — |
| `AdvancePolicyLifecycle` | I. Checks ledger calendar date and policy eligibility. | `policy(id)`, `premiumCollection(id)` upon expiry | — |
| `CancelPolicy` | I or owning P. Uncancelled, unexpired status and reason hash. | `policy(id)`, open `premiumCollection(id)` and eligible `bankMandate(id)` | — |
| `RenewPolicy` | Owning P. Eligible source policy, valid dates and available package. | `policy(new ID)` | — |
| `ConfigureMedicalRules` | I. Medical channel, draft package and first medical rules version. | `medicalRules(package ID)`, `policyPackage(package ID)` | — |
| `ReinstatePolicy` | I. Lapsed medical cover, within contract end date. | `policy(id)`, stale `premiumCollection(id)`, eligible `bankMandate(id)` | — |
| `RequestBankMandate` | Owning P. Eligible policy, own verified account, active partner and no duplicate live mandate. | `bankMandate(id)` | B reads `bankAccountPrivate(account ID)`. |
| `ReviewBankMandate` | Bkr. Pending mandate and valid decision. | `bankMandate(id)` | — |
| `CancelBankMandate` | Owning P. Cancellable mandate. | `bankMandate(id)` | — |
| `ExpireBankMandate` | Bkr. Eligible due or expired mandate. | `bankMandate(id)` | — |
| `QueuePremiumCollection` | I. Active due mandate, eligible policy and canonical due date. | `premiumCollection(id)` | — |
| `SchedulePremiumCollections` | I. Ledger-date and due-installment guards. | Due `premiumCollection(id)` records | — |
| `RetryPremiumCollection` | I. Bounced collection and eligible mandate/policy. | `premiumCollection(id)` | — |
| `CreateBenefitPlan` | I. Eligible package and valid payout limits. | `benefitPlan(id)` | — |
| `RetireBenefitPlan` | I. Published plan. | `benefitPlan(id)` | — |
| `PublishBenefitPlan` | I. Draft plan and package eligibility checks. | `benefitPlan(id)` | — |
| `SetBeneficiaries` | Owning P. Valid allocation set for the policy. | `beneficiaryDesignation(policy ID)` | — |
| `SubmitBenefitRequest` | P. Policyholder or eligible designated beneficiary, according to benefit type. | `benefitRequest(id)` | — |
| `DecideBenefitRequest` | I. Submitted request and valid decision. | `benefitRequest(id)`, `liability(liability-benefit-ID)` on approval | — |
| `MarkBenefitPaymentReady` | I. Approved request, linked liability and funding reference. | `benefitRequest(id)`, `liability(liability-benefit-ID)` | — |
| `ConfirmBenefitPayment` | Bkr. Payment-ready request, insurer funding account and sufficient simulated funds. | `bankAccountReference(funding account ID)`, `benefitRequest(id)`, `liability(liability-benefit-ID)`; death/surrender may update `policy(id)`, `bankMandate(id)` and `premiumCollection(id)` | B reads and writes the funding `bankAccountPrivate(account ID)`. |

Sources [partners](../chaincode/insurance-contract/src/partners.go) · [policies](../chaincode/insurance-contract/src/policies.go) · [policy lifecycle](../chaincode/insurance-contract/src/policy_lifecycle.go) · [cover rules](../chaincode/insurance-contract/src/cover_rules.go) · [banking](../chaincode/insurance-contract/src/banking.go) · [benefits](../chaincode/insurance-contract/src/benefits.go) · [medical terms](../chaincode/insurance-contract/src/medical_product.go)

## Bank accounts, transfers and settlement

| Transaction | Caller and guard | Public keys written under C | Collection reads and writes |
| --- | --- | --- | --- |
| `RequestBankAccountLink` | P. Owner comes from caller subject and Bank partner must be active. | `bankAccountLink(id)` | — |
| `ReviewBankAccountLink` | Bkr. Pending link and valid decision. Approval needs accepted transient account input. | `bankAccountLink(id)`, approved `bankAccountReference(account ID)` | B writes `bankAccountPrivate(account ID)` on approval. |
| `CancelBankAccountLink` | Owning P. Pending link. | `bankAccountLink(id)` | — |
| `OpenPrivateBankAccount` | Bkr. Active Bank partner and validated transient opening facts. | `bankAccountReference(account ID)` | B writes `bankAccountPrivate(account ID)`. |
| `MigrateBankAccountPrivateState` | Bkr. Legacy account with available balance/token state. | `bankAccountReference(account ID)` when migrating | B reads/writes `bankAccountPrivate(account ID)` on the migration or returned account path. |
| `AdjustBankAccountBalance` | Bkr. Valid amount and direction, sufficient balance on debit and unused transfer reference. | `bankAccountReference(account ID)`, `bankTransfer(id)`, `bankTransferExternalReference(hash)` | B reads and writes `bankAccountPrivate(account ID)`. |
| `ExecuteManualPremiumPayment` | Bkr. Eligible policy/amount/date, distinct correctly owned accounts and valid authorization and transfer references. | `bankTransfer(id)`, `bankTransferExternalReference(hash)`, `bankAccountReference(account ID)`, `premiumPayment(id)`, `premiumPaymentExternalReference(hash)`, `policy(id)`, affected `bankMandate(id)` | B reads both accounts and writes their `bankAccountPrivate(account ID)` balances on settlement. |
| `ProcessPremiumCollection` | Bkr. Due/retryable collection, matching mandate/policy and valid accounts/funding. | `premiumCollection(id)`, `bankTransfer(id)`, `bankTransferExternalReference(hash)`, `premiumPayment(id)`, `premiumPaymentExternalReference(hash)`, `bankAccountReference(account ID)`, `policy(id)` and `bankMandate(id)` as applicable | B reads both bank accounts and writes balances when paid. |
| `RecordPremiumAdjustment` | Bkr. Existing payment, cumulative reversal limit and unique external reference. | `premiumAdjustment(id)`, `premiumPaymentExternalReference(hash)`; transfer-backed reversals also write `bankTransfer(id)`, `bankAccountReference(account ID)` | B reads and writes both balances for a transfer-backed reversal. |
| `AuthorizeSettlement` | I. Approved claim; dev-lite medical requires current certificate/evidence binding, paid cover and an eligible model release. | `settlement(id)`, `liability(liability-claim-ID)`, `claim(id)`; routing defaults on legacy release lookup | B reads the selected source and destination `bankAccountPrivate(account ID)`. |
| `ConfirmSettlement` | Bkr. Authorized/payment-failed settlement, correctly linked claim/accounts and certificate checks on dev-lite medical. | `bankTransfer(id)`, `bankTransferExternalReference(hash)`, `bankAccountReference(account ID)` on payment, `claim(id)`, `settlement(id)`, `liability(liability-claim-ID)` | B reads both account balances and writes them when paid. |

The current Bank mutation guard verifies BankMSP and the `bankOfficer` attribute. Account/partner coverage checks apply per operation. Certificate-subject binding to the account's `BankID` is the later U34 change. Sources [bank links](../chaincode/insurance-contract/src/bank_links.go) · [private account writes](../chaincode/insurance-contract/src/bank_private.go) · [transfers](../chaincode/insurance-contract/src/bank_transfers.go) · [premium reversals](../chaincode/insurance-contract/src/banking.go#L220) · [settlement](../chaincode/insurance-contract/src/decisions.go)

## Legacy claims, hospital invoices and evidence

| Transaction | Caller and guard | Public keys written under C | Collection reads and writes |
| --- | --- | --- | --- |
| `SubmitClaim` | Owning P. Legacy channel, active/grace/expired policy, date within coverage and amount within the limit. | `claim(id)` | — |
| `SubmitInvoiceClaim` | Owning P. Submitted invoice binds the policyholder and covered Hospital. | `claim(id)` | — |
| `AddEvidenceReference` | Owning P. Current claim is eligible for attachment. | `claim(id)`, `evidenceReference(id)` | — |
| `AddEvidenceReferenceForVersion` | Owning P. Same attachment checks and caller-supplied version must match. | `claim(id)`, `evidenceReference(id)` | — |
| `VerifyClaim` | H. Hospital subject on a submitted legacy claim and valid cross-check outcome. | `hospitalVerification(id)`, `claim(id)`, optional `claimAppeal(id)` | — |
| `CreateHospitalInvoice` | H. Issuing Hospital subject, active partner and valid invoice reference/dates/status. | `hospitalInvoice(id)` | — |
| `CreateHospitalInvoiceWithCredential` | H. Same issuing subject and a finalized invoice for credential issuance. | `hospitalInvoice(id)`, `privacyCredential(id)` | O checks absence and writes `privacyCredentialPrivate(id)`. |
| `UpdateHospitalInvoice` | H. Assigned Hospital subject and valid original/current invoice transition. | `hospitalInvoice(id)` | — |
| `UpdateHospitalInvoiceWithCredential` | H. Same update checks plus new finalized credential where eligible. | `hospitalInvoice(id)`, `privacyCredential(id)` | O checks absence and writes `privacyCredentialPrivate(id)`. |
| `CrossCheckClaimInvoice` | I. Claim/version bound to current Hospital invoice facts. | `hospitalVerification(id)`, `claim(id)`, optional `claimAppeal(id)` | — |
| `RecordHospitalModelFacts` | H. Invoice belongs to caller's Hospital subject and transient facts match its supported version. | — | O checks absence and writes `hospitalModelFacts(invoice ID)`. |
| `GrantEvidenceAccess` | Owning P. Valid current evidence, grantee scope, purpose, expiry and access limit. Medical auditors need current assignments. | `evidenceGrant(id)` | — |
| `RevokeEvidenceAccess` | Grant-owning P. Revoked grants return idempotently. | `evidenceGrant(id)` | — |
| `RecordEvidenceAccess` | I, owning P, matching H on eligible legacy claim, or assigned A on current legacy review. Purpose is role-scoped. | `evidenceAccess(id)` | — |
| `RecordGrantedEvidenceAccess` | Enrolled grantee matching grant MSP, role, subject and purpose. Medical auditors need an assigned current review and grant; expiry and cap are checked. | `evidenceAccess(id)`, `evidenceGrant(id)` | — |
| `PublishEvidenceMerkleBatch` | I. Canonical committed evidence list reproduces supplied root. | `evidenceMerkleBatch(id)` | — |
| `OpenClaimReview` | I. Hospital-verified claim and valid initial panel/deadline. | `claimReview(id)`, `claim(id)` | — |
| `SubmitClaimAppeal` | Owning P. Eligible current rejection, admissible changes and appeal limit. | `claimAppeal(id)`, `claim(id)` | — |
| `RecordAuditorDecision` | Assigned A. One vote in an open non-medical round within deadline. | `auditorDecision(id)`, `reviewVote(review ID, auditor subject)`, `claimReview(id)`, `claim(id)`, optional `claimAppeal(id)` | — |
| `FinalizeExpiredReview` | I. Expired open/preparing round; medical branch checks current claim version. | `claimReview(id)`, `claim(id)`, optional legacy `claimAppeal(id)` | O reads and updates an outstanding `medicalClarification(id)` when medical preparation expires. |
| `RecordFraudAssessment` | I. Recognized advisory assessment and existing claim. | `fraudAssessment(id)` | — |
| `IssueInvoicePrivacyCredential` | H. Caller Hospital owns the finalized source invoice. | `privacyCredential(id)` | O checks absence and writes `privacyCredentialPrivate(id)`. |
| `IssuePolicyPrivacyCredential` | I. Eligible source policy and validated expiry/field input. | `privacyCredential(id)` | O checks absence and writes `privacyCredentialPrivate(id)`. |
| `RevokePrivacyCredential` | Credential issuer's MSP/role and exact recorded certificate identity. Active credential only. | `privacyCredential(id)` | — |
| `RegisterClaimPrivacyPresentation` | Owning P. Pinned current claim and trusted eligible invoice/policy credentials. | `selectiveDisclosurePresentation(id)`, `claim(id)` | O reads issuer `privacyCredentialPrivate(id)` records and writes `selectiveDisclosurePresentationPrivate(id)`. |

Sources [claims](../chaincode/insurance-contract/src/claims.go) · [hospital invoices](../chaincode/insurance-contract/src/hospital_records.go) · [hospital model facts](../chaincode/insurance-contract/src/hospital_model.go) · [evidence access](../chaincode/insurance-contract/src/evidence_access.go) · [evidence Merkle](../chaincode/insurance-contract/src/evidence_merkle.go) · [adjudication](../chaincode/insurance-contract/src/adjudication.go) · [privacy](../chaincode/insurance-contract/src/privacy.go)

## Medical intake, filing and review

| Transaction | Caller and guard | Public keys written under C | Collection reads and writes |
| --- | --- | --- | --- |
| `ActivateMedicalApprovalCertificates` | I. Dev-lite channel and one-time activation with a 32-byte transient duplicate index key. | `medicalApprovalActivation(medical-190)` | O writes `medicalDuplicateIndexSecret`. |
| `SaveMedicalEpisode` | H. Episode ID derives from Hospital subject; expected revision matches head. | `medicalEpisode(episode ID)` | O checks absence and writes `medicalEpisodeRevision(revision key)`. |
| `VerifyMedicalAssociation` | I. Current episode revision and valid beneficiary/basis; changing a confirmed beneficiary requires revocation. | `medicalAssociationVersion(association key)` | O reads episode revision and existing `medicalAssociation(key)`; writes that association and `medicalAssociationAudit(version key)`. |
| `PrepareMedicalClaim` | Owning P. Current associated episode, eligible paid policy and filing window. | — | O reads episode revision and association; checks absence and writes `medicalPreparation(claim ID)`. |
| `SubmitMedicalClaim` | Owning P. Exact preparation receipt, accepted statement and positive payable amount. | `medicalPayableEpisode(episode ID)`, `claim(id)`, `medicalCoverage(policy ID)`, optional `medicalTermsCommitment(revision key)` | O reads episode, association, preparation and dev-lite duplicate secret/buckets; writes `medicalStatement(revision key)` and conditional duplicate buckets. |
| `AcceptMedicalCorrection` | Owning P. Unpaid eligible claim, newer revision or updated verified association, and accepted quote. | `claim(id)`, `medicalCoverage(policy ID)`, optional `medicalTermsCommitment(revision key)`, superseded `claimReview(id)`, `settlement(id)` and `liability(liability-claim-ID)` as eligible | O reads corrected episode and association, any current clarification, and dev-lite duplicate secret/buckets; writes `medicalStatement(revision key)` and conditional duplicate buckets. |
| `SetDevLiteDuplicateRule` | I. Dev-lite channel and known rule version. | `medicalDuplicateRule(active)` | — |
| `PrepareMedicalReview` | I. Current medical claim requires panel; Oracle outcome and held-release branches checked. | `claimReview(id)`, `claim(id)`, `oracleRequest(id)` when finalizing a held request, routing defaults | — |
| `EscalateStalledMedicalClaim` | Owning P. Current eligible claim, no existing review/escalation, elapsed 24-hour or pinned Oracle reveal deadline. | `claimReview(revision key)`, `claim(id)`, optional timed-out `oracleRequest(id)` | — |
| `RequestMedicalClarification` | I. Preparing current review, valid deadline and transient question envelope. | `claim(id)` | O checks absence and writes `medicalClarification(id)`. |
| `RespondMedicalClarification` | Owning P before deadline, or I for expiry. Pending current review clarification; material answer creates a successor claim version. | `claim(id)`; material response can write `claimReview(id)`, `claimAppeal(id)`, `medicalTermsCommitment(revision key)` | O reads and updates `medicalClarification(id)`; material response reads previous and writes successor `medicalStatement(revision key)`. |
| `ShareMedicalReviewEvidence` | Owning P. Current preparation within deadline; grants only current evidence to assigned auditors. | `evidenceGrant(review/evidence/auditor/expiry digest)` | — |
| `ConfirmMedicalEvidence` | Assigned A. Preparing review, current evidence grant and authenticated decryption/access receipt. | `medicalEvidenceCheck(review/evidence/auditor digest)` | — |
| `OpenMedicalVoting` | I, or assigned A for claimant-escalated dev-lite review. Current preparation and all required document checks/grants. | `claimReview(id)`, `claim(id)`, optional `claimAppeal(id)` | O reads linked `medicalClarification(id)` if present. |
| `RecordMedicalAuditorDecision` | Assigned A. Open current version, valid reason code and hash, before deadline, one vote per subject. | `auditorDecision(id)`, `reviewVote(review ID, auditor subject)`, `claimReview(id)`, `claim(id)`, optional `claimAppeal(id)`; certificate on eligible approval | — |
| `RecoverMedicalReview` | I. Current procedural rejection, unused recovery and open rejection window. | `claimReview(new ID)`, `claim(id)` | — |
| `SubmitMedicalAppeal` | Owning P. Current reasoned rejection, unexpired/unused appeal, new evidence or current accepted corrected quote. | `claimAppeal(id)`, `claim(id)`, optional `medicalTermsCommitment(revision key)`, corrected `medicalCoverage(policy ID)` | O writes `medicalAppealExplanation(appeal ID)` and successor `medicalStatement(revision key)`. Reads the prior statement for a same-episode appeal. Corrected appeal reads episode/association and dev-lite duplicate state, with conditional bucket writes. |
| `ReleaseMedicalReservation` | I or owning P. Current final medical rejection, after appeal/recovery use or closure; one release only. | `medicalCoverage(policy ID)`, `claim(id)` | — |
| `PurgeMedicalAppealNote` | I. Confirmed certificate-bound settlement, retention elapsed and exact current private-state hash. | `medicalNoteDisposal(appeal ID)` | O reads only the private-state hash and purges `medicalAppealExplanation(appeal ID)`. |
| `RecordMedicalOCR` | Owning P who submitted evidence, or assigned A with current access receipt and active grant. Source hash matches medical evidence. | `medicalOCR(id)` | — |

Sources [medical approval](../chaincode/insurance-contract/src/medical_approval.go) · [episode](../chaincode/insurance-contract/src/medical_episode.go) · [association](../chaincode/insurance-contract/src/medical_association.go) · [claim](../chaincode/insurance-contract/src/medical_claim.go) · [clarification](../chaincode/insurance-contract/src/medical_clarification.go) · [review](../chaincode/insurance-contract/src/medical_review.go) · [review evidence](../chaincode/insurance-contract/src/medical_review_evidence.go) · [appeal](../chaincode/insurance-contract/src/medical_appeal.go) · [retention](../chaincode/insurance-contract/src/medical_retention.go) · [reservation](../chaincode/insurance-contract/src/medical_reservation.go) · [escalation](../chaincode/insurance-contract/src/medical_escalation.go) · [OCR](../chaincode/insurance-contract/src/medical_ocr.go)

## Oracle registry, release governance, consensus and audit sampling

| Transaction | Caller and guard | Public keys written under C | Collection reads and writes |
| --- | --- | --- | --- |
| `PublishOracleRegistrySnapshot` | I. Legacy global snapshot with valid hashes/rules and monotonically increasing version. | `oracleRegistrySnapshot(id)` | — |
| `ProposeMedicalRegistrySnapshot` | I. Dev-lite channel, valid Hospital identifier and next scoped snapshot version. | `oracleRegistrySnapshot(id)` | — |
| `AttestMedicalRegistrySnapshot` | H. Hospital subject equals snapshot Hospital; expected root must equal proposal. Version must advance the pointer. | `oracleRegistrySnapshot(id)`, `medicalActiveRegistry(hospital ID)` | — |
| `RegisterMedicalOracleBenchmark` | I. Eligible Hospital/service and valid tariff, licence and source hash. Write-once key. | — | O checks absence and writes `medicalOracleBenchmark(hospital/service digest)`. |
| `RegisterMedicalModelRelease` | I. Dev-lite, valid artifact hash, version and schema identifiers, and routing or advisory task. | `medicalModelRelease(id)` | — |
| `ShadowMedicalModelRelease` | I. Candidate release and shadow evidence hash. | `medicalModelRelease(id)` | — |
| `ApproveMedicalModelRelease` | I, A or Opr. One approval per MSP in SHADOW; Oracle must attest the installed artifact hash; third approval promotes. | `medicalModelRelease(id)`, `activeMedicalModelRelease(ROUTING)` for promoted routing release and lazy defaults | — |
| `HoldMedicalModelRelease` | I, A or Opr. SHADOW or PROMOTED release and valid hold reason hash. | `medicalModelRelease(id)` | — |
| `RequestOracleVerification` | I. Current claim and appeal binding, valid deadlines/assignments, matching registry and usable model. | `oracleRequest(id)`, `claim(id)`, optional source-binding `hospitalVerification(id)` and `claimAppeal(id)`, routing defaults | O may read a private selective-disclosure presentation when the legacy request uses one. |
| `SubmitOracleCommitment` | Assigned Opr. Pending current request, commit deadline and unused subject key. | `oracleCommitment(request ID:subject)`, `oracleRequest(id)`, routing defaults | — |
| `RevealOracleResult` | Assigned Opr. Current version, usable release, valid reveal phase and canonical result matching the stored commitment. | `oracleResult(request ID:subject)`, `oracleRequest(id)`, optional final `claim(id)`, `claimAppeal(id)` and certificate, routing defaults | — |
| `FinalizeOracleTimeout` | I. Current pending request after its reveal deadline. | `oracleRequest(id)`, `claim(id)` | — |
| `RouteOracleFailureToReview` | I. Current finalized failed Oracle request and eligible legacy claim; valid panel and review deadlines. | `claimReview(id)`, `claim(id)`, optional `claimAppeal(id)` | — |
| `CommitMedicalAuditPeriod` | A. Dev-lite, future valid interval/rate, committed seed hash, prior period ended. | `medicalAuditPeriod(id)`, `medicalAuditActive(period)` | — |
| `RevealMedicalAuditSeed` | A. Period ended and seed reproduces commitment; reveal only once. | `medicalAuditPeriod(id)` | — |
| `ResolveMedicalAuditSelection` | Enrolled channel caller. Dev-lite claim must be audit-pending with current positive consensus and revealed seed. | `medicalAuditSelection(revision key)`, `claim(id)`, optional certificate and routing defaults | — |

Sources [Oracle protocol](../chaincode/insurance-contract/src/oracle.go) · [medical source benchmark](../chaincode/insurance-contract/src/medical_oracle.go) · [registry attestation](../chaincode/insurance-contract/src/medical_registry.go) · [release governance](../chaincode/insurance-contract/src/medical_model_release.go) · [audit sampling](../chaincode/insurance-contract/src/medical_audit_sampling.go)

## Permissionless resolution and legacy refusals

`ResolveMedicalAuditSelection` deliberately has no role gate after Fabric authenticates the enrolled channel caller. The caller supplies the claim ID. Chaincode reads the pinned request and the revealed seed, derives the selection and advances only the current eligible version. Resolution exits the pending state and writes a version-specific record, which prevents repeated resolution. `FinalizeOracleTimeout` and `FinalizeExpiredReview` currently require I. Web views scope who can inspect or act on individual work. Public `List*` scoping remains a U30 follow-up. [Sampling resolver](../chaincode/insurance-contract/src/medical_audit_sampling.go#L152) · [Oracle timeout](../chaincode/insurance-contract/src/oracle.go#L793) · [Review expiry](../chaincode/insurance-contract/src/adjudication.go#L504) · [List queries](../chaincode/insurance-contract/src/queries.go)

The enabled mutation list above excludes these exported calls whose bodies always refuse after the role guard.

| Transaction | Role | Current refusal |
| --- | --- | --- |
| `OpenAppealReview` | I | The appeal must complete fresh Hospital and Oracle checks first. |
| `RegisterBankAccountReference` | Bkr | Open accounts through the transient private-input method. |
| `OpenBankAccount` | Bkr | Use `OpenPrivateBankAccount` for opening balance and token data. |
| `RecordPremiumPayment` | Bkr | Use manual premium execution or automatic collection. |
| `CompletePremiumCollection` | Bkr | Use `ProcessPremiumCollection`. |
| `FailPremiumCollection` | Bkr | Collection execution derives failure from available balance. |

Sources [legacy review entry](../chaincode/insurance-contract/src/adjudication.go#L332) · [legacy account opening](../chaincode/insurance-contract/src/bank_transfers.go#L22) · [legacy premium methods](../chaincode/insurance-contract/src/banking.go)
