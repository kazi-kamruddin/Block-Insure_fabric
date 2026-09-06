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
