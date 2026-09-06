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

func (c *Contract) ListClaimReviews(ctx contractapi.TransactionContextInterface) ([]ClaimReview, error) {
	return listState[ClaimReview](ctx, "claimReview")
}

func (c *Contract) ListClaimAppeals(ctx contractapi.TransactionContextInterface) ([]ClaimAppeal, error) {
	return listState[ClaimAppeal](ctx, "claimAppeal")
}

func (c *Contract) ListFraudAssessments(ctx contractapi.TransactionContextInterface) ([]FraudAssessment, error) {
	return listState[FraudAssessment](ctx, "fraudAssessment")
}

func (c *Contract) ListEvidenceAccessRecords(ctx contractapi.TransactionContextInterface) ([]EvidenceAccessRecord, error) {
	return listState[EvidenceAccessRecord](ctx, "evidenceAccess")
}

func (c *Contract) ListEvidenceAccessGrants(ctx contractapi.TransactionContextInterface) ([]EvidenceAccessGrant, error) {
	return listState[EvidenceAccessGrant](ctx, "evidenceGrant")
}

func (c *Contract) ListSettlements(ctx contractapi.TransactionContextInterface) ([]Settlement, error) {
	return listState[Settlement](ctx, "settlement")
}

func (c *Contract) ListBankAccountReferences(ctx contractapi.TransactionContextInterface) ([]BankAccountReference, error) {
	return listState[BankAccountReference](ctx, "bankAccountReference")
}

func (c *Contract) ListBankMandates(ctx contractapi.TransactionContextInterface) ([]BankMandate, error) {
	return listState[BankMandate](ctx, "bankMandate")
}

func (c *Contract) ListPremiumPayments(ctx contractapi.TransactionContextInterface) ([]PremiumPayment, error) {
	return listState[PremiumPayment](ctx, "premiumPayment")
}

func (c *Contract) ListPremiumAdjustments(ctx contractapi.TransactionContextInterface) ([]PremiumAdjustment, error) {
	return listState[PremiumAdjustment](ctx, "premiumAdjustment")
}

func (c *Contract) ListPremiumCollections(ctx contractapi.TransactionContextInterface) ([]PremiumCollection, error) {
	return listState[PremiumCollection](ctx, "premiumCollection")
}

func (c *Contract) ListBenefitPlans(ctx contractapi.TransactionContextInterface) ([]BenefitPlan, error) {
	return listState[BenefitPlan](ctx, "benefitPlan")
}

func (c *Contract) ListBeneficiaryDesignations(ctx contractapi.TransactionContextInterface) ([]BeneficiaryDesignation, error) {
	return listState[BeneficiaryDesignation](ctx, "beneficiaryDesignation")
}

func (c *Contract) ListBenefitRequests(ctx contractapi.TransactionContextInterface) ([]BenefitRequest, error) {
	return listState[BenefitRequest](ctx, "benefitRequest")
}

func (c *Contract) ListLiabilities(ctx contractapi.TransactionContextInterface) ([]Liability, error) {
	return listState[Liability](ctx, "liability")
}

func (c *Contract) ListOracleRegistrySnapshots(ctx contractapi.TransactionContextInterface) ([]OracleRegistrySnapshot, error) {
	return listState[OracleRegistrySnapshot](ctx, "oracleRegistrySnapshot")
}

func (c *Contract) ListOracleRequests(ctx contractapi.TransactionContextInterface) ([]OracleRequest, error) {
	return listState[OracleRequest](ctx, "oracleRequest")
}

func (c *Contract) ListOracleCommitments(ctx contractapi.TransactionContextInterface) ([]OracleCommitment, error) {
	return listState[OracleCommitment](ctx, "oracleCommitment")
}

func (c *Contract) ListOracleResults(ctx contractapi.TransactionContextInterface) ([]OracleResult, error) {
	return listState[OracleResult](ctx, "oracleResult")
}
