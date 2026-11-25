package insurance

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalDevLiteChannel = "insurance-dev-lite-190"
const medicalApprovalEpoch = "medical-190"
const duplicateIndexSecret = "medicalDuplicateIndexSecret"

type MedicalApprovalActivation struct {
	ID            string `json:"id"`
	ActivatedAt   string `json:"activatedAt"`
	TransactionID string `json:"transactionId"`
}

// The isolated 1.9.0 channel has no grandfathered approvals. The accepted
// channel keeps its own chaincode definition and historical settlement rules.
func (c *Contract) ActivateMedicalApprovalCertificates(ctx contractapi.TransactionContextInterface) (*MedicalApprovalActivation, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("activation requires the 1.9.0 medical development channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, err
	}
	key := transient["duplicateIndexKey"]
	if len(key) != 32 {
		return nil, fmt.Errorf("a 32-byte private duplicate index key is required")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	activation := &MedicalApprovalActivation{ID: medicalApprovalEpoch, ActivatedAt: now, TransactionID: ctx.GetStub().GetTxID()}
	if err := putState(ctx, "medicalApprovalActivation", medicalApprovalEpoch, activation); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutPrivateData(oracleProofCollection, duplicateIndexSecret, key); err != nil {
		return nil, err
	}
	return activation, emit(ctx, "MedicalApprovalCertificatesActivated", activation)
}

func usesMedicalApprovalCertificates(ctx contractapi.TransactionContextInterface) bool {
	return ctx.GetStub().GetChannelID() == medicalDevLiteChannel
}

type ApprovalCertificate struct {
	CertificateVersion      int    `json:"certificateVersion,omitempty" metadata:",optional"`
	ReviewTranscriptHash    string `json:"reviewTranscriptHash,omitempty" metadata:",optional"`
	SamplingRecordHash      string `json:"samplingRecordHash,omitempty" metadata:",optional"`
	DecidedAt               string `json:"decidedAt,omitempty" metadata:",optional"`
	IssuedAt                string `json:"issuedAt,omitempty" metadata:",optional"`
	ManifestHash            string `json:"manifestHash,omitempty" metadata:",optional"`
	FactVectorHash          string `json:"factVectorHash,omitempty" metadata:",optional"`
	Decision                string `json:"decision,omitempty" metadata:",optional"`
	PolicyVersion           string `json:"policyVersion,omitempty" metadata:",optional"`
	SupersededBy            string `json:"supersededBy,omitempty" metadata:",optional"`
	ID                      string `json:"id"`
	ActivationTransactionID string `json:"activationTransactionId"`
	ClaimID                 string `json:"claimId"`
	ClaimVersion            int    `json:"claimVersion"`
	EpisodeRevision         int    `json:"episodeRevision"`
	EpisodeRevisionHash     string `json:"episodeRevisionHash"`
	AssociationVersion      int    `json:"associationVersion"`
	StatementHash           string `json:"statementHash"`
	AmountMinor             int64  `json:"amountMinor"`
	Currency                string `json:"currency"`
	Path                    string `json:"path"`
	OracleRequestID         string `json:"oracleRequestId"`
	OracleResultHash        string `json:"oracleResultHash"`
	OracleOutcome           string `json:"oracleOutcome"`
	RegistrySnapshotID      string `json:"registrySnapshotId"`
	RegistryRootHash        string `json:"registryRootHash"`
	ModelHash               string `json:"modelHash"`
	ReviewID                string `json:"reviewId"`
	DecisionID              string `json:"decisionId"`
	EscalatedAt             string `json:"escalatedAt"`
	DuplicateReview         bool   `json:"duplicateReview"`
	DuplicateRuleVersion    int    `json:"duplicateRuleVersion,omitempty" metadata:",optional"`
	ApprovedAt              string `json:"approvedAt"`
	PackageID               string `json:"packageId,omitempty" metadata:",optional"`
	RulesVersion            int    `json:"rulesVersion,omitempty" metadata:",optional"`
	TermsHash               string `json:"termsHash,omitempty" metadata:",optional"`
	BreakdownHash           string `json:"breakdownHash,omitempty" metadata:",optional"`
	Hash                    string `json:"hash"`
}

func (c *Contract) deriveMedicalApproval(ctx contractapi.TransactionContextInterface, claim *Claim, request *OracleRequest, review *ClaimReview) (*ApprovalCertificate, error) {
	activation, err := getState[MedicalApprovalActivation](ctx, "medicalApprovalActivation", medicalApprovalEpoch)
	if err != nil {
		return nil, err
	}
	head, err := currentMedicalHead(ctx, claim)
	if err != nil {
		return nil, err
	}
	cert := &ApprovalCertificate{
		ID: medicalRevisionKey(claim.ID, claim.Version), ActivationTransactionID: activation.TransactionID,
		ClaimID: claim.ID, ClaimVersion: claim.Version, EpisodeRevision: claim.EpisodeRevision, EpisodeRevisionHash: head.RevisionHash,
		AssociationVersion: claim.MedicalAssociationVersion, StatementHash: claim.DescriptionHash, AmountMinor: claim.AmountMinor, Currency: "BDT",
		DuplicateReview: claim.MedicalDuplicateReview, DuplicateRuleVersion: claim.MedicalDuplicateRuleVersion, EscalatedAt: claim.MedicalEscalatedAt,
	}
	if review != nil {
		if review.ID != claim.CurrentReviewID || review.ClaimID != claim.ID || review.MedicalVersion != claim.Version ||
			review.Status != "APPROVED" || review.Approvals < review.ApprovalThreshold || review.ApprovalThreshold != 3 || claim.AuditorDecisionID == "" {
			return nil, fmt.Errorf("certificate requires a finalized current panel approval")
		}
		cert.Path, cert.ReviewID, cert.DecisionID, cert.ApprovedAt = "PANEL", review.ID, claim.AuditorDecisionID, review.ClosedAt
	} else {
		if claim.CurrentReviewID != "" || request == nil || request.Status != "CONSENSUS" || !request.VerifiedResult || requiresMedicalPanel(claim) {
			return nil, fmt.Errorf("certificate requires an eligible current Oracle approval")
		}
		cert.Path, cert.ApprovedAt = "ORACLE_AUTO", request.FinalizedAt
	}
	if request != nil {
		if request.ID != claim.CurrentOracleRequestID || request.ClaimID != claim.ID || request.ClaimVersion != claim.Version ||
			request.ResultHash != claim.OracleResultHash || request.FinalizationCode != claim.OracleOutcome ||
			(request.Status != "CONSENSUS" && request.Status != "FAILED") {
			return nil, fmt.Errorf("certificate Oracle result no longer matches the current claim")
		}
		cert.OracleRequestID, cert.OracleResultHash, cert.OracleOutcome = request.ID, request.ResultHash, request.FinalizationCode
		cert.RegistrySnapshotID, cert.RegistryRootHash, cert.ModelHash = request.RegistrySnapshotID, request.RegistryRootHash, request.ModelHash
		if claim.MedicalHeldReleaseID != "" {
			if review == nil || claim.MedicalHeldReleaseID != effectiveMedicalModelReleaseID(request) {
				return nil, fmt.Errorf("certificate requires a panel decision for the held release")
			}
			cert.OracleOutcome = "MODEL_HELD:" + claim.MedicalHeldReleaseID
		}
	} else if review != nil && claim.MedicalHeldReleaseID != "" {
		cert.OracleOutcome = "MODEL_HELD:" + claim.MedicalHeldReleaseID
	} else if review == nil || claim.MedicalEscalatedAt == "" {
		return nil, fmt.Errorf("certificate requires an Oracle result, held release, or recorded escalation")
	}
	values := []string{cert.ID, cert.ActivationTransactionID, cert.ClaimID, strconv.Itoa(cert.ClaimVersion),
		strconv.Itoa(cert.EpisodeRevision), cert.EpisodeRevisionHash, strconv.Itoa(cert.AssociationVersion), cert.StatementHash,
		strconv.FormatInt(cert.AmountMinor, 10), cert.Currency, cert.Path, cert.OracleRequestID, cert.OracleResultHash, cert.OracleOutcome,
		cert.RegistrySnapshotID, cert.RegistryRootHash, cert.ModelHash, cert.ReviewID, cert.DecisionID, cert.EscalatedAt,
		strconv.FormatBool(cert.DuplicateReview), cert.ApprovedAt}
	key, err := stateKey(ctx, "medicalTermsCommitment", cert.ID)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	domain := "fabric-medical-approval-v1"
	if raw != nil {
		var terms MedicalTermsCommitment
		if err := json.Unmarshal(raw, &terms); err != nil {
			return nil, fmt.Errorf("invalid medical terms commitment: %w", err)
		}
		cert.PackageID, cert.RulesVersion, cert.TermsHash, cert.BreakdownHash = terms.PackageID, terms.RulesVersion, terms.TermsHash, terms.BreakdownHash
		domain = "fabric-medical-approval-v2"
		values = append(values, cert.PackageID, strconv.Itoa(cert.RulesVersion), cert.TermsHash, cert.BreakdownHash)
	}
	if cert.DuplicateRuleVersion != 0 {
		domain += ":duplicate-rule"
		values = append(values, strconv.Itoa(cert.DuplicateRuleVersion))
	}
	if request != nil && request.ProtocolVersion == "v2" && cert.Path == "ORACLE_AUTO" {
		cert.ManifestHash, cert.FactVectorHash, cert.Decision, cert.PolicyVersion =
			request.ManifestHash, request.FactVectorHash, request.Decision, request.PolicyVersion
		if !oracleV2Hash.MatchString(cert.ManifestHash) || !oracleV2Hash.MatchString(cert.FactVectorHash) ||
			cert.FactVectorHash != cert.OracleResultHash || cert.Decision != "AUTO_APPROVE" || cert.PolicyVersion != oracleV2Policy {
			return nil, fmt.Errorf("certificate requires a valid Oracle v2 decision")
		}
		domain += ":oracle-v2"
		values = append(values, cert.ManifestHash, cert.FactVectorHash, cert.Decision, cert.PolicyVersion)
	}
	cert.Hash = canonicalProtocolHash(domain, values...)
	return cert, nil
}

func requiresMedicalPanel(claim *Claim) bool {
	return claim.CurrentAppealID != "" || claim.MedicalSupplementHash != "" || claim.MedicalRevisionKind == "CORRECTION" ||
		claim.MedicalDuplicateReview || claim.MedicalEscalatedAt != "" || claim.MedicalHeldReleaseID != ""
}

func (c *Contract) recordMedicalApproval(ctx contractapi.TransactionContextInterface, claim *Claim, request *OracleRequest, review *ClaimReview, pending ...*AuditorDecision) error {
	var vote *AuditorDecision
	if len(pending) > 0 {
		vote = pending[0]
	}
	return c.recordMedicalApprovalWithEvidence(ctx, claim, request, review, vote, nil)
}

func (c *Contract) recordMedicalApprovalWithEvidence(ctx contractapi.TransactionContextInterface, claim *Claim, request *OracleRequest, review *ClaimReview, vote *AuditorDecision, selection *MedicalAuditSelection) error {
	cert, err := c.deriveMedicalApproval(ctx, claim, request, review)
	if err != nil {
		return err
	}
	roster, err := c.activeAuditorRoster(ctx)
	if err != nil {
		return err
	}
	if roster != nil && (review == nil || review.BallotVersion == sealedPanelBallot) {
		issuedAt, err := ledgerTimestamp(ctx)
		if err != nil {
			return err
		}
		if err := c.deriveMedicalApprovalV3(ctx, cert, request, review, vote, selection, issuedAt); err != nil {
			return err
		}
	}
	if claim.MedicalHeldReleaseID != "" {
		key, err := stateKey(ctx, "medicalApprovalCertificate", cert.ID)
		if err != nil {
			return err
		}
		raw, err := ctx.GetStub().GetState(key)
		if err != nil {
			return err
		}
		if len(raw) != 0 {
			prior, err := getState[ApprovalCertificate](ctx, "medicalApprovalCertificate", cert.ID)
			if err != nil {
				return err
			}
			if err := putState(ctx, "medicalCertificateSupersession", prior.Hash, cert.Hash); err != nil {
				return err
			}
		}
		return putState(ctx, "medicalHeldReplacementCertificate", cert.ID, cert)
	}
	return putState(ctx, "medicalApprovalCertificate", cert.ID, cert)
}

func (c *Contract) medicalApprovalRequest(ctx contractapi.TransactionContextInterface, claim *Claim) (*OracleRequest, error) {
	if claim.CurrentOracleRequestID == "" {
		return nil, nil
	}
	return c.ReadOracleRequest(ctx, claim.CurrentOracleRequestID)
}

func (c *Contract) ReadMedicalApprovalCertificate(ctx contractapi.TransactionContextInterface, claimID string, version int) (*ApprovalCertificate, error) {
	id := medicalRevisionKey(claimID, version)
	key, err := stateKey(ctx, "medicalHeldReplacementCertificate", id)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if raw != nil {
		return medicalCertificateWithSupersession(ctx, "medicalHeldReplacementCertificate", id)
	}
	return medicalCertificateWithSupersession(ctx, "medicalApprovalCertificate", id)
}

func (c *Contract) ReadOriginalMedicalApprovalCertificate(ctx contractapi.TransactionContextInterface, claimID string, version int) (*ApprovalCertificate, error) {
	cert, err := medicalCertificateWithSupersession(ctx, "medicalApprovalCertificate", medicalRevisionKey(claimID, version))
	if err != nil {
		return nil, err
	}
	if cert.SupersededBy == "" {
		if replacement, err := getState[ApprovalCertificate](ctx, "medicalHeldReplacementCertificate", cert.ID); err == nil {
			cert.SupersededBy = replacement.Hash
		}
	}
	return cert, nil
}

func medicalCertificateWithSupersession(ctx contractapi.TransactionContextInterface, kind, id string) (*ApprovalCertificate, error) {
	cert, err := getState[ApprovalCertificate](ctx, kind, id)
	if err != nil {
		return nil, err
	}
	key, err := stateKey(ctx, "medicalCertificateSupersession", cert.Hash)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &cert.SupersededBy); err != nil {
			return nil, err
		}
	}
	return cert, nil
}

func (c *Contract) supersedeMedicalCertificateForCorrection(ctx contractapi.TransactionContextInterface, claim *Claim) error {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil
	}
	id := medicalRevisionKey(claim.ID, claim.Version)
	for _, kind := range []string{"medicalHeldReplacementCertificate", "medicalApprovalCertificate"} {
		key, err := stateKey(ctx, kind, id)
		if err != nil {
			return err
		}
		raw, err := ctx.GetStub().GetState(key)
		if err != nil {
			return err
		}
		if len(raw) == 0 {
			continue
		}
		cert, err := medicalCertificateWithSupersession(ctx, kind, id)
		if err != nil {
			return err
		}
		if cert.SupersededBy != "" {
			return nil
		}
		return putState(ctx, "medicalCertificateSupersession", cert.Hash, medicalRevisionKey(claim.ID, claim.Version+1))
	}
	return nil
}

func (c *Contract) verifyMedicalApproval(ctx contractapi.TransactionContextInterface, claim *Claim) (*ApprovalCertificate, error) {
	stored, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	if err != nil {
		return nil, fmt.Errorf("current medical approval certificate is required: %w", err)
	}
	if stored.SupersededBy != "" {
		return nil, fmt.Errorf("only an effective medical approval certificate can authorize settlement")
	}
	request, err := c.medicalApprovalRequest(ctx, claim)
	if err != nil {
		return nil, err
	}
	var review *ClaimReview
	if claim.CurrentReviewID != "" {
		review, err = c.ReadClaimReview(ctx, claim.CurrentReviewID)
		if err != nil {
			return nil, err
		}
		decision, err := getState[AuditorDecision](ctx, "auditorDecision", claim.AuditorDecisionID)
		if err != nil || decision.ClaimID != claim.ID || decision.ReviewID != review.ID ||
			decision.ReviewRound != review.Round || decision.Outcome != "APPROVE" || !containsAssignment(review.AssignedAuditorIDs, decision.AuditorID) {
			return nil, fmt.Errorf("certificate panel decision does not match the approved review")
		}
	}
	expected, err := c.deriveMedicalApproval(ctx, claim, request, review)
	if err != nil {
		return nil, err
	}
	if stored.CertificateVersion == 3 {
		if err := c.deriveMedicalApprovalV3(ctx, expected, request, review, nil, nil, stored.IssuedAt); err != nil {
			return nil, err
		}
	}
	if *expected != *stored {
		return nil, fmt.Errorf("approval certificate no longer matches current ledger state")
	}
	return stored, nil
}

func (c *Contract) supersedeUnpaidMedicalSettlement(ctx contractapi.TransactionContextInterface, claim *Claim) error {
	settlement, err := c.ReadSettlement(ctx, claim.MedicalSettlementID)
	if err != nil {
		return err
	}
	if executed, err := medicalBankExecutionExists(ctx, settlement.ID); err != nil || executed {
		return fmt.Errorf("an executed Bank transfer must be confirmed")
	}
	liability, err := c.ReadLiability(ctx, "liability-claim-"+claim.ID)
	if err != nil {
		return err
	}
	if settlement.ClaimID != claim.ID || (settlement.Status != "AUTHORIZED" && settlement.Status != "PAYMENT_FAILED") ||
		liability.SourceID != claim.ID || liability.Status != "PAYMENT_READY" {
		return fmt.Errorf("only an unpaid medical settlement can be superseded")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return err
	}
	settlement.Status, settlement.UpdatedAt = "SUPERSEDED", now
	if claim.MedicalHeldReleaseID != "" {
		settlement.Status = "RETIRED"
	}
	liability.Status, liability.UpdatedAt = "SUPERSEDED", now
	if err := overwriteAsset(ctx, "settlement", settlement.ID, settlement); err != nil {
		return err
	}
	return overwriteAsset(ctx, "liability", liability.ID, liability)
}

func medicalBankExecutionExists(ctx contractapi.TransactionContextInterface, settlementID string) (bool, error) {
	key, err := stateKey(ctx, "medicalBankExecution", settlementID)
	if err != nil {
		return false, err
	}
	hash, err := ctx.GetStub().GetPrivateDataHash(bankInsurerPrivateCollection, key)
	return len(hash) != 0, err
}

func (c *Contract) createClaimLiability(ctx contractapi.TransactionContextInterface, claim *Claim, liability *Liability) error {
	if usesMedicalApprovalCertificates(ctx) && claim.EpisodeID != "" {
		key, err := stateKey(ctx, "liability", liability.ID)
		if err != nil {
			return err
		}
		raw, err := ctx.GetStub().GetState(key)
		if err != nil {
			return err
		}
		if raw != nil {
			old, err := c.ReadLiability(ctx, liability.ID)
			if err != nil {
				return err
			}
			if old.Status != "SUPERSEDED" || old.SourceID != claim.ID || old.SourceType != "CLAIM" {
				return fmt.Errorf("an active or paid liability already exists")
			}
			return overwriteState(ctx, key, liability)
		}
	}
	return putState(ctx, "liability", liability.ID, liability)
}
