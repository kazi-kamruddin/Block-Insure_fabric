package insurance

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) RegisterBankAccountReference(ctx contractapi.TransactionContextInterface, id, ownerID, accountTokenHash string) (*BankAccountReference, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if !idPattern.MatchString(ownerID) {
		return nil, fmt.Errorf("invalid owner id %q", ownerID)
	}
	if err := validateHash("accountTokenHash", accountTokenHash); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	account := &BankAccountReference{
		AssetType: "bankAccountReference", SchemaVersion: SchemaVersion, ID: id,
		OwnerID: ownerID, AccountTokenHash: strings.ToLower(accountTokenHash), Status: "VERIFIED",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "bankAccountReference", id, account); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankAccountReferenceRegistered", account); err != nil {
		return nil, err
	}
	return account, nil
}

func (c *Contract) RequestBankMandate(ctx contractapi.TransactionContextInterface, id, policyID, accountReferenceID, expiryDate string) (*BankMandate, error) {
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
	if policy.Status == "CANCELLED" || policy.Status == "EXPIRED" {
		return nil, fmt.Errorf("policy %s cannot accept a mandate from %s", policyID, policy.Status)
	}
	account, err := c.ReadBankAccountReference(ctx, accountReferenceID)
	if err != nil {
		return nil, err
	}
	if account.OwnerID != ownerID || account.Status != "VERIFIED" {
		return nil, fmt.Errorf("bank account reference is not verified for this policyholder")
	}
	expiry, err := validateDate("expiryDate", expiryDate)
	if err != nil {
		return nil, err
	}
	policyEnd, _ := validateDate("policy.endDate", policy.EndDate)
	if expiry.After(policyEnd) {
		return nil, fmt.Errorf("mandate expiry cannot exceed the policy end date")
	}
	due := policy.NextPremiumDueDate
	if due == "" {
		due = policy.StartDate
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	interval := policy.PremiumIntervalDays
	if interval == 0 {
		interval = defaultPremiumIntervalDays
	}
	mandate := &BankMandate{
		AssetType: "bankMandate", SchemaVersion: SchemaVersion, ID: id,
		PolicyID: policyID, AccountReferenceID: accountReferenceID, OwnerID: ownerID,
		AmountMinor: policy.PremiumMinor, IntervalDays: interval, NextDebitDate: due,
		ExpiryDate: expiryDate, Status: "PENDING", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "bankMandate", id, mandate); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankMandateRequested", mandate); err != nil {
		return nil, err
	}
	return mandate, nil
}

func (c *Contract) ReviewBankMandate(ctx contractapi.TransactionContextInterface, id, outcome, decisionHash string) (*BankMandate, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	if outcome != "APPROVE" && outcome != "REJECT" {
		return nil, fmt.Errorf("outcome must be APPROVE or REJECT")
	}
	if err := validateHash("decisionHash", decisionHash); err != nil {
		return nil, err
	}
	mandate, err := c.ReadBankMandate(ctx, id)
	if err != nil {
		return nil, err
	}
	if mandate.Status != "PENDING" {
		return nil, fmt.Errorf("bank mandate %s must be PENDING for review", id)
	}
	if outcome == "APPROVE" {
		mandate.Status = "ACTIVE"
	} else {
		mandate.Status = "REJECTED"
	}
	mandate.DecisionHash = strings.ToLower(decisionHash)
	mandate.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "bankMandate", id, mandate); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankMandateReviewed", mandate); err != nil {
		return nil, err
	}
	return mandate, nil
}

func (c *Contract) CancelBankMandate(ctx contractapi.TransactionContextInterface, id string) (*BankMandate, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	mandate, err := c.ReadBankMandate(ctx, id)
	if err != nil {
		return nil, err
	}
	if mandate.OwnerID != ownerID {
		return nil, fmt.Errorf("access denied: mandate %s belongs to another policyholder", id)
	}
	if mandate.Status != "PENDING" && mandate.Status != "ACTIVE" {
		return nil, fmt.Errorf("bank mandate %s cannot be cancelled from %s", id, mandate.Status)
	}
	mandate.Status = "CANCELLED"
	mandate.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "bankMandate", id, mandate); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankMandateCancelled", mandate); err != nil {
		return nil, err
	}
	return mandate, nil
}

func (c *Contract) ExpireBankMandate(ctx contractapi.TransactionContextInterface, id, asOfDate string) (*BankMandate, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	asOf, err := validateDate("asOfDate", asOfDate)
	if err != nil {
		return nil, err
	}
	mandate, err := c.ReadBankMandate(ctx, id)
	if err != nil {
		return nil, err
	}
	expiry, _ := validateDate("expiryDate", mandate.ExpiryDate)
	if !asOf.After(expiry) || mandate.Status != "ACTIVE" {
		return nil, fmt.Errorf("bank mandate %s is not eligible for expiry", id)
	}
	mandate.Status = "EXPIRED"
	mandate.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "bankMandate", id, mandate); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankMandateExpired", mandate); err != nil {
		return nil, err
	}
	return mandate, nil
}

func paymentMarkerKey(ctx contractapi.TransactionContextInterface, externalReferenceHash string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("premiumPaymentExternalReference", []string{strings.ToLower(externalReferenceHash)})
}

func (c *Contract) recordPremiumPayment(ctx contractapi.TransactionContextInterface, id, policyID, mandateID, periodStartDate, periodEndDate string, amountMinor int64, externalReferenceHash, method string) (*PremiumPayment, error) {
	if err := validateHash("externalReferenceHash", externalReferenceHash); err != nil {
		return nil, err
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	if method != "OTP" && method != "AUTODEBIT" {
		return nil, fmt.Errorf("method must be OTP or AUTODEBIT")
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if policy.Status == "CANCELLED" || policy.Status == "EXPIRED" {
		return nil, fmt.Errorf("policy %s cannot accept a premium from %s", policyID, policy.Status)
	}
	mandate, err := c.ReadBankMandate(ctx, mandateID)
	if err != nil {
		return nil, err
	}
	if mandate.Status != "ACTIVE" || mandate.PolicyID != policyID {
		return nil, fmt.Errorf("bank mandate %s is not active for policy %s", mandateID, policyID)
	}
	start, err := validateDate("periodStartDate", periodStartDate)
	if err != nil {
		return nil, err
	}
	end, err := validateDate("periodEndDate", periodEndDate)
	if err != nil {
		return nil, err
	}
	if end.Before(start) {
		return nil, fmt.Errorf("periodEndDate must not be before periodStartDate")
	}
	expectedStart := policy.NextPremiumDueDate
	if expectedStart == "" {
		expectedStart = policy.StartDate
	}
	if periodStartDate != expectedStart {
		return nil, fmt.Errorf("premium period must start on the next due date %s", expectedStart)
	}
	policyEnd, _ := validateDate("policy.endDate", policy.EndDate)
	if end.After(policyEnd) {
		return nil, fmt.Errorf("premium period cannot exceed policy end date")
	}
	mandateExpiry, _ := validateDate("mandate.expiryDate", mandate.ExpiryDate)
	if end.After(mandateExpiry) {
		return nil, fmt.Errorf("premium period cannot exceed mandate expiry")
	}
	if amountMinor != policy.PremiumMinor || amountMinor != mandate.AmountMinor {
		return nil, fmt.Errorf("premium amount must equal the policy and mandate amount")
	}

	paymentKey, err := stateKey(ctx, "premiumPayment", id)
	if err != nil {
		return nil, err
	}
	existingPayload, err := ctx.GetStub().GetState(paymentKey)
	if err != nil {
		return nil, fmt.Errorf("check premium payment: %w", err)
	}
	if existingPayload != nil {
		var existing PremiumPayment
		if err := json.Unmarshal(existingPayload, &existing); err != nil {
			return nil, fmt.Errorf("decode premium payment: %w", err)
		}
		if existing.PolicyID == policyID && existing.MandateID == mandateID &&
			existing.PeriodStartDate == periodStartDate && existing.PeriodEndDate == periodEndDate &&
			existing.AmountMinor == amountMinor && existing.Method == method &&
			existing.ExternalReferenceHash == strings.ToLower(externalReferenceHash) {
			return &existing, nil
		}
		return nil, fmt.Errorf("premium payment %s already exists with different details", id)
	}
	markerKey, err := paymentMarkerKey(ctx, externalReferenceHash)
	if err != nil {
		return nil, err
	}
	if marker, err := ctx.GetStub().GetState(markerKey); err != nil {
		return nil, fmt.Errorf("check external payment reference: %w", err)
	} else if marker != nil {
		return nil, fmt.Errorf("external payment reference has already been recorded")
	}

	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	payment := &PremiumPayment{
		AssetType: "premiumPayment", SchemaVersion: SchemaVersion, ID: id,
		PolicyID: policyID, MandateID: mandateID, PeriodStartDate: periodStartDate,
		PeriodEndDate: periodEndDate, AmountMinor: amountMinor,
		ExternalReferenceHash: strings.ToLower(externalReferenceHash), Method: method, RecordedAt: now,
	}
	if err := putState(ctx, "premiumPayment", id, payment); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(markerKey, []byte(id)); err != nil {
		return nil, fmt.Errorf("reserve external payment reference: %w", err)
	}
	policy.Status = "ACTIVE"
	policy.PaidThroughDate = periodEndDate
	policy.NextPremiumDueDate = end.AddDate(0, 0, 1).Format("2006-01-02")
	policy.UpdatedAt = now
	if err := overwriteAsset(ctx, "policy", policyID, policy); err != nil {
		return nil, err
	}
	mandate.NextDebitDate = policy.NextPremiumDueDate
	mandate.UpdatedAt = now
	if err := overwriteAsset(ctx, "bankMandate", mandateID, mandate); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumPaymentRecorded", payment); err != nil {
		return nil, err
	}
	return payment, nil
}

func (c *Contract) RecordPremiumPayment(ctx contractapi.TransactionContextInterface, id, policyID, mandateID, periodStartDate, periodEndDate string, amountMinor int64, externalReferenceHash, method string) (*PremiumPayment, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	return c.recordPremiumPayment(ctx, id, policyID, mandateID, periodStartDate, periodEndDate, amountMinor, externalReferenceHash, method)
}

func (c *Contract) RecordPremiumAdjustment(ctx contractapi.TransactionContextInterface, id, paymentID string, amountMinor int64, externalReferenceHash, reasonHash string) (*PremiumAdjustment, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if amountMinor <= 0 {
		return nil, fmt.Errorf("adjustment amount must be positive")
	}
	if err := validateHash("externalReferenceHash", externalReferenceHash); err != nil {
		return nil, err
	}
	if err := validateHash("reasonHash", reasonHash); err != nil {
		return nil, err
	}
	payment, err := c.ReadPremiumPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}
	adjustments, err := c.ListPremiumAdjustments(ctx)
	if err != nil {
		return nil, err
	}
	var adjusted int64
	for _, adjustment := range adjustments {
		if adjustment.PaymentID == paymentID {
			adjusted += adjustment.AmountMinor
		}
	}
	if adjusted+amountMinor > payment.AmountMinor {
		return nil, fmt.Errorf("adjustments cannot exceed the original premium payment")
	}
	markerKey, err := paymentMarkerKey(ctx, externalReferenceHash)
	if err != nil {
		return nil, err
	}
	if marker, err := ctx.GetStub().GetState(markerKey); err != nil {
		return nil, fmt.Errorf("check external adjustment reference: %w", err)
	} else if marker != nil {
		return nil, fmt.Errorf("external payment reference has already been recorded")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	adjustment := &PremiumAdjustment{
		AssetType: "premiumAdjustment", SchemaVersion: SchemaVersion, ID: id,
		PaymentID: paymentID, PolicyID: payment.PolicyID, AmountMinor: amountMinor,
		ExternalReferenceHash: strings.ToLower(externalReferenceHash), ReasonHash: strings.ToLower(reasonHash),
		Type: "REVERSAL", RecordedAt: now,
	}
	if err := putState(ctx, "premiumAdjustment", id, adjustment); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(markerKey, []byte(id)); err != nil {
		return nil, fmt.Errorf("reserve external adjustment reference: %w", err)
	}
	if err := emit(ctx, "PremiumAdjustmentRecorded", adjustment); err != nil {
		return nil, err
	}
	return adjustment, nil
}

func (c *Contract) QueuePremiumCollection(ctx contractapi.TransactionContextInterface, id, mandateID, dueDate string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	mandate, err := c.ReadBankMandate(ctx, mandateID)
	if err != nil {
		return nil, err
	}
	if mandate.Status != "ACTIVE" || mandate.NextDebitDate != dueDate {
		return nil, fmt.Errorf("mandate %s is not active and due on %s", mandateID, dueDate)
	}
	if _, err := validateDate("dueDate", dueDate); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	collection := &PremiumCollection{
		AssetType: "premiumCollection", SchemaVersion: SchemaVersion, ID: id,
		PolicyID: mandate.PolicyID, MandateID: mandateID, DueDate: dueDate,
		AmountMinor: mandate.AmountMinor, Status: "DUE", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "premiumCollection", id, collection); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumCollectionQueued", collection); err != nil {
		return nil, err
	}
	return collection, nil
}

func (c *Contract) CompletePremiumCollection(ctx contractapi.TransactionContextInterface, collectionID, paymentID, periodEndDate, externalReferenceHash string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	collection, err := c.ReadPremiumCollection(ctx, collectionID)
	if err != nil {
		return nil, err
	}
	if collection.Status != "DUE" && collection.Status != "RETRY" {
		return nil, fmt.Errorf("premium collection %s is not due", collectionID)
	}
	if _, err := c.recordPremiumPayment(ctx, paymentID, collection.PolicyID, collection.MandateID, collection.DueDate, periodEndDate, collection.AmountMinor, externalReferenceHash, "AUTODEBIT"); err != nil {
		return nil, err
	}
	collection.Status = "COMPLETED"
	collection.PaymentID = paymentID
	collection.AttemptCount++
	collection.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "premiumCollection", collectionID, collection); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumCollectionCompleted", collection); err != nil {
		return nil, err
	}
	return collection, nil
}

func (c *Contract) FailPremiumCollection(ctx contractapi.TransactionContextInterface, collectionID, failureHash string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if err := validateHash("failureHash", failureHash); err != nil {
		return nil, err
	}
	collection, err := c.ReadPremiumCollection(ctx, collectionID)
	if err != nil {
		return nil, err
	}
	if collection.Status != "DUE" && collection.Status != "RETRY" {
		return nil, fmt.Errorf("premium collection %s is not due", collectionID)
	}
	collection.AttemptCount++
	collection.FailureHash = strings.ToLower(failureHash)
	if collection.AttemptCount >= 3 {
		collection.Status = "FAILED"
	} else {
		collection.Status = "RETRY"
	}
	collection.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "premiumCollection", collectionID, collection); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumCollectionFailed", collection); err != nil {
		return nil, err
	}
	return collection, nil
}

func (c *Contract) ReadBankAccountReference(ctx contractapi.TransactionContextInterface, id string) (*BankAccountReference, error) {
	return getState[BankAccountReference](ctx, "bankAccountReference", id)
}

func (c *Contract) ReadBankMandate(ctx contractapi.TransactionContextInterface, id string) (*BankMandate, error) {
	return getState[BankMandate](ctx, "bankMandate", id)
}

func (c *Contract) ReadPremiumPayment(ctx contractapi.TransactionContextInterface, id string) (*PremiumPayment, error) {
	return getState[PremiumPayment](ctx, "premiumPayment", id)
}

func (c *Contract) ReadPremiumCollection(ctx contractapi.TransactionContextInterface, id string) (*PremiumCollection, error) {
	return getState[PremiumCollection](ctx, "premiumCollection", id)
}

func (c *Contract) ReadPremiumAdjustment(ctx contractapi.TransactionContextInterface, id string) (*PremiumAdjustment, error) {
	return getState[PremiumAdjustment](ctx, "premiumAdjustment", id)
}

func transactionDate(ctx contractapi.TransactionContextInterface) (time.Time, error) {
	value, err := timestamp(ctx)
	if err != nil {
		return time.Time{}, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse transaction date: %w", err)
	}
	return parsed, nil
}
