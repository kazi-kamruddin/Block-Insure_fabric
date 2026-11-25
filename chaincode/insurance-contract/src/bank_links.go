package insurance

import (
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// BankAccountLinkRequest records a policyholder asking a contracted Bank to
// link one of the customer's accounts to the insurance platform. It holds only
// display values. On approval the Bank supplies the account token and balance
// as transient data, and they stay in bankInsurerPrivateData.
type BankAccountLinkRequest struct {
	AssetType          string `json:"assetType"`
	SchemaVersion      int    `json:"schemaVersion"`
	ID                 string `json:"id"`
	BankID             string `json:"bankId"`
	OwnerID            string `json:"ownerId"`
	AccountLabel       string `json:"accountLabel"`
	MaskedAccount      string `json:"maskedAccount"`
	Status             string `json:"status"`
	AccountReferenceID string `json:"accountReferenceId"`
	DecisionHash       string `json:"decisionHash"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

func (c *Contract) RequestBankAccountLink(ctx contractapi.TransactionContextInterface, id, bankID, accountLabel, maskedAccount string) (*BankAccountLinkRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "BANK", bankID); err != nil {
		return nil, err
	}
	accountLabel, maskedAccount, err = normalizeAccountDisplay(accountLabel, maskedAccount)
	if err != nil {
		return nil, err
	}
	existing, err := listState[BankAccountLinkRequest](ctx, "bankAccountLink")
	if err != nil {
		return nil, err
	}
	for _, request := range existing {
		if request.Status == "PENDING" && request.OwnerID == ownerID && request.BankID == bankID && request.MaskedAccount == maskedAccount {
			return nil, fmt.Errorf("a link request for %s at %s is already pending", maskedAccount, bankID)
		}
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	request := &BankAccountLinkRequest{
		AssetType: "bankAccountLink", SchemaVersion: SchemaVersion, ID: id,
		BankID: bankID, OwnerID: ownerID, AccountLabel: accountLabel, MaskedAccount: maskedAccount,
		Status: "PENDING", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "bankAccountLink", id, request); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankAccountLinkRequested", request); err != nil {
		return nil, err
	}
	return request, nil
}

// ReviewBankAccountLink approves or rejects a pending link. Approval opens the
// verified CUSTOMER account for the requester; the requester cannot choose its
// owner, bank, token or balance.
func (c *Contract) ReviewBankAccountLink(ctx contractapi.TransactionContextInterface, id, outcome, accountReferenceID, decisionHash string) (*BankAccountLinkRequest, error) {
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
	request, err := getState[BankAccountLinkRequest](ctx, "bankAccountLink", id)
	if err != nil {
		return nil, err
	}
	if request.Status != "PENDING" {
		return nil, fmt.Errorf("bank account link %s must be PENDING for review", id)
	}
	if err := c.requireBankSubject(ctx, request.BankID); err != nil {
		return nil, err
	}
	if outcome == "APPROVE" {
		input, err := parsePrivateOpeningInput(ctx)
		if err != nil {
			return nil, err
		}
		account, err := c.openBankAccount(ctx, accountReferenceID, request.BankID, request.OwnerID, "CUSTOMER",
			request.AccountLabel, request.MaskedAccount, input.AccountTokenHash, input.OpeningBalanceMinor)
		if err != nil {
			return nil, err
		}
		request.Status = "LINKED"
		request.AccountReferenceID = account.ID
	} else {
		if accountReferenceID != "" {
			return nil, fmt.Errorf("a rejected link cannot name an account")
		}
		request.Status = "REJECTED"
	}
	request.DecisionHash = strings.ToLower(decisionHash)
	request.UpdatedAt, err = ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "bankAccountLink", id, request); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankAccountLinkReviewed", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) CancelBankAccountLink(ctx contractapi.TransactionContextInterface, id string) (*BankAccountLinkRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	request, err := getState[BankAccountLinkRequest](ctx, "bankAccountLink", id)
	if err != nil {
		return nil, err
	}
	if request.OwnerID != ownerID {
		return nil, fmt.Errorf("access denied: link request %s belongs to another policyholder", id)
	}
	if request.Status != "PENDING" {
		return nil, fmt.Errorf("bank account link %s cannot be cancelled from %s", id, request.Status)
	}
	request.Status = "CANCELLED"
	request.UpdatedAt, err = ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "bankAccountLink", id, request); err != nil {
		return nil, err
	}
	if err := emit(ctx, "BankAccountLinkCancelled", request); err != nil {
		return nil, err
	}
	return request, nil
}

func authorizeBankLinkRead(ctx contractapi.TransactionContextInterface, request *BankAccountLinkRequest) (bool, error) {
	_, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return false, err
	}
	if (mspID == "BankMSP" && role == "bankOfficer") || (mspID == "InsurerMSP" && role == "insurerAdmin") {
		return true, nil
	}
	if mspID == "InsurerMSP" && role == "policyholder" {
		subject, err := callerSubject(ctx)
		if err != nil {
			return false, err
		}
		return subject == request.OwnerID, nil
	}
	return false, nil
}

func (c *Contract) ReadBankAccountLink(ctx contractapi.TransactionContextInterface, id string) (*BankAccountLinkRequest, error) {
	request, err := getState[BankAccountLinkRequest](ctx, "bankAccountLink", id)
	if err != nil {
		return nil, err
	}
	allowed, err := authorizeBankLinkRead(ctx, request)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, fmt.Errorf("access denied: bank account link %s is visible only to the Bank, the Insurer and its requester", id)
	}
	return request, nil
}

func (c *Contract) ListBankAccountLinks(ctx contractapi.TransactionContextInterface) ([]BankAccountLinkRequest, error) {
	requests, err := listState[BankAccountLinkRequest](ctx, "bankAccountLink")
	if err != nil {
		return nil, err
	}
	visible := make([]BankAccountLinkRequest, 0, len(requests))
	for index := range requests {
		allowed, err := authorizeBankLinkRead(ctx, &requests[index])
		if err != nil {
			return nil, err
		}
		if allowed {
			visible = append(visible, requests[index])
		}
	}
	return visible, nil
}
