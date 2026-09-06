package insurance

import (
	"fmt"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const defaultPremiumIntervalDays = 30
const defaultGracePeriodDays = 15

func policyFromPackage(id string, policyPackage *PolicyPackage, ownerID, startDate, endDate, status, renewedFrom, now string) *Policy {
	start, _ := validateDate("startDate", startDate)
	return &Policy{
		AssetType: "policy", SchemaVersion: SchemaVersion, ID: id,
		PackageID: policyPackage.ID, PackageVersion: policyPackage.Version, PolicyholderID: ownerID,
		StartDate: startDate, EndDate: endDate, PremiumMinor: policyPackage.PremiumMinor,
		CoverageLimitMinor: policyPackage.CoverageLimitMinor, TermsHash: policyPackage.TermsHash,
		Status: status, PremiumIntervalDays: defaultPremiumIntervalDays, GracePeriodDays: defaultGracePeriodDays,
		NextPremiumDueDate: start.Format("2006-01-02"), RenewedFromPolicyID: renewedFrom,
		CreatedAt: now, UpdatedAt: now,
	}
}

func (c *Contract) AcquirePolicy(ctx contractapi.TransactionContextInterface, id, packageID, startDate, endDate string) (*Policy, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
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
	policy := policyFromPackage(id, policyPackage, ownerID, startDate, endDate, "PENDING_PAYMENT", "", now)
	if err := c.snapshotBenefitPlan(ctx, policy); err != nil {
		return nil, err
	}
	if err := putState(ctx, "policy", id, policy); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyAcquired", policy); err != nil {
		return nil, err
	}
	return policy, nil
}

func (c *Contract) AdvancePolicyLifecycle(ctx contractapi.TransactionContextInterface, id, asOfDate string) (*Policy, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	asOf, err := validateDate("asOfDate", asOfDate)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, id)
	if err != nil {
		return nil, err
	}
	if policy.Status == "CANCELLED" || policy.Status == "EXPIRED" || policy.Status == "PENDING_PAYMENT" {
		return nil, fmt.Errorf("policy %s cannot advance from %s", id, policy.Status)
	}
	end, _ := validateDate("endDate", policy.EndDate)
	previous := policy.Status
	if !asOf.Before(end) {
		policy.Status = "EXPIRED"
	} else {
		due, err := validateDate("nextPremiumDueDate", policy.NextPremiumDueDate)
		if err != nil {
			return nil, err
		}
		graceDays := policy.GracePeriodDays
		if graceDays == 0 {
			graceDays = defaultGracePeriodDays
		}
		if asOf.After(due.AddDate(0, 0, graceDays)) {
			policy.Status = "LAPSED"
		} else if asOf.After(due) {
			policy.Status = "GRACE"
		} else {
			return nil, fmt.Errorf("policy %s has no lifecycle transition due on %s", id, asOfDate)
		}
	}
	if policy.Status == previous {
		return nil, fmt.Errorf("policy %s is already %s", id, previous)
	}
	policy.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "policy", id, policy); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyLifecycleAdvanced", policy); err != nil {
		return nil, err
	}
	return policy, nil
}

func (c *Contract) CancelPolicy(ctx contractapi.TransactionContextInterface, id, reasonHash string) (*Policy, error) {
	_, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if mspID != "InsurerMSP" || (role != "policyholder" && role != "insurerAdmin") {
		return nil, fmt.Errorf("access denied: policyholder or insurerAdmin role is required")
	}
	if err := validateHash("reasonHash", reasonHash); err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, id)
	if err != nil {
		return nil, err
	}
	if role == "policyholder" {
		subject, err := callerSubject(ctx)
		if err != nil {
			return nil, err
		}
		if policy.PolicyholderID != subject {
			return nil, fmt.Errorf("access denied: policy %s belongs to another policyholder", id)
		}
	}
	if policy.Status == "CANCELLED" || policy.Status == "EXPIRED" {
		return nil, fmt.Errorf("policy %s cannot be cancelled from %s", id, policy.Status)
	}
	policy.Status = "CANCELLED"
	policy.CancellationReasonHash = strings.ToLower(reasonHash)
	policy.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "policy", id, policy); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyCancelled", policy); err != nil {
		return nil, err
	}
	return policy, nil
}

func (c *Contract) RenewPolicy(ctx contractapi.TransactionContextInterface, newID, existingID, newEndDate string) (*Policy, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	existing, err := c.ReadPolicy(ctx, existingID)
	if err != nil {
		return nil, err
	}
	if existing.PolicyholderID != ownerID {
		return nil, fmt.Errorf("access denied: policy %s belongs to another policyholder", existingID)
	}
	if existing.Status == "CANCELLED" || existing.Status == "PENDING_PAYMENT" {
		return nil, fmt.Errorf("policy %s cannot be renewed from %s", existingID, existing.Status)
	}
	oldEnd, _ := validateDate("endDate", existing.EndDate)
	newEnd, err := validateDate("newEndDate", newEndDate)
	if err != nil {
		return nil, err
	}
	newStart := oldEnd.AddDate(0, 0, 1)
	if !newEnd.After(newStart) {
		return nil, fmt.Errorf("newEndDate must be after the renewal start date")
	}
	policyPackage, err := c.ReadPolicyPackage(ctx, existing.PackageID)
	if err != nil {
		return nil, err
	}
	if policyPackage.Status != "PUBLISHED" {
		return nil, fmt.Errorf("policy package %s is not published for renewal", existing.PackageID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	policy := policyFromPackage(newID, policyPackage, ownerID, newStart.Format("2006-01-02"), newEndDate, "PENDING_PAYMENT", existingID, now)
	if err := c.snapshotBenefitPlan(ctx, policy); err != nil {
		return nil, err
	}
	if err := putState(ctx, "policy", newID, policy); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyRenewed", policy); err != nil {
		return nil, err
	}
	return policy, nil
}

func dateWithin(value string, start, end time.Time) bool {
	date, err := validateDate("date", value)
	return err == nil && !date.Before(start) && !date.After(end)
}
