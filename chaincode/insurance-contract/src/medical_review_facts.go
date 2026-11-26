package insurance

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalReviewFacts struct {
	DuplicateExplanation string       `json:"duplicateExplanation,omitempty" metadata:",optional"`
	Service              string       `json:"service"`
	ServiceDate          string       `json:"serviceDate"`
	TermsHash            string       `json:"termsHash"`
	Quote                MedicalQuote `json:"quote"`
}

func (c *Contract) ReadMedicalReviewFacts(ctx contractapi.TransactionContextInterface, claimID string) (*MedicalReviewFacts, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.EpisodeID == "" {
		return nil, fmt.Errorf("medical claim required")
	}
	source, err := readMedicalEpisode(ctx, claim.EpisodeID, claim.EpisodeRevision)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, err
	}
	quote, err := getPrivateState[MedicalQuote](ctx, "medicalStatement", medicalRevisionKey(claimID, claim.Version))
	if err != nil {
		return nil, err
	}
	return &MedicalReviewFacts{Service: source.Service, ServiceDate: source.ServiceDate, TermsHash: policy.TermsHash, Quote: *quote}, nil
}
