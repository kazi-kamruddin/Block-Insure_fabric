package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func bankTransferMarkerKey(ctx contractapi.TransactionContextInterface, externalReferenceHash string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("bankTransferExternalReference", []string{strings.ToLower(externalReferenceHash)})
}

func failureDigest(code string) string {
	digest := sha256.Sum256([]byte(code))
	return hex.EncodeToString(digest[:])
}

func (c *Contract) OpenBankAccount(ctx contractapi.TransactionContextInterface, id, bankID, ownerID, accountType, accountLabel, maskedAccount, accountTokenHash string, openingBalanceMinor int64) (*BankAccountReference, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("sensitive Bank account arguments are disabled; use OpenPrivateBankAccount with transient data")
}

func (c *Contract) openBankAccount(ctx contractapi.TransactionContextInterface, id, bankID, ownerID, accountType, accountLabel, maskedAccount, accountTokenHash string, openingBalanceMinor int64) (*BankAccountReference, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if err := c.requireBankSubject(ctx, bankID); err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "BANK", bankID); err != nil {
		return nil, err
	}
	if !idPattern.MatchString(ownerID) {
		return nil, fmt.Errorf("invalid owner id %q", ownerID)
	}
	accountType = strings.ToUpper(strings.TrimSpace(accountType))
	if accountType != "CUSTOMER" && accountType != "INSURER" {
		return nil, fmt.Errorf("accountType must be CUSTOMER or INSURER")
	}
	if openingBalanceMinor < 0 {
		return nil, fmt.Errorf("opening balance cannot be negative")
	}
	accountLabel, maskedAccount, err := normalizeAccountDisplay(accountLabel, maskedAccount)
	if err != nil {
		return nil, err
	}
	if err := validateHash("accountTokenHash", accountTokenHash); err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	account := &BankAccountReference{
		AssetType: "bankAccountReference", SchemaVersion: SchemaVersion, ID: id,
		BankID: bankID, OwnerID: ownerID, AccountType: accountType,
		AccountLabel: accountLabel, MaskedAccount: maskedAccount,
		AccountTokenHash: strings.ToLower(accountTokenHash), Currency: "BDT",
		BalanceMinor: openingBalanceMinor, Status: "VERIFIED", CreatedAt: now, UpdatedAt: now,
	}
	if err := persistBankAccount(ctx, account, true); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankAccountOpened", publicBankAccountEvent(account)); err != nil {
		return nil, err
	}
	return account, nil
}

func normalizeAccountDisplay(accountLabel, maskedAccount string) (string, string, error) {
	accountLabel = strings.TrimSpace(accountLabel)
	maskedAccount = strings.TrimSpace(maskedAccount)
	if accountLabel == "" || len(accountLabel) > 80 {
		return "", "", fmt.Errorf("accountLabel must contain between 1 and 80 characters")
	}
	if len(maskedAccount) < 4 || len(maskedAccount) > 40 || !strings.Contains(maskedAccount, "*") {
		return "", "", fmt.Errorf("maskedAccount must contain a masked display value between 4 and 40 characters")
	}
	return accountLabel, maskedAccount, nil
}

func (c *Contract) AdjustBankAccountBalance(ctx contractapi.TransactionContextInterface, transferID, accountID, direction string, amountMinor int64, externalReferenceHash string) (*BankTransfer, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if amountMinor <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	if err := validateHash("externalReferenceHash", externalReferenceHash); err != nil {
		return nil, err
	}
	direction = strings.ToUpper(strings.TrimSpace(direction))
	if direction != "CREDIT" && direction != "DEBIT" {
		return nil, fmt.Errorf("direction must be CREDIT or DEBIT")
	}
	account, err := c.ReadBankAccountReference(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if account.BankID == "" || account.Status != "VERIFIED" {
		return nil, fmt.Errorf("bank account %s is not a Phase 2 verified account", accountID)
	}
	if err := c.requireBankSubject(ctx, account.BankID); err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "BANK", account.BankID); err != nil {
		return nil, err
	}
	if direction == "DEBIT" && account.BalanceMinor < amountMinor {
		return nil, fmt.Errorf("bank account %s has insufficient funds", accountID)
	}
	markerKey, err := bankTransferMarkerKey(ctx, externalReferenceHash)
	if err != nil {
		return nil, err
	}
	if marker, err := ctx.GetStub().GetState(markerKey); err != nil {
		return nil, fmt.Errorf("check external transfer reference: %w", err)
	} else if marker != nil {
		return nil, fmt.Errorf("external bank transfer reference has already been recorded")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	transfer := &BankTransfer{
		AssetType: "bankTransfer", SchemaVersion: SchemaVersion, ID: transferID,
		BankID: account.BankID, AmountMinor: amountMinor, Currency: "BDT",
		Method: "ADJUSTMENT_" + direction, Status: "SETTLED",
		ExternalReferenceHash: strings.ToLower(externalReferenceHash), CreatedAt: now,
	}
	if direction == "CREDIT" {
		account.BalanceMinor += amountMinor
		transfer.DestinationAccountID = account.ID
	} else {
		account.BalanceMinor -= amountMinor
		transfer.SourceAccountID = account.ID
	}
	account.UpdatedAt = now
	if err := persistBankAccount(ctx, account, false); err != nil {
		return nil, err
	}
	if err := putState(ctx, "bankTransfer", transfer.ID, transfer); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(markerKey, []byte(transfer.ID)); err != nil {
		return nil, fmt.Errorf("reserve external bank transfer reference: %w", err)
	}
	if err := emit(ctx, "BankBalanceAdjusted", transfer); err != nil {
		return nil, err
	}
	return transfer, nil
}

func validatePremiumPeriod(ctx contractapi.TransactionContextInterface, policy *Policy, periodStartDate, periodEndDate string, amountMinor int64) error {
	if policy.Status == "CANCELLED" || policy.Status == "EXPIRED" {
		return fmt.Errorf("policy %s cannot accept a premium from %s", policy.ID, policy.Status)
	}
	if err := validateMedicalPremiumTiming(ctx, policy, periodStartDate); err != nil {
		return err
	}
	start, err := validateDate("periodStartDate", periodStartDate)
	if err != nil {
		return err
	}
	end, err := validateDate("periodEndDate", periodEndDate)
	if err != nil {
		return err
	}
	if end.Before(start) {
		return fmt.Errorf("periodEndDate must not be before periodStartDate")
	}
	expectedStart := policy.NextPremiumDueDate
	if expectedStart == "" {
		expectedStart = policy.StartDate
	}
	if periodStartDate != expectedStart {
		return fmt.Errorf("premium period must start on the next due date %s", expectedStart)
	}
	policyEnd, _ := validateDate("policy.endDate", policy.EndDate)
	if end.After(policyEnd) {
		return fmt.Errorf("premium period cannot exceed policy end date")
	}
	interval := policy.PremiumIntervalDays
	if interval == 0 {
		interval = defaultPremiumIntervalDays
	}
	if end.After(start.AddDate(0, 0, interval-1)) {
		return fmt.Errorf("premium period cannot exceed the policy premium interval")
	}
	if amountMinor != policy.PremiumMinor {
		return fmt.Errorf("premium amount must equal the policy premium")
	}
	return nil
}

func validatePremiumAccounts(ctx contractapi.TransactionContextInterface, c *Contract, policy *Policy, sourceAccountID, destinationAccountID string) (*BankAccountReference, *BankAccountReference, error) {
	source, err := c.ReadBankAccountReference(ctx, sourceAccountID)
	if err != nil {
		return nil, nil, err
	}
	destination, err := c.ReadBankAccountReference(ctx, destinationAccountID)
	if err != nil {
		return nil, nil, err
	}
	if source.Status != "VERIFIED" || destination.Status != "VERIFIED" || source.BankID == "" || source.BankID != destination.BankID {
		return nil, nil, fmt.Errorf("premium accounts must be verified accounts at the same contracted bank")
	}
	if source.AccountType != "CUSTOMER" || destination.AccountType != "INSURER" {
		return nil, nil, fmt.Errorf("premium transfer requires a CUSTOMER source and INSURER destination")
	}
	if destination.OwnerID != "insurer" {
		return nil, nil, fmt.Errorf("premium destination must belong to the insurer")
	}
	if source.OwnerID != policy.PolicyholderID {
		return nil, nil, fmt.Errorf("source bank account is not owned by the policyholder")
	}
	if !slices.Contains(policy.BankIDs, source.BankID) {
		return nil, nil, fmt.Errorf("bank %s is not in policy %s's partner network", source.BankID, policy.ID)
	}
	if _, err := c.requireActivePartner(ctx, "BANK", source.BankID); err != nil {
		return nil, nil, err
	}
	return source, destination, nil
}

func (c *Contract) writePremiumTransfer(ctx contractapi.TransactionContextInterface, transfer *BankTransfer, policy *Policy, mandate *BankMandate, periodStartDate, periodEndDate string, amountMinor int64) (*PremiumPayment, error) {
	if err := validatePremiumPeriod(ctx, policy, periodStartDate, periodEndDate, amountMinor); err != nil {
		return nil, err
	}
	paymentMarker, err := paymentMarkerKey(ctx, transfer.ExternalReferenceHash)
	if err != nil {
		return nil, err
	}
	if marker, err := ctx.GetStub().GetState(paymentMarker); err != nil {
		return nil, fmt.Errorf("check external payment reference: %w", err)
	} else if marker != nil {
		return nil, fmt.Errorf("external payment reference has already been recorded")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	payment := &PremiumPayment{
		AssetType: "premiumPayment", SchemaVersion: SchemaVersion, ID: transfer.PaymentID,
		PolicyID: policy.ID, TransferID: transfer.ID, SourceAccountID: transfer.SourceAccountID,
		DestinationAccountID: transfer.DestinationAccountID, PeriodStartDate: periodStartDate,
		PeriodEndDate: periodEndDate, AmountMinor: amountMinor,
		ExternalReferenceHash: transfer.ExternalReferenceHash, Method: transfer.Method, RecordedAt: now,
	}
	if mandate != nil {
		payment.MandateID = mandate.ID
	}
	if err := putState(ctx, "premiumPayment", payment.ID, payment); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(paymentMarker, []byte(payment.ID)); err != nil {
		return nil, fmt.Errorf("reserve external payment reference: %w", err)
	}
	end, _ := validateDate("periodEndDate", periodEndDate)
	if policy.Status == "PENDING_PAYMENT" && policy.MedicalRulesVersion != 0 {
		// No premium, no cover: risk begins when the first premium settles.
		_, today, err := ledgerToday(ctx)
		if err != nil {
			return nil, err
		}
		policy.CoverStartDate = max(policy.StartDate, today)
	}
	policy.Status = "ACTIVE"
	policy.PaidThroughDate = periodEndDate
	policy.NextPremiumDueDate = end.AddDate(0, 0, 1).Format("2006-01-02")
	policy.UpdatedAt = now
	if err := overwriteAsset(ctx, "policy", policy.ID, policy); err != nil {
		return nil, err
	}
	if mandate != nil {
		mandate.NextDebitDate = policy.NextPremiumDueDate
		mandate.UpdatedAt = now
		if err := overwriteAsset(ctx, "bankMandate", mandate.ID, mandate); err != nil {
			return nil, err
		}
	} else {
		mandates, err := c.ListBankMandates(ctx)
		if err != nil {
			return nil, err
		}
		for index := range mandates {
			if mandates[index].PolicyID != policy.ID || mandates[index].Status != "ACTIVE" {
				continue
			}
			mandates[index].NextDebitDate = policy.NextPremiumDueDate
			mandates[index].UpdatedAt = now
			if err := overwriteAsset(ctx, "bankMandate", mandates[index].ID, &mandates[index]); err != nil {
				return nil, err
			}
		}
	}
	if err := emit(ctx, "PremiumPaymentRecorded", payment); err != nil {
		return nil, err
	}
	return payment, nil
}

func (c *Contract) settlePremiumTransfer(ctx contractapi.TransactionContextInterface, transfer *BankTransfer, source, destination *BankAccountReference) error {
	markerKey, err := bankTransferMarkerKey(ctx, transfer.ExternalReferenceHash)
	if err != nil {
		return err
	}
	if marker, err := ctx.GetStub().GetState(markerKey); err != nil {
		return fmt.Errorf("check external bank transfer reference: %w", err)
	} else if marker != nil {
		return fmt.Errorf("external bank transfer reference has already been recorded")
	}
	if source.BalanceMinor < transfer.AmountMinor {
		transfer.Status = "BOUNCED"
		transfer.FailureCode = "INSUFFICIENT_FUNDS"
	} else {
		transfer.Status = "SETTLED"
		source.BalanceMinor -= transfer.AmountMinor
		destination.BalanceMinor += transfer.AmountMinor
		source.UpdatedAt = transfer.CreatedAt
		destination.UpdatedAt = transfer.CreatedAt
		if err := persistBankAccount(ctx, source, false); err != nil {
			return err
		}
		if err := persistBankAccount(ctx, destination, false); err != nil {
			return err
		}
	}
	if err := putState(ctx, "bankTransfer", transfer.ID, transfer); err != nil {
		return err
	}
	if err := ctx.GetStub().PutState(markerKey, []byte(transfer.ID)); err != nil {
		return fmt.Errorf("reserve external bank transfer reference: %w", err)
	}
	return emit(ctx, "BankTransferProcessed", transfer)
}

func (c *Contract) ExecuteManualPremiumPayment(ctx contractapi.TransactionContextInterface, transferID, paymentID, policyID, sourceAccountID, destinationAccountID, periodStartDate, periodEndDate string, amountMinor int64, externalReferenceHash, authorizationHash string) (*BankTransfer, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if err := validateHash("externalReferenceHash", externalReferenceHash); err != nil {
		return nil, err
	}
	if err := validateHash("authorizationHash", authorizationHash); err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if err := validatePremiumPeriod(ctx, policy, periodStartDate, periodEndDate, amountMinor); err != nil {
		return nil, err
	}
	source, destination, err := validatePremiumAccounts(ctx, c, policy, sourceAccountID, destinationAccountID)
	if err != nil {
		return nil, err
	}
	if err := c.requireBankSubject(ctx, source.BankID); err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	transfer := &BankTransfer{
		AssetType: "bankTransfer", SchemaVersion: SchemaVersion, ID: transferID, BankID: source.BankID,
		SourceAccountID: source.ID, DestinationAccountID: destination.ID, PolicyID: policy.ID,
		PaymentID: paymentID, AmountMinor: amountMinor, Currency: "BDT", Method: "OTP",
		ExternalReferenceHash: strings.ToLower(externalReferenceHash), AuthorizationHash: strings.ToLower(authorizationHash), CreatedAt: now,
	}
	if err := c.settlePremiumTransfer(ctx, transfer, source, destination); err != nil {
		return nil, err
	}
	if transfer.Status == "SETTLED" {
		if _, err := c.writePremiumTransfer(ctx, transfer, policy, nil, periodStartDate, periodEndDate, amountMinor); err != nil {
			return nil, err
		}
	}
	return transfer, nil
}

// A queued collection represents an installment, not an entitlement to debit
// again after another payment method has collected that exact installment.
func (c *Contract) reconcileCollectedPremium(ctx contractapi.TransactionContextInterface, collection *PremiumCollection, policy *Policy, destinationAccountID, periodEndDate string) (*PremiumCollection, error) {
	if _, err := validateDate("periodEndDate", periodEndDate); err != nil {
		return nil, err
	}
	if collection.DueDate >= policy.NextPremiumDueDate || periodEndDate > policy.PaidThroughDate {
		return nil, nil
	}
	payments, err := c.ListPremiumPayments(ctx)
	if err != nil {
		return nil, err
	}
	var matched *PremiumPayment
	for index := range payments {
		payment := &payments[index]
		if payment.PolicyID != policy.ID || payment.PeriodStartDate != collection.DueDate || payment.PeriodEndDate != periodEndDate ||
			payment.AmountMinor != collection.AmountMinor || payment.DestinationAccountID != destinationAccountID || payment.TransferID == "" {
			continue
		}
		if matched != nil {
			return nil, fmt.Errorf("queued installment has ambiguous committed premium payments")
		}
		transfer, err := c.ReadBankTransfer(ctx, payment.TransferID)
		if err != nil {
			return nil, err
		}
		if transfer.Status != "SETTLED" || (transfer.Method != "OTP" && transfer.Method != "EFT") || transfer.Method != payment.Method ||
			transfer.PolicyID != payment.PolicyID || transfer.PaymentID != payment.ID || transfer.AmountMinor != payment.AmountMinor ||
			transfer.SourceAccountID != payment.SourceAccountID || transfer.DestinationAccountID != payment.DestinationAccountID ||
			transfer.ExternalReferenceHash != payment.ExternalReferenceHash {
			return nil, fmt.Errorf("queued installment payment has inconsistent settled transfer linkage")
		}
		matched = payment
	}
	if matched == nil {
		return nil, nil
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	collection.Status = "COMPLETED"
	collection.PaymentID = matched.ID
	collection.TransferID = matched.TransferID
	collection.FailureCode = ""
	collection.FailureHash = ""
	collection.UpdatedAt = now
	// Preserve AttemptCount: recognizing an earlier payment is not a debit attempt.
	if err := overwriteAsset(ctx, "premiumCollection", collection.ID, collection); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumCollectionReconciled", collection); err != nil {
		return nil, err
	}
	return collection, nil
}

func (c *Contract) ProcessPremiumCollection(ctx contractapi.TransactionContextInterface, collectionID, paymentID, transferID, destinationAccountID, periodEndDate, externalReferenceHash string) (*PremiumCollection, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if err := validateHash("externalReferenceHash", externalReferenceHash); err != nil {
		return nil, err
	}
	collection, err := c.ReadPremiumCollection(ctx, collectionID)
	if err != nil {
		return nil, err
	}
	if collection.Status != "DUE" && collection.Status != "RETRY" {
		return nil, fmt.Errorf("premium collection %s is not due", collectionID)
	}
	if err := requireNotAfterLedgerDate(ctx, "collection due date", collection.DueDate); err != nil {
		return nil, err
	}
	mandate, err := c.ReadBankMandate(ctx, collection.MandateID)
	if err != nil {
		return nil, err
	}
	if mandate.Status != "ACTIVE" || mandate.PolicyID != collection.PolicyID || mandate.AmountMinor != collection.AmountMinor {
		return nil, fmt.Errorf("mandate %s is not active for collection %s", mandate.ID, collection.ID)
	}
	if err := c.requireBankAccountSubject(ctx, mandate.AccountReferenceID); err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, collection.PolicyID)
	if err != nil {
		return nil, err
	}
	if reconciled, err := c.reconcileCollectedPremium(ctx, collection, policy, destinationAccountID, periodEndDate); err != nil || reconciled != nil {
		return reconciled, err
	}
	if err := validatePremiumPeriod(ctx, policy, collection.DueDate, periodEndDate, collection.AmountMinor); err != nil {
		return nil, err
	}
	if collection.DueDate > mandate.ExpiryDate || periodEndDate > mandate.ExpiryDate {
		return nil, fmt.Errorf("premium period cannot exceed mandate expiry")
	}
	source, destination, err := validatePremiumAccounts(ctx, c, policy, mandate.AccountReferenceID, destinationAccountID)
	if err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	transfer := &BankTransfer{
		AssetType: "bankTransfer", SchemaVersion: SchemaVersion, ID: transferID, BankID: source.BankID,
		SourceAccountID: source.ID, DestinationAccountID: destination.ID, PolicyID: policy.ID,
		MandateID: mandate.ID, CollectionID: collection.ID, PaymentID: paymentID,
		AmountMinor: collection.AmountMinor, Currency: "BDT", Method: "EFT",
		ExternalReferenceHash: strings.ToLower(externalReferenceHash), CreatedAt: now,
	}
	if err := c.settlePremiumTransfer(ctx, transfer, source, destination); err != nil {
		return nil, err
	}
	collection.AttemptCount++
	collection.TransferID = transfer.ID
	collection.UpdatedAt = now
	if transfer.Status == "BOUNCED" {
		collection.Status = "BOUNCED"
		collection.FailureCode = transfer.FailureCode
		collection.FailureHash = failureDigest(transfer.FailureCode)
	} else {
		if _, err := c.writePremiumTransfer(ctx, transfer, policy, mandate, collection.DueDate, periodEndDate, collection.AmountMinor); err != nil {
			return nil, err
		}
		collection.Status = "COMPLETED"
		collection.PaymentID = paymentID
	}
	if err := overwriteAsset(ctx, "premiumCollection", collection.ID, collection); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PremiumCollectionProcessed", collection); err != nil {
		return nil, err
	}
	return collection, nil
}

func (c *Contract) ReadBankTransfer(ctx contractapi.TransactionContextInterface, id string) (*BankTransfer, error) {
	return getState[BankTransfer](ctx, "bankTransfer", id)
}
