package insurance

import (
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) CreatePolicyPackage(ctx contractapi.TransactionContextInterface, id, name, description string, premiumMinor, coverageLimitMinor int64, termsHash string) (*PolicyPackage, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("name is required")
	}
	if premiumMinor <= 0 || coverageLimitMinor <= 0 || coverageLimitMinor < premiumMinor {
		return nil, fmt.Errorf("premium and coverage limit must be positive, and coverage must not be below premium")
	}
	if err := validateHash("termsHash", termsHash); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	policyPackage := &PolicyPackage{
		AssetType: "policyPackage", SchemaVersion: SchemaVersion, ID: id, Version: 1,
		Name: strings.TrimSpace(name), Description: strings.TrimSpace(description),
		PremiumMinor: premiumMinor, CoverageLimitMinor: coverageLimitMinor,
		TermsHash: strings.ToLower(termsHash), HospitalIDs: []string{}, BankIDs: []string{},
		Status: "DRAFT", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "policyPackage", id, policyPackage); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyPackageCreated", policyPackage); err != nil {
		return nil, err
	}
	return policyPackage, nil
}

func (c *Contract) PublishPolicyPackage(ctx contractapi.TransactionContextInterface, id string) (*PolicyPackage, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	policyPackage, err := c.ReadPolicyPackage(ctx, id)
	if err != nil {
		return nil, err
	}
	if policyPackage.Status != "DRAFT" {
		return nil, fmt.Errorf("policy package %s must be DRAFT to publish", id)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	policyPackage.Status = "PUBLISHED"
	policyPackage.UpdatedAt = now
	if err := overwriteAsset(ctx, "policyPackage", id, policyPackage); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyPackagePublished", policyPackage); err != nil {
		return nil, err
	}
	return policyPackage, nil
}

func (c *Contract) RetirePolicyPackage(ctx contractapi.TransactionContextInterface, id string) (*PolicyPackage, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	policyPackage, err := c.ReadPolicyPackage(ctx, id)
	if err != nil {
		return nil, err
	}
	if policyPackage.Status != "PUBLISHED" {
		return nil, fmt.Errorf("policy package %s must be PUBLISHED to retire", id)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	policyPackage.Status = "RETIRED"
	policyPackage.UpdatedAt = now
	if err := overwriteAsset(ctx, "policyPackage", id, policyPackage); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyPackageRetired", policyPackage); err != nil {
		return nil, err
	}
	return policyPackage, nil
}

func (c *Contract) IssuePolicy(ctx contractapi.TransactionContextInterface, id, packageID, policyholderID, startDate, endDate string) (*Policy, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if !idPattern.MatchString(policyholderID) {
		return nil, fmt.Errorf("invalid policyholder id %q", policyholderID)
	}
	start, err := validateDate("startDate", startDate)
	if err != nil {
		return nil, err
	}
	end, err := validateDate("endDate", endDate)
	if err != nil {
		return nil, err
	}
	if !end.After(start) {
		return nil, fmt.Errorf("endDate must be after startDate")
	}
	policyPackage, err := c.ReadPolicyPackage(ctx, packageID)
	if err != nil {
		return nil, err
	}
	if policyPackage.Status != "PUBLISHED" {
		return nil, fmt.Errorf("policy package %s is not published", packageID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	policy := &Policy{
		AssetType: "policy", SchemaVersion: SchemaVersion, ID: id,
		PackageID: packageID, PackageVersion: policyPackage.Version, PolicyholderID: policyholderID,
		StartDate: startDate, EndDate: endDate, PremiumMinor: policyPackage.PremiumMinor,
		CoverageLimitMinor: policyPackage.CoverageLimitMinor, TermsHash: policyPackage.TermsHash,
		HospitalIDs: append([]string{}, policyPackage.HospitalIDs...), BankIDs: append([]string{}, policyPackage.BankIDs...),
		Status: "ACTIVE", PremiumIntervalDays: 30, GracePeriodDays: 15,
		PaidThroughDate: startDate, NextPremiumDueDate: start.AddDate(0, 0, 30).Format("2006-01-02"),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := c.snapshotBenefitPlan(ctx, policy); err != nil {
		return nil, err
	}
	if err := putState(ctx, "policy", id, policy); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyIssued", policy); err != nil {
		return nil, err
	}
	return policy, nil
}

func (c *Contract) ReadPolicyPackage(ctx contractapi.TransactionContextInterface, id string) (*PolicyPackage, error) {
	policyPackage, err := getState[PolicyPackage](ctx, "policyPackage", id)
	if err != nil {
		return nil, err
	}
	normalizePolicyPackagePartners(policyPackage)
	return policyPackage, nil
}

func (c *Contract) ReadPolicy(ctx contractapi.TransactionContextInterface, id string) (*Policy, error) {
	policy, err := getState[Policy](ctx, "policy", id)
	if err != nil {
		return nil, err
	}
	normalizePolicyPartners(policy)
	return policy, nil
}

func normalizePolicyPackagePartners(policyPackage *PolicyPackage) {
	if policyPackage.HospitalIDs == nil {
		policyPackage.HospitalIDs = []string{}
	}
	if policyPackage.BankIDs == nil {
		policyPackage.BankIDs = []string{}
	}
}

func normalizePolicyPartners(policy *Policy) {
	if policy.HospitalIDs == nil {
		policy.HospitalIDs = []string{}
	}
	if policy.BankIDs == nil {
		policy.BankIDs = []string{}
	}
}
