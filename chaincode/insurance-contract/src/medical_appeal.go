package insurance

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func writeMedicalPrivate(ctx contractapi.TransactionContextInterface, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutPrivateData(oracleProofCollection, key, data)
}

func (c *Contract) advanceMedicalVersion(ctx contractapi.TransactionContextInterface, claim *Claim, kind, noteHash, now string) error {
	quote, err := getPrivateState[MedicalQuote](ctx, "medicalStatement", medicalRevisionKey(claim.ID, claim.Version))
	if err != nil {
		return err
	}
	claim.Version++
	claim.MedicalEscalatedAt = ""

	claim.MedicalRevisionKind = kind
	quote.StatementHash = medicalSuccessorHash(quote.StatementHash, kind, claim.Version, noteHash)
	claim.DescriptionHash = quote.StatementHash
	claim.Status, claim.UpdatedAt = "SUBMITTED", now
	claim.CurrentReviewID, claim.CurrentOracleRequestID, claim.HospitalVerificationID = "", "", ""
	claim.OracleOutcome, claim.OracleResultHash, claim.AuditorDecisionID = "", "", ""
	claim.MedicalSettlementID, claim.PrivacyPresentationID = "", ""
	return storeMedicalStatement(ctx, claim, quote)
}

func (c *Contract) SubmitMedicalAppeal(ctx contractapi.TransactionContextInterface, id, claimID, decisionID, evidenceHash string, revision int, acceptedStatementHash string) (*ClaimAppeal, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("isolated medical channel required")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	owner, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.EpisodeID == "" || claim.ClaimantID != owner || claim.Status != "REJECTED" || claim.AppealCount >= maxAppealsPerClaim {
		return nil, fmt.Errorf("a rejected medical claim with an unused appeal is required")
	}
	review, _, err := c.currentMedicalReview(ctx, claim.CurrentReviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "REJECTED" {
		return nil, fmt.Errorf("procedural failures use recovery, not an appeal")
	}
	decision, err := getState[AuditorDecision](ctx, "auditorDecision", decisionID)
	if err != nil {
		return nil, err
	}
	if decision.ReviewID != review.ID || decision.Outcome != "REJECT" {
		return nil, fmt.Errorf("select a rejection reason from the current review")
	}
	if evidenceHash != "" {
		if err := validateHash("evidenceHash", evidenceHash); err != nil {
			return nil, err
		}
	}
	if revision == 0 {
		revision = claim.EpisodeRevision
	}
	if revision < claim.EpisodeRevision || (revision == claim.EpisodeRevision && evidenceHash == "") {
		return nil, fmt.Errorf("commit a new document or select a newer corrected episode")
	}
	if evidenceHash != "" {
		all, err := c.ListEvidenceReferences(ctx)
		if err != nil {
			return nil, err
		}
		for _, doc := range all {
			if doc.ClaimID == claim.ID && strings.EqualFold(doc.ContentHash, evidenceHash) {
				return nil, fmt.Errorf("a previously registered document is not new appeal evidence")
			}
		}
	}
	explanation, err := medicalPrivateEnvelope(ctx)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	original := claimFactsHash(claim)
	corrected := revision > claim.EpisodeRevision
	noteHash := canonicalProtocolHash("fabric-medical-appeal-note-v1", decisionID, explanation, evidenceHash)
	if revision > claim.EpisodeRevision {
		policy, episode, quote, coverage, err := c.medicalFacts(ctx, claim.PolicyID, claim.EpisodeID, revision, claim.AmountMinor, claim.CreatedAt)
		if err != nil {
			return nil, err
		}
		if quote.PayableMinor <= 0 || quote.StatementHash != acceptedStatementHash {
			return nil, fmt.Errorf("accept the current corrected reimbursement quote")
		}
		association, err := verifiedMedicalAssociation(ctx, episode, policy.PolicyholderID)
		if err != nil {
			return nil, err
		}
		coverage.UsedMinor = coverage.UsedMinor - claim.AmountMinor + quote.PayableMinor
		if err := overwriteAsset(ctx, "medicalCoverage", policy.ID, coverage); err != nil {
			return nil, err
		}
		claim.MedicalAssociationKey, claim.MedicalAssociationVersion = medicalAssociationKey(episode), association.Version
		claim.AmountMinor, claim.IncidentDate, claim.EpisodeRevision = quote.PayableMinor, episode.ServiceDate, revision
		claim.HospitalInvoiceID = medicalRevisionKey(episode.ID, revision)
		claim.Version++
		claim.MedicalEscalatedAt = ""

		if err := c.screenMedicalDuplicate(ctx, claim, episode); err != nil {
			return nil, err
		}
		quote.StatementHash = medicalSuccessorHash(quote.StatementHash, "APPEAL", claim.Version, noteHash)
		claim.DescriptionHash = quote.StatementHash
		if err := storeMedicalStatement(ctx, claim, quote); err != nil {
			return nil, err
		}
		claim.MedicalRevisionKind = "APPEAL"
		claim.CurrentReviewID, claim.CurrentOracleRequestID, claim.HospitalVerificationID = "", "", ""
		claim.OracleOutcome, claim.OracleResultHash, claim.AuditorDecisionID = "", "", ""
		claim.MedicalSettlementID, claim.PrivacyPresentationID = "", ""
	} else if err := c.advanceMedicalVersion(ctx, claim, "APPEAL", noteHash, now); err != nil {
		return nil, err
	}
	head, err := currentMedicalHead(ctx, claim)
	if err != nil {
		return nil, err
	}
	appeal := &ClaimAppeal{AssetType: "claimAppeal", SchemaVersion: SchemaVersion, ID: id, ClaimID: claimID, ClaimantID: owner,
		ClaimVersion: claim.Version, Round: claim.AppealCount + 1, CommitmentVersion: appealCommitmentVersion, ReasonCategory: "DOCUMENT_ERROR",
		ReasonHash: decision.ReasonHash, DescriptionHash: noteHash, EvidenceHash: strings.ToLower(evidenceHash), OriginalClaimHash: original,
		ProposedHospitalID: claim.HospitalID, ProposedAmountMinor: claim.AmountMinor, ProposedIncidentDate: claim.IncidentDate,
		ProposedDescriptionHash: claim.DescriptionHash, ProposedClinicalReferenceHash: head.RevisionHash, Status: "SUBMITTED", CreatedAt: now,
		MedicalPriorReviewID: review.ID, DisputedDecisionID: decisionID}
	if corrected && evidenceHash == "" {
		appeal.ReasonCategory = "CLINICAL_CORRECTION"
	}
	appeal.CommitmentHash = appealCommitmentHash(appeal)
	if err := putPrivateState(ctx, "medicalAppealExplanation", id, &struct {
		Text string `json:"text"`
	}{explanation}); err != nil {
		return nil, err
	}
	if err := putState(ctx, "claimAppeal", id, appeal); err != nil {
		return nil, err
	}
	claim.CurrentAppealID, claim.AppealCount, claim.Status, claim.UpdatedAt = id, appeal.Round, "APPEAL_SUBMITTED", now
	claim.MedicalClarificationID, claim.MedicalSupplementHash = "", ""
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return appeal, emit(ctx, "ClaimAppealSubmitted", appeal)
}

func (c *Contract) QuoteMedicalAppeal(ctx contractapi.TransactionContextInterface, claimID string, revision int) (*MedicalQuote, error) {
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "REJECTED" || revision <= claim.EpisodeRevision {
		return nil, fmt.Errorf("a newer revision for a rejected claim is required")
	}
	_, _, quote, _, err := c.medicalFacts(ctx, claim.PolicyID, claim.EpisodeID, revision, claim.AmountMinor, claim.CreatedAt)
	return quote, err
}

type MedicalAppealExplanation struct {
	Text string `json:"text"`
}

func (c *Contract) ReadMedicalAppealExplanation(ctx contractapi.TransactionContextInterface, id string) (*MedicalAppealExplanation, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if msp != "InsurerMSP" || (role != "insurerAdmin" && role != "policyholder") {
		return nil, fmt.Errorf("appeal explanation is private")
	}
	appeal, err := c.ReadClaimAppeal(ctx, id)
	if err != nil {
		return nil, err
	}
	owner, err := callerSubject(ctx)
	if err != nil || (role == "policyholder" && owner != appeal.ClaimantID) {
		return nil, fmt.Errorf("appeal explanation is private")
	}
	return getPrivateState[MedicalAppealExplanation](ctx, "medicalAppealExplanation", id)
}
