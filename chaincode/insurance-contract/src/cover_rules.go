package insurance

import (
	"fmt"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Cover rules for the medical product: cover is never backdated, starts only
// once the first premium is paid, and a lapse is never covered after the fact.
// Policies written before CoverStartDate existed keep their issued terms.

// maxAdvancePurchaseDays bounds how far ahead a medical policy may start.
const maxAdvancePurchaseDays = 60

func ledgerToday(ctx contractapi.TransactionContextInterface) (time.Time, string, error) {
	today, err := ledgerBusinessDate(ctx)
	if err != nil {
		return time.Time{}, "", err
	}
	parsed, err := validateDate("ledger business date", today)
	return parsed, today, err
}

func policyGraceDays(policy *Policy) int {
	if policy.GracePeriodDays == 0 {
		return defaultGracePeriodDays
	}
	return policy.GracePeriodDays
}

func addDays(value string, days int) (string, error) {
	date, err := validateDate("date", value)
	if err != nil {
		return "", err
	}
	return date.AddDate(0, 0, days).Format(time.DateOnly), nil
}

// requireMedicalPolicyTerm applies R1: the start date is today or up to 60 days
// ahead in Asia/Dhaka, and the term is at most one year.
func requireMedicalPolicyTerm(ctx contractapi.TransactionContextInterface, start, end time.Time) error {
	today, todayText, err := ledgerToday(ctx)
	if err != nil {
		return err
	}
	if start.Before(today) {
		return fmt.Errorf("coverage cannot start before the ledger business date %s; medical cover is never backdated", todayText)
	}
	if latest := today.AddDate(0, 0, maxAdvancePurchaseDays); start.After(latest) {
		return fmt.Errorf("coverage can start at most %d days ahead, by %s", maxAdvancePurchaseDays, latest.Format(time.DateOnly))
	}
	if end.After(start.AddDate(1, 0, 0)) {
		return fmt.Errorf("a medical policy term is at most one year; buy a new policy to continue cover")
	}
	return nil
}

// validateMedicalPremiumTiming applies R2, R4 and R5 to an installment that
// starts on periodStartDate. Other products keep their recorded behaviour.
func validateMedicalPremiumTiming(ctx contractapi.TransactionContextInterface, policy *Policy, periodStartDate string) error {
	if policy.MedicalRulesVersion == 0 {
		return nil
	}
	_, today, err := ledgerToday(ctx)
	if err != nil {
		return err
	}
	grace := policyGraceDays(policy)
	switch policy.Status {
	case "PENDING_PAYMENT":
		lastDay, err := addDays(policy.StartDate, grace)
		if err != nil {
			return err
		}
		if today > lastDay {
			return fmt.Errorf("the first premium for policy %s had to be paid by %s; this offer has expired, so buy a new policy", policy.ID, lastDay)
		}
	case "LAPSED":
		if policy.ReinstatedDate == "" || policy.ReinstatedDate != today || periodStartDate != policy.ReinstatedDate {
			return fmt.Errorf("policy %s has lapsed and missed installments cannot be paid; ask the Insurer to reinstate it", policy.ID)
		}
	default:
		due := policy.NextPremiumDueDate
		if due == "" {
			due = policy.StartDate
		}
		graceEnd, err := addDays(due, grace)
		if err != nil {
			return err
		}
		if today > graceEnd {
			return fmt.Errorf("the grace period for the installment due %s ended on %s, so policy %s has lapsed; ask the Insurer to reinstate it", due, graceEnd, policy.ID)
		}
	}
	return nil
}

// requireMedicalCoverForStay applies R2 and R3 to policies written under these
// rules: the hospital stay must begin on a covered, paid date after the
// waiting period, which restarts on reinstatement.
func (c *Contract) requireMedicalCoverForStay(ctx contractapi.TransactionContextInterface, policy *Policy, episode *MedicalEpisode, rules *MedicalRules) error {
	if policy.CoverStartDate == "" {
		return nil
	}
	admission := episode.AdmissionDate
	if _, err := validateDate("admission date", admission); err != nil {
		return fmt.Errorf("hospital clarification is needed for the admission date")
	}
	if admission < policy.CoverStartDate {
		return fmt.Errorf("the hospital stay began on %s, before cover started on %s", admission, policy.CoverStartDate)
	}
	waitFrom := policy.CoverStartDate
	if policy.ReinstatedDate != "" && admission >= policy.ReinstatedDate {
		waitFrom = policy.ReinstatedDate
	}
	waitEnds, err := addDays(waitFrom, rules.WaitingDays)
	if err != nil {
		return err
	}
	if admission < waitEnds {
		return fmt.Errorf("the hospital stay began on %s, inside the waiting period that ends on %s", admission, waitEnds)
	}
	if err := c.requirePaidMedicalPeriod(ctx, policy, admission); err != nil {
		return fmt.Errorf("the hospital stay began on %s, a date without paid cover", admission)
	}
	return nil
}

// supersedeOpenCollections closes collections due before `before` that the
// policy can no longer accept, so they do not stay due forever.
func (c *Contract) supersedeOpenCollections(ctx contractapi.TransactionContextInterface, policyID, before, now string) error {
	collections, err := c.ListPremiumCollections(ctx)
	if err != nil {
		return err
	}
	for index := range collections {
		collection := &collections[index]
		if collection.PolicyID != policyID || collection.DueDate >= before ||
			(collection.Status != "DUE" && collection.Status != "RETRY" && collection.Status != "BOUNCED") {
			continue
		}
		collection.Status, collection.UpdatedAt = "SUPERSEDED", now
		if err := overwriteAsset(ctx, "premiumCollection", collection.ID, collection); err != nil {
			return err
		}
	}
	return nil
}

// endPolicyDebits closes every open collection and debit authority of a
// policy that owes nothing more, such as a cancelled or terminated one.
func (c *Contract) endPolicyDebits(ctx contractapi.TransactionContextInterface, policyID, now string) error {
	if err := c.supersedeOpenCollections(ctx, policyID, "9999-12-31", now); err != nil {
		return err
	}
	mandates, err := c.ListBankMandates(ctx)
	if err != nil {
		return err
	}
	for index := range mandates {
		mandate := &mandates[index]
		if mandate.PolicyID != policyID || (mandate.Status != "ACTIVE" && mandate.Status != "PENDING") {
			continue
		}
		mandate.Status, mandate.UpdatedAt = "CANCELLED", now
		if err := overwriteAsset(ctx, "bankMandate", mandate.ID, mandate); err != nil {
			return err
		}
	}
	return nil
}

// ReinstatePolicy is the only way back from a lapse (R5). Cover resumes from
// the reinstatement premium's settlement date; the gap stays uncovered and
// collections for the missed installments are superseded.
func (c *Contract) ReinstatePolicy(ctx contractapi.TransactionContextInterface, id, reasonHash string) (*Policy, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if err := validateHash("reasonHash", reasonHash); err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, id)
	if err != nil {
		return nil, err
	}
	if policy.MedicalRulesVersion == 0 {
		return nil, fmt.Errorf("reinstatement applies to medical policies")
	}
	_, today, err := ledgerToday(ctx)
	if err != nil {
		return nil, err
	}
	if today > policy.EndDate {
		return nil, fmt.Errorf("policy %s ended on %s; buy a new policy", id, policy.EndDate)
	}
	lapsed := policy.Status == "LAPSED"
	if policy.Status == "ACTIVE" || policy.Status == "GRACE" {
		lapsed = validateMedicalPremiumTiming(ctx, policy, policy.NextPremiumDueDate) != nil
	}
	if !lapsed {
		return nil, fmt.Errorf("policy %s is %s and cannot be reinstated", id, policy.Status)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	uncoveredFrom, err := addDays(policy.PaidThroughDate, 1)
	if err != nil {
		return nil, err
	}
	policy.Status = "LAPSED"
	policy.ReinstatedDate = today
	policy.NextPremiumDueDate = today
	policy.UpdatedAt = now
	if err := overwriteAsset(ctx, "policy", id, policy); err != nil {
		return nil, err
	}
	mandates, err := c.ListBankMandates(ctx)
	if err != nil {
		return nil, err
	}
	for index := range mandates {
		mandate := &mandates[index]
		if mandate.PolicyID != id || mandate.Status != "ACTIVE" || mandate.ExpiryDate < today {
			continue
		}
		mandate.NextDebitDate, mandate.UpdatedAt = today, now
		if err := overwriteAsset(ctx, "bankMandate", mandate.ID, mandate); err != nil {
			return nil, err
		}
	}
	if err := c.supersedeOpenCollections(ctx, id, today, now); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyReinstated", map[string]any{
		"policyId": id, "policyholderId": policy.PolicyholderID, "reinstatedDate": today,
		"uncoveredFrom": uncoveredFrom, "reasonHash": strings.ToLower(reasonHash),
	}); err != nil {
		return nil, err
	}
	return policy, nil
}
