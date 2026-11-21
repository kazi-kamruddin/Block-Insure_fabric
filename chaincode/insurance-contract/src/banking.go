package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) RegisterBankAccountReference(ctx contractapi.TransactionContextInterface, id, ownerID, accountTokenHash string) (*BankAccountReference, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("legacy Bank account registration is disabled; use OpenPrivateBankAccount with transient data")
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
	if account.BankID == "" || account.AccountType != "CUSTOMER" {
		return nil, fmt.Errorf("bank account reference is not a Phase 2 customer account")
	}
	if !slices.Contains(policy.BankIDs, account.BankID) {
		return nil, fmt.Errorf("bank %s is not in policy %s's partner network", account.BankID, policyID)
	}
	if _, err := c.requireActivePartner(ctx, "BANK", account.BankID); err != nil {
		return nil, err
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
	if expiryDate < due {
		return nil, fmt.Errorf("mandate expiry cannot precede the next premium due date")
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
	if err := requireNotAfterLedgerDate(ctx, "asOfDate", asOfDate); err != nil {
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

func (c *Contract) RecordPremiumPayment(ctx contractapi.TransactionContextInterface, id, policyID, mandateID, periodStartDate, periodEndDate string, amountMinor int64, externalReferenceHash, method string) (*PremiumPayment, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("direct premium receipt recording is disabled; use ExecuteManualPremiumPayment or ProcessPremiumCollection")
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
	if amountMinor > payment.AmountMinor-adjusted {
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
	if payment.TransferID != "" {
		originalTransfer, err := c.ReadBankTransfer(ctx, payment.TransferID)
		if err != nil {
			return nil, err
		}
		source, err := c.ReadBankAccountReference(ctx, originalTransfer.SourceAccountID)
		if err != nil {
			return nil, err
		}
		destination, err := c.ReadBankAccountReference(ctx, originalTransfer.DestinationAccountID)
		if err != nil {
			return nil, err
		}
		if destination.BalanceMinor < amountMinor {
			return nil, fmt.Errorf("insurer account %s has insufficient funds for reversal", destination.ID)
		}
		transferID := "bank-transfer-reversal-" + id
		transfer := &BankTransfer{
			AssetType: "bankTransfer", SchemaVersion: SchemaVersion, ID: transferID,
			BankID: originalTransfer.BankID, SourceAccountID: destination.ID, DestinationAccountID: source.ID,
			PolicyID: payment.PolicyID, PaymentID: payment.ID, AmountMinor: amountMinor, Currency: "BDT",
			Method: "REVERSAL", Status: "SETTLED", ExternalReferenceHash: strings.ToLower(externalReferenceHash),
			AuthorizationHash: strings.ToLower(reasonHash), CreatedAt: now,
		}
		destination.BalanceMinor -= amountMinor
		source.BalanceMinor += amountMinor
		destination.UpdatedAt = now
		source.UpdatedAt = now
		if err := persistBankAccount(ctx, destination, false); err != nil {
			return nil, err
		}
		if err := persistBankAccount(ctx, source, false); err != nil {
			return nil, err
		}
		if err := putState(ctx, "bankTransfer", transfer.ID, transfer); err != nil {
			return nil, err
		}
		adjustment.TransferID = transfer.ID
		if err := emit(ctx, "BankTransferProcessed", transfer); err != nil {
			return nil, err
		}
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
	if err := requireNotAfterLedgerDate(ctx, "dueDate", dueDate); err != nil {
		return nil, err
	}
	collections, err := c.ListPremiumCollections(ctx)
	if err != nil {
		return nil, err
	}
	for _, existing := range collections {
		if existing.MandateID == mandateID && existing.DueDate == dueDate {
			return nil, fmt.Errorf("premium collection already exists for mandate %s on %s", mandateID, dueDate)
		}
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

func automaticCollectionID(mandateID, dueDate string) string {
	digest := sha256.Sum256([]byte(mandateID + ":" + dueDate))
	return "collection-auto-" + hex.EncodeToString(digest[:12])
}

// SchedulePremiumCollections deterministically materializes every active mandate
// due on or before asOfDate. Existing mandate/date obligations are skipped, so a
// restarted scheduler can safely submit this transaction again.
func (c *Contract) SchedulePremiumCollections(ctx contractapi.TransactionContextInterface, asOfDate string) ([]PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if _, err := validateDate("asOfDate", asOfDate); err != nil {
		return nil, err
	}
	if err := requireNotAfterLedgerDate(ctx, "asOfDate", asOfDate); err != nil {
		return nil, err
	}
	mandates, err := c.ListBankMandates(ctx)
	if err != nil {
		return nil, err
	}
	existingCollections, err := c.ListPremiumCollections(ctx)
	if err != nil {
		return nil, err
	}
	existing := make(map[string]bool, len(existingCollections))
	for _, collection := range existingCollections {
		existing[collection.MandateID+":"+collection.DueDate] = true
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	created := make([]PremiumCollection, 0)
	for _, mandate := range mandates {
		if mandate.Status != "ACTIVE" || mandate.NextDebitDate == "" || mandate.NextDebitDate > asOfDate || mandate.NextDebitDate > mandate.ExpiryDate {
			continue
		}
		key := mandate.ID + ":" + mandate.NextDebitDate
		if existing[key] {
			continue
		}
		collection := PremiumCollection{
			AssetType: "premiumCollection", SchemaVersion: SchemaVersion,
			ID: automaticCollectionID(mandate.ID, mandate.NextDebitDate), PolicyID: mandate.PolicyID,
			MandateID: mandate.ID, DueDate: mandate.NextDebitDate, AmountMinor: mandate.AmountMinor,
			Status: "DUE", CreatedAt: now, UpdatedAt: now,
		}
		if err := putState(ctx, "premiumCollection", collection.ID, &collection); err != nil {
			return nil, err
		}
		existing[key] = true
		created = append(created, collection)
	}
	if err := emit(ctx, "PremiumCollectionsScheduled", map[string]any{
		"asOfDate": asOfDate,
		"count":    len(created),
	}); err != nil {
		return nil, err
	}
	return created, nil
}

const maxPremiumCollectionAttempts = 3

// RetryPremiumCollection lets the Insurer re-present a bounced EFT installment
// after the customer's account is funded. The Bank still derives the outcome
// from the account balance when it processes the retry.
func (c *Contract) RetryPremiumCollection(ctx contractapi.TransactionContextInterface, collectionID string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	collection, err := c.ReadPremiumCollection(ctx, collectionID)
	if err != nil {
		return nil, err
	}
	if collection.Status != "BOUNCED" {
		return nil, fmt.Errorf("premium collection %s must be BOUNCED to retry", collectionID)
	}
	if collection.AttemptCount >= maxPremiumCollectionAttempts {
		return nil, fmt.Errorf("premium collection %s has reached the maximum of %d attempts", collectionID, maxPremiumCollectionAttempts)
	}
	mandate, err := c.ReadBankMandate(ctx, collection.MandateID)
	if err != nil {
		return nil, err
	}
	if mandate.Status != "ACTIVE" || mandate.NextDebitDate != collection.DueDate {
		return nil, fmt.Errorf("mandate %s no longer owes the installment due on %s", mandate.ID, collection.DueDate)
	}
	policy, err := c.ReadPolicy(ctx, collection.PolicyID)
	if err != nil {
		return nil, err
	}
	if policy.Status == "CANCELLED" || policy.Status == "EXPIRED" || policy.Status == "LAPSED" {
		return nil, fmt.Errorf("policy %s cannot retry a premium from %s", policy.ID, policy.Status)
	}
	collection.Status = "RETRY"
	collection.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "premiumCollection", collection.ID, collection); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumCollectionRetryQueued", collection); err != nil {
		return nil, err
	}
	return collection, nil
}

func (c *Contract) CompletePremiumCollection(ctx contractapi.TransactionContextInterface, collectionID, paymentID, periodEndDate, externalReferenceHash string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("manual collection completion is disabled; use ProcessPremiumCollection")
}

func (c *Contract) FailPremiumCollection(ctx contractapi.TransactionContextInterface, collectionID, failureHash string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("manual collection failure is disabled; ProcessPremiumCollection derives the outcome from the account balance")
}

func (c *Contract) ReadBankAccountReference(ctx contractapi.TransactionContextInterface, id string) (*BankAccountReference, error) {
	public, err := getState[BankAccountReference](ctx, "bankAccountReference", id)
	if err != nil {
		return nil, err
	}
	return mergedBankAccount(ctx, public)
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

// Bangladesh has no daylight saving time, so a fixed zone keeps endorsement
// deterministic without depending on the runtime's time zone database.
var dhakaBusinessZone = time.FixedZone("Asia/Dhaka", 6*60*60)

// ledgerBusinessDate is the Dhaka calendar date of the transaction timestamp.
func ledgerBusinessDate(ctx contractapi.TransactionContextInterface) (string, error) {
	now, err := transactionDate(ctx)
	if err != nil {
		return "", err
	}
	return now.In(dhakaBusinessZone).Format(time.DateOnly), nil
}

// requireNotAfterLedgerDate stops a caller from moving premium obligations
// forward in time by supplying a future calendar date.
func requireNotAfterLedgerDate(ctx contractapi.TransactionContextInterface, field, value string) error {
	today, err := ledgerBusinessDate(ctx)
	if err != nil {
		return err
	}
	if value > today {
		return fmt.Errorf("%s %s is later than the ledger business date %s", field, value, today)
	}
	return nil
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
