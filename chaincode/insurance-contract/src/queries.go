package insurance

import "github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

func (c *Contract) ListPolicyPackages(ctx contractapi.TransactionContextInterface) ([]PolicyPackage, error) {
	return listState[PolicyPackage](ctx, "policyPackage")
}

func (c *Contract) ListPolicies(ctx contractapi.TransactionContextInterface) ([]Policy, error) {
	return listState[Policy](ctx, "policy")
}

func (c *Contract) ListClaims(ctx contractapi.TransactionContextInterface) ([]Claim, error) {
	return listState[Claim](ctx, "claim")
}

func (c *Contract) ListEvidenceReferences(ctx contractapi.TransactionContextInterface) ([]EvidenceReference, error) {
	return listState[EvidenceReference](ctx, "evidenceReference")
}

func (c *Contract) ListHospitalVerifications(ctx contractapi.TransactionContextInterface) ([]HospitalVerification, error) {
	return listState[HospitalVerification](ctx, "hospitalVerification")
}

func (c *Contract) ListAuditorDecisions(ctx contractapi.TransactionContextInterface) ([]AuditorDecision, error) {
	return listState[AuditorDecision](ctx, "auditorDecision")
}

func (c *Contract) ListEvidenceAccessRecords(ctx contractapi.TransactionContextInterface) ([]EvidenceAccessRecord, error) {
	return listState[EvidenceAccessRecord](ctx, "evidenceAccess")
}

func (c *Contract) ListSettlements(ctx contractapi.TransactionContextInterface) ([]Settlement, error) {
	return listState[Settlement](ctx, "settlement")
}
