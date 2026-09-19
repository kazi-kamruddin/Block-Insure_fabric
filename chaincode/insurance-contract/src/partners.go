package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func normalizePartnerType(value string) (string, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value != "HOSPITAL" && value != "BANK" {
		return "", fmt.Errorf("partnerType must be HOSPITAL or BANK")
	}
	return value, nil
}

func (c *Contract) CreatePartnerAgreement(
	ctx contractapi.TransactionContextInterface,
	id, partnerType, partnerID, name, location, tier, accessScope, effectiveDate, expiryDate string,
) (*PartnerAgreement, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	partnerType, err := normalizePartnerType(partnerType)
	if err != nil {
		return nil, err
	}
	partnerID = strings.TrimSpace(partnerID)
	if !idPattern.MatchString(partnerID) {
		return nil, fmt.Errorf("partnerId is invalid")
	}
	if strings.TrimSpace(name) == "" || strings.TrimSpace(accessScope) == "" {
		return nil, fmt.Errorf("name and accessScope are required")
	}
	effective, err := validateDate("effectiveDate", effectiveDate)
	if err != nil {
		return nil, err
	}
	expiry, err := validateDate("expiryDate", expiryDate)
	if err != nil {
		return nil, err
	}
	if expiry.Before(effective) {
		return nil, fmt.Errorf("expiryDate must not be before effectiveDate")
	}
	agreements, err := c.ListPartnerAgreements(ctx)
	if err != nil {
		return nil, err
	}
	for _, agreement := range agreements {
		if agreement.PartnerType == partnerType && agreement.PartnerID == partnerID && agreement.Status != "ENDED" {
			return nil, fmt.Errorf("an active or suspended %s agreement already exists for %s", partnerType, partnerID)
		}
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	agreement := &PartnerAgreement{
		AssetType: "partnerAgreement", SchemaVersion: SchemaVersion, ID: id,
		PartnerType: partnerType, PartnerID: partnerID, Name: strings.TrimSpace(name),
		Location: strings.TrimSpace(location), Tier: strings.TrimSpace(tier),
		AccessScope: strings.TrimSpace(accessScope), EffectiveDate: effectiveDate,
		ExpiryDate: expiryDate, Status: "ACTIVE", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "partnerAgreement", id, agreement); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PartnerAgreementCreated", agreement); err != nil {
		return nil, err
	}
	return agreement, nil
}

func (c *Contract) SetPartnerAgreementStatus(ctx contractapi.TransactionContextInterface, id, status string) (*PartnerAgreement, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	status = strings.ToUpper(strings.TrimSpace(status))
	if status != "ACTIVE" && status != "SUSPENDED" && status != "ENDED" {
		return nil, fmt.Errorf("status must be ACTIVE, SUSPENDED, or ENDED")
	}
	agreement, err := c.ReadPartnerAgreement(ctx, id)
	if err != nil {
		return nil, err
	}
	if agreement.Status == "ENDED" {
		return nil, fmt.Errorf("agreement %s is already ended", id)
	}
	agreement.Status = status
	agreement.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "partnerAgreement", id, agreement); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PartnerAgreementStatusChanged", agreement); err != nil {
		return nil, err
	}
	return agreement, nil
}

func (c *Contract) ReadPartnerAgreement(ctx contractapi.TransactionContextInterface, id string) (*PartnerAgreement, error) {
	return getState[PartnerAgreement](ctx, "partnerAgreement", id)
}

func (c *Contract) ListPartnerAgreements(ctx contractapi.TransactionContextInterface) ([]PartnerAgreement, error) {
	return listState[PartnerAgreement](ctx, "partnerAgreement")
}

func (c *Contract) requireActivePartner(ctx contractapi.TransactionContextInterface, partnerType, partnerID string) (*PartnerAgreement, error) {
	agreements, err := c.ListPartnerAgreements(ctx)
	if err != nil {
		return nil, err
	}
	for index := range agreements {
		agreement := &agreements[index]
		if agreement.PartnerType == partnerType && agreement.PartnerID == partnerID && agreement.Status == "ACTIVE" {
			return agreement, nil
		}
	}
	return nil, fmt.Errorf("%s %s has no active insurer agreement", strings.ToLower(partnerType), partnerID)
}

func parsePartnerIDs(field, value string) ([]string, error) {
	var ids []string
	if err := json.Unmarshal([]byte(value), &ids); err != nil {
		return nil, fmt.Errorf("%s must be a JSON array of IDs", field)
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("%s must contain at least one partner", field)
	}
	seen := make(map[string]struct{}, len(ids))
	for index, id := range ids {
		ids[index] = strings.TrimSpace(id)
		if !idPattern.MatchString(ids[index]) {
			return nil, fmt.Errorf("%s contains invalid partner id %q", field, ids[index])
		}
		if _, exists := seen[ids[index]]; exists {
			return nil, fmt.Errorf("%s contains duplicate partner id %s", field, ids[index])
		}
		seen[ids[index]] = struct{}{}
	}
	slices.Sort(ids)
	return ids, nil
}

func (c *Contract) ConfigurePolicyPackagePartners(ctx contractapi.TransactionContextInterface, id, hospitalIDsJSON, bankIDsJSON string) (*PolicyPackage, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	policyPackage, err := c.ReadPolicyPackage(ctx, id)
	if err != nil {
		return nil, err
	}
	if policyPackage.Status == "RETIRED" {
		return nil, fmt.Errorf("retired policy package %s cannot change its partner network", id)
	}
	hospitalIDs, err := parsePartnerIDs("hospitalIds", hospitalIDsJSON)
	if err != nil {
		return nil, err
	}
	bankIDs, err := parsePartnerIDs("bankIds", bankIDsJSON)
	if err != nil {
		return nil, err
	}
	for _, hospitalID := range hospitalIDs {
		if _, err := c.requireActivePartner(ctx, "HOSPITAL", hospitalID); err != nil {
			return nil, err
		}
	}
	for _, bankID := range bankIDs {
		if _, err := c.requireActivePartner(ctx, "BANK", bankID); err != nil {
			return nil, err
		}
	}
	policyPackage.HospitalIDs = hospitalIDs
	policyPackage.BankIDs = bankIDs
	policyPackage.Version++
	policyPackage.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "policyPackage", id, policyPackage); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyPackagePartnersConfigured", policyPackage); err != nil {
		return nil, err
	}
	return policyPackage, nil
}
