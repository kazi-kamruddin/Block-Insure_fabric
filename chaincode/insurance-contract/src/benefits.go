package insurance

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) CreateBenefitPlan(ctx contractapi.TransactionContextInterface, id, packageID string, deathBenefitMinor, surrenderBenefitMinor, maturityBenefitMinor int64, rulesHash string) (*BenefitPlan, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if deathBenefitMinor < 0 || surrenderBenefitMinor < 0 || maturityBenefitMinor < 0 || deathBenefitMinor+surrenderBenefitMinor+maturityBenefitMinor == 0 {
		return nil, fmt.Errorf("at least one non-negative benefit amount must be configured")
	}
	if err := validateHash("rulesHash", rulesHash); err != nil {
		return nil, err
	}
	policyPackage, err := c.ReadPolicyPackage(ctx, packageID)
	if err != nil {
		return nil, err
	}
	if policyPackage.Status == "RETIRED" {
		return nil, fmt.Errorf("benefits cannot be configured for retired package %s", packageID)
	}
	plans, err := c.ListBenefitPlans(ctx)
	if err != nil {
		return nil, err
	}
	version := 1
	for _, existing := range plans {
		if existing.PackageID == packageID && existing.Version >= version {
			version = existing.Version + 1
		}
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	plan := &BenefitPlan{
		AssetType: "benefitPlan", SchemaVersion: SchemaVersion, ID: id, PackageID: packageID,
		Version: version, DeathBenefitMinor: deathBenefitMinor, SurrenderBenefitMinor: surrenderBenefitMinor,
		MaturityBenefitMinor: maturityBenefitMinor, RulesHash: strings.ToLower(rulesHash),
		Status: "DRAFT", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "benefitPlan", id, plan); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitPlanCreated", plan); err != nil {
		return nil, err
	}
	return plan, nil
}

func (c *Contract) RetireBenefitPlan(ctx contractapi.TransactionContextInterface, id string) (*BenefitPlan, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	plan, err := c.ReadBenefitPlan(ctx, id)
	if err != nil {
		return nil, err
	}
	if plan.Status != "PUBLISHED" {
		return nil, fmt.Errorf("benefit plan %s must be PUBLISHED to retire", id)
	}
	plan.Status = "RETIRED"
	plan.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "benefitPlan", id, plan); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitPlanRetired", plan); err != nil {
		return nil, err
	}
	return plan, nil
}

func (c *Contract) snapshotBenefitPlan(ctx contractapi.TransactionContextInterface, policy *Policy) error {
	plans, err := c.ListBenefitPlans(ctx)
	if err != nil {
		return err
	}
	plan, err := publishedBenefitPlan(plans, policy.PackageID)
	if err != nil {
		return nil
	}
	policy.BenefitPlanID = plan.ID
	policy.BenefitPlanVersion = plan.Version
	policy.DeathBenefitMinor = plan.DeathBenefitMinor
	policy.SurrenderBenefitMinor = plan.SurrenderBenefitMinor
	policy.MaturityBenefitMinor = plan.MaturityBenefitMinor
	policy.BenefitRulesHash = plan.RulesHash
	return nil
}

func (c *Contract) PublishBenefitPlan(ctx contractapi.TransactionContextInterface, id string) (*BenefitPlan, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	plan, err := c.ReadBenefitPlan(ctx, id)
	if err != nil {
		return nil, err
	}
	if plan.Status != "DRAFT" {
		return nil, fmt.Errorf("benefit plan %s must be DRAFT to publish", id)
	}
	plans, err := c.ListBenefitPlans(ctx)
	if err != nil {
		return nil, err
	}
	for _, existing := range plans {
		if existing.PackageID == plan.PackageID && existing.Status == "PUBLISHED" {
			return nil, fmt.Errorf("package %s already has published benefit plan %s", plan.PackageID, existing.ID)
		}
	}
	plan.Status = "PUBLISHED"
	plan.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "benefitPlan", id, plan); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitPlanPublished", plan); err != nil {
		return nil, err
	}
	return plan, nil
}

func parseAllocations(value string) ([]BeneficiaryAllocation, error) {
	var allocations []BeneficiaryAllocation
	if err := json.Unmarshal([]byte(value), &allocations); err != nil {
		return nil, fmt.Errorf("allocationsJson must be a JSON array: %w", err)
	}
	if len(allocations) == 0 || len(allocations) > 10 {
		return nil, fmt.Errorf("one to ten beneficiary allocations are required")
	}
	total := 0
	seen := make(map[string]bool)
	for _, allocation := range allocations {
		if !idPattern.MatchString(allocation.BeneficiaryID) {
			return nil, fmt.Errorf("invalid beneficiary id %q", allocation.BeneficiaryID)
		}
		if seen[allocation.BeneficiaryID] {
			return nil, fmt.Errorf("beneficiary %s appears more than once", allocation.BeneficiaryID)
		}
		if allocation.ShareBps <= 0 || allocation.ShareBps > 10_000 {
			return nil, fmt.Errorf("beneficiary shares must be between 1 and 10000 basis points")
		}
		seen[allocation.BeneficiaryID] = true
		total += allocation.ShareBps
	}
	if total != 10_000 {
		return nil, fmt.Errorf("beneficiary shares must total 10000 basis points")
	}
	return allocations, nil
}

func (c *Contract) SetBeneficiaries(ctx contractapi.TransactionContextInterface, policyID, allocationsJSON string) (*BeneficiaryDesignation, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if policy.PolicyholderID != ownerID {
		return nil, fmt.Errorf("access denied: policy %s belongs to another policyholder", policyID)
	}
	if policy.Status == "CANCELLED" {
		return nil, fmt.Errorf("beneficiaries cannot be changed for a cancelled policy")
	}
	allocations, err := parseAllocations(allocationsJSON)
	if err != nil {
		return nil, err
	}
	revision := 1
	key, err := stateKey(ctx, "beneficiaryDesignation", policyID)
	if err != nil {
		return nil, err
	}
	if payload, err := ctx.GetStub().GetState(key); err != nil {
		return nil, fmt.Errorf("read beneficiary designation: %w", err)
	} else if payload != nil {
		var previous BeneficiaryDesignation
		if err := json.Unmarshal(payload, &previous); err != nil {
			return nil, fmt.Errorf("decode beneficiary designation: %w", err)
		}
		revision = previous.Revision + 1
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	designation := &BeneficiaryDesignation{
		AssetType: "beneficiaryDesignation", SchemaVersion: SchemaVersion, PolicyID: policyID,
		OwnerID: ownerID, Revision: revision, Allocations: allocations, UpdatedAt: now,
	}
	if err := overwriteAsset(ctx, "beneficiaryDesignation", policyID, designation); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BeneficiariesUpdated", designation); err != nil {
		return nil, err
	}
	return designation, nil
}

func publishedBenefitPlan(plans []BenefitPlan, packageID string) (*BenefitPlan, error) {
	for index := range plans {
		if plans[index].PackageID == packageID && plans[index].Status == "PUBLISHED" {
			return &plans[index], nil
		}
	}
	return nil, fmt.Errorf("package %s has no published benefit plan", packageID)
}

func (c *Contract) SubmitBenefitRequest(ctx contractapi.TransactionContextInterface, id, policyID, benefitType, eventDate, evidenceHash string) (*BenefitRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	requesterID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if policy.PolicyholderID != requesterID {
		return nil, fmt.Errorf("access denied: policy %s belongs to another policyholder", policyID)
	}
	if err := validateHash("evidenceHash", evidenceHash); err != nil {
		return nil, err
	}
	start, _ := validateDate("startDate", policy.StartDate)
	end, _ := validateDate("endDate", policy.EndDate)
	if !dateWithin(eventDate, start, end) {
		return nil, fmt.Errorf("eventDate is outside the policy coverage period")
	}
	benefitType = strings.ToUpper(strings.TrimSpace(benefitType))
	var amount int64
	switch benefitType {
	case "DEATH":
		if policy.Status != "ACTIVE" && policy.Status != "GRACE" && policy.Status != "EXPIRED" {
			return nil, fmt.Errorf("death benefit is not eligible from policy status %s", policy.Status)
		}
		amount = policy.DeathBenefitMinor
	case "SURRENDER":
		if policy.Status != "ACTIVE" && policy.Status != "GRACE" {
			return nil, fmt.Errorf("surrender benefit requires ACTIVE or GRACE policy status")
		}
		amount = policy.SurrenderBenefitMinor
	case "MATURITY":
		if policy.Status != "EXPIRED" {
			return nil, fmt.Errorf("maturity benefit requires EXPIRED policy status")
		}
		amount = policy.MaturityBenefitMinor
		if eventDate != policy.EndDate {
			return nil, fmt.Errorf("maturity eventDate must equal the policy end date")
		}
	default:
		return nil, fmt.Errorf("benefitType must be DEATH, SURRENDER, or MATURITY")
	}
	if policy.BenefitPlanID == "" {
		return nil, fmt.Errorf("policy %s has no snapshotted benefit plan", policyID)
	}
	if amount <= 0 {
		return nil, fmt.Errorf("%s benefit is not enabled for this package", benefitType)
	}
	designation, err := c.ReadBeneficiaryDesignation(ctx, policyID)
	if err != nil {
		return nil, fmt.Errorf("beneficiaries must be designated before requesting a benefit: %w", err)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	request := &BenefitRequest{
		AssetType: "benefitRequest", SchemaVersion: SchemaVersion, ID: id, PolicyID: policyID,
		RequesterID: requesterID, BenefitType: benefitType, BenefitPlanID: policy.BenefitPlanID,
		BenefitPlanVersion: policy.BenefitPlanVersion, BenefitRulesHash: policy.BenefitRulesHash,
		EventDate: eventDate, AmountMinor: amount,
		EvidenceHash: strings.ToLower(evidenceHash), Status: "SUBMITTED",
		Allocations: designation.Allocations, CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "benefitRequest", id, request); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitRequested", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) DecideBenefitRequest(ctx contractapi.TransactionContextInterface, id, outcome, decisionHash string) (*BenefitRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	if outcome != "APPROVE" && outcome != "REJECT" {
		return nil, fmt.Errorf("outcome must be APPROVE or REJECT")
	}
	if err := validateHash("decisionHash", decisionHash); err != nil {
		return nil, err
	}
	request, err := c.ReadBenefitRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if request.Status != "SUBMITTED" {
		return nil, fmt.Errorf("benefit request %s must be SUBMITTED for a decision", id)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	request.DecisionHash = strings.ToLower(decisionHash)
	request.UpdatedAt = now
	if outcome == "REJECT" {
		request.Status = "REJECTED"
	} else {
		request.Status = "FUNDING_REQUIRED"
		liability := &Liability{
			AssetType: "liability", SchemaVersion: SchemaVersion, ID: "liability-benefit-" + id,
			SourceType: "BENEFIT", SourceID: id, PolicyID: request.PolicyID,
			AmountMinor: request.AmountMinor, Status: "FUNDING_REQUIRED", CreatedAt: now, UpdatedAt: now,
		}
		if err := putState(ctx, "liability", liability.ID, liability); err != nil {
			return nil, err
		}
	}
	if err := overwriteAsset(ctx, "benefitRequest", id, request); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitDecisionRecorded", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) MarkBenefitPaymentReady(ctx contractapi.TransactionContextInterface, id, fundingReferenceHash string) (*BenefitRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if err := validateHash("fundingReferenceHash", fundingReferenceHash); err != nil {
		return nil, err
	}
	request, err := c.ReadBenefitRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if request.Status != "FUNDING_REQUIRED" {
		return nil, fmt.Errorf("benefit request %s must be FUNDING_REQUIRED", id)
	}
	liability, err := c.ReadLiability(ctx, "liability-benefit-"+id)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	request.Status = "PAYMENT_READY"
	request.FundingReferenceHash = strings.ToLower(fundingReferenceHash)
	request.UpdatedAt = now
	liability.Status = "PAYMENT_READY"
	liability.FundingReferenceHash = request.FundingReferenceHash
	liability.UpdatedAt = now
	if err := overwriteAsset(ctx, "benefitRequest", id, request); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "liability", liability.ID, liability); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitPaymentReady", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) ConfirmBenefitPayment(ctx contractapi.TransactionContextInterface, id, bankReferenceHash string) (*BenefitRequest, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if err := validateHash("bankReferenceHash", bankReferenceHash); err != nil {
		return nil, err
	}
	request, err := c.ReadBenefitRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if request.Status != "PAYMENT_READY" {
		return nil, fmt.Errorf("benefit request %s must be PAYMENT_READY", id)
	}
	liability, err := c.ReadLiability(ctx, "liability-benefit-"+id)
	if err != nil {
		return nil, err
	}
	payments, err := c.ListPremiumPayments(ctx)
	if err != nil {
		return nil, err
	}
	var fundingPayment *PremiumPayment
	for index := range payments {
		payment := &payments[index]
		if payment.PolicyID != request.PolicyID || payment.DestinationAccountID == "" {
			continue
		}
		if fundingPayment == nil || payment.RecordedAt > fundingPayment.RecordedAt {
			fundingPayment = payment
		}
	}
	if fundingPayment == nil {
		return nil, fmt.Errorf("benefit request %s has no policy-linked insurer funding account", id)
	}
	fundingAccount, err := c.ReadBankAccountReference(ctx, fundingPayment.DestinationAccountID)
	if err != nil {
		return nil, err
	}
	if fundingAccount.AccountType != "INSURER" || fundingAccount.OwnerID != "insurer" {
		return nil, fmt.Errorf("benefit funding account %s must be an insurer account", fundingAccount.ID)
	}
	if fundingAccount.BalanceMinor < request.AmountMinor {
		return nil, fmt.Errorf("insurer account %s has insufficient funds for benefit %s", fundingAccount.ID, id)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	fundingAccount.BalanceMinor -= request.AmountMinor
	fundingAccount.UpdatedAt = now
	if err := persistBankAccount(ctx, fundingAccount, false); err != nil {
		return nil, err
	}
	request.Status = "PAID"
	request.BankReferenceHash = strings.ToLower(bankReferenceHash)
	request.UpdatedAt = now
	liability.Status = "PAID"
	liability.BankReferenceHash = request.BankReferenceHash
	liability.UpdatedAt = now
	if err := overwriteAsset(ctx, "benefitRequest", id, request); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "liability", liability.ID, liability); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BenefitPaymentConfirmed", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) ReadBenefitPlan(ctx contractapi.TransactionContextInterface, id string) (*BenefitPlan, error) {
	return getState[BenefitPlan](ctx, "benefitPlan", id)
}

func (c *Contract) ReadBeneficiaryDesignation(ctx contractapi.TransactionContextInterface, policyID string) (*BeneficiaryDesignation, error) {
	return getState[BeneficiaryDesignation](ctx, "beneficiaryDesignation", policyID)
}

func (c *Contract) ReadBenefitRequest(ctx contractapi.TransactionContextInterface, id string) (*BenefitRequest, error) {
	return getState[BenefitRequest](ctx, "benefitRequest", id)
}

func (c *Contract) ReadLiability(ctx contractapi.TransactionContextInterface, id string) (*Liability, error) {
	return getState[Liability](ctx, "liability", id)
}
