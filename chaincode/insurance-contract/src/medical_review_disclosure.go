package insurance

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const auditorReviewCollection = "auditorReviewPrivateData"

type MedicalReviewDisclosureSource struct {
	DuplicateExplanationBytes []byte `json:"duplicateExplanationBytes,omitempty" metadata:",optional"`
	EpisodeBytes              []byte `json:"episodeBytes"`
	StatementBytes            []byte `json:"statementBytes"`
}

func medicalReviewDisclosureKeys(ctx contractapi.TransactionContextInterface, claim *Claim) (string, string, error) {
	episode, err := privateStateKey(ctx, "medicalEpisodeRevision", medicalRevisionKey(claim.EpisodeID, claim.EpisodeRevision))
	if err != nil {
		return "", "", err
	}
	statement, err := privateStateKey(ctx, "medicalStatement", medicalRevisionKey(claim.ID, claim.Version))
	return episode, statement, err
}

func (c *Contract) ReadMedicalReviewDisclosureSource(ctx contractapi.TransactionContextInterface, claimID string) (*MedicalReviewDisclosureSource, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	episodeKey, statementKey, err := medicalReviewDisclosureKeys(ctx, claim)
	if err != nil {
		return nil, err
	}
	episode, err := ctx.GetStub().GetPrivateData(oracleProofCollection, episodeKey)
	if err != nil || len(episode) == 0 {
		return nil, fmt.Errorf("medical episode facts are unavailable on the insurer peer")
	}
	statement, err := ctx.GetStub().GetPrivateData(oracleProofCollection, statementKey)
	if err != nil || len(statement) == 0 {
		return nil, fmt.Errorf("medical statement facts are unavailable on the insurer peer")
	}
	source := &MedicalReviewDisclosureSource{EpisodeBytes: episode, StatementBytes: statement}
	if claim.MedicalDuplicateExplanationHash != "" {
		key, err := privateStateKey(ctx, "medicalDuplicateExplanation", medicalRevisionKey(claim.ID, claim.Version))
		if err != nil {
			return nil, err
		}
		source.DuplicateExplanationBytes, err = ctx.GetStub().GetPrivateData(oracleProofCollection, key)
		if err != nil || len(source.DuplicateExplanationBytes) == 0 {
			return nil, fmt.Errorf("duplicate explanation is unavailable on the insurer peer")
		}
	}
	return source, nil
}

func bindReviewDisclosure(ctx contractapi.TransactionContextInterface, review *ClaimReview, claim *Claim) error {
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return err
	}
	episodeKey, statementKey, err := medicalReviewDisclosureKeys(ctx, claim)
	if err != nil {
		return err
	}
	source := MedicalReviewDisclosureSource{EpisodeBytes: transient["medicalEpisodeFacts"], StatementBytes: transient["medicalStatementFacts"]}
	fields := []struct {
		key   string
		value []byte
	}{{episodeKey, source.EpisodeBytes}, {statementKey, source.StatementBytes}}
	if claim.MedicalDuplicateExplanationHash != "" {
		key, err := privateStateKey(ctx, "medicalDuplicateExplanation", medicalRevisionKey(claim.ID, claim.Version))
		if err != nil {
			return err
		}
		source.DuplicateExplanationBytes = transient["medicalDuplicateExplanation"]
		fields = append(fields, struct {
			key   string
			value []byte
		}{key, source.DuplicateExplanationBytes})
	}
	for _, field := range fields {
		if len(field.value) == 0 {
			return fmt.Errorf("exact episode and statement facts are required in transient data")
		}
		committed, err := ctx.GetStub().GetPrivateDataHash(oracleProofCollection, field.key)
		hash := sha256.Sum256(field.value)
		if err != nil || subtle.ConstantTimeCompare(hash[:], committed) != 1 {
			return fmt.Errorf("transient facts do not match the committed medical record")
		}
	}
	key, err := privateStateKey(ctx, "medicalReviewDisclosure", review.ID)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(source)
	if err != nil {
		return err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return err
	}
	if err := ctx.GetStub().PutPrivateData(auditorReviewCollection, key, payload); err != nil {
		return err
	}
	review.DisclosureIssuedAt = now
	return nil
}

func (c *Contract) DiscloseMedicalReviewFacts(ctx contractapi.TransactionContextInterface, reviewID string) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	review, claim, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.BallotVersion != sealedPanelBallot || review.Status != "PREPARING" || review.DisclosureIssuedAt != "" {
		return nil, fmt.Errorf("undisclosed sealed panel preparation required")
	}
	if err := bindReviewDisclosure(ctx, review, claim); err != nil {
		return nil, err
	}
	return review, overwriteAsset(ctx, "claimReview", review.ID, review)
}

func (c *Contract) ReadMedicalReviewDisclosure(ctx contractapi.TransactionContextInterface, reviewID string) (*MedicalReviewFacts, error) {
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	review, err := c.ReadClaimReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	assignments := review.AssignedAuditorIDs
	if !containsAssignment(assignments, subject) || review.DisclosureIssuedAt == "" {
		return nil, fmt.Errorf("assigned auditor and issued review disclosure required")
	}
	key, err := privateStateKey(ctx, "medicalReviewDisclosure", reviewID)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetPrivateData(auditorReviewCollection, key)
	if err != nil || len(raw) == 0 {
		return nil, fmt.Errorf("review disclosure is unavailable on this peer")
	}
	var source MedicalReviewDisclosureSource
	var episode MedicalEpisode
	var quote MedicalQuote
	if json.Unmarshal(raw, &source) != nil || json.Unmarshal(source.EpisodeBytes, &episode) != nil ||
		json.Unmarshal(source.StatementBytes, &quote) != nil {
		return nil, fmt.Errorf("invalid medical review disclosure")
	}
	claim, err := c.ReadClaim(ctx, review.ClaimID)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, err
	}
	return &MedicalReviewFacts{Service: episode.Service, ServiceDate: episode.ServiceDate, TermsHash: policy.TermsHash, Quote: quote,
		DuplicateExplanation: string(source.DuplicateExplanationBytes)}, nil
}
