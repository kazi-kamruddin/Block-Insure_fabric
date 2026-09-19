package insurance

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const bankInsurerPrivateCollection = "bankInsurerPrivateData"
const bankAccountTransientKey = "bankAccountPrivate"

type bankAccountOpeningPrivateInput struct {
	AccountTokenHash    string `json:"accountTokenHash"`
	OpeningBalanceMinor int64  `json:"openingBalanceMinor"`
}

func privateBankAccountKey(ctx contractapi.TransactionContextInterface, id string) (string, error) {
	return stateKey(ctx, "bankAccountPrivate", id)
}

func readBankAccountPrivateState(ctx contractapi.TransactionContextInterface, public *BankAccountReference) (*BankAccountPrivateState, error) {
	key, err := privateBankAccountKey(ctx, public.ID)
	if err != nil {
		return nil, err
	}
	payload, err := ctx.GetStub().GetPrivateData(bankInsurerPrivateCollection, key)
	if err != nil {
		return nil, fmt.Errorf("read private Bank account %s: %w", public.ID, err)
	}
	if payload == nil {
		// Schema 10 compatibility: a retained development ledger may still have
		// balance/token fields in public state. The next Bank write migrates it.
		if public.AccountTokenHash != "" {
			return &BankAccountPrivateState{
				AssetType: "bankAccountPrivateState", SchemaVersion: SchemaVersion, ID: public.ID,
				AccountTokenHash: public.AccountTokenHash, BalanceMinor: public.BalanceMinor, UpdatedAt: public.UpdatedAt,
			}, nil
		}
		return nil, fmt.Errorf("private Bank account state %s does not exist", public.ID)
	}
	var private BankAccountPrivateState
	if err := json.Unmarshal(payload, &private); err != nil {
		return nil, fmt.Errorf("decode private Bank account %s: %w", public.ID, err)
	}
	return &private, nil
}

func authorizeBankAccountRead(ctx contractapi.TransactionContextInterface, account *BankAccountReference) error {
	_, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return err
	}
	if mspID == "BankMSP" && role == "bankOfficer" {
		return nil
	}
	if mspID != "InsurerMSP" {
		return fmt.Errorf("access denied: private Bank account state is shared only with BankMSP and InsurerMSP")
	}
	if role == "insurerAdmin" {
		return nil
	}
	if role == "policyholder" {
		subject, subjectErr := callerSubject(ctx)
		if subjectErr != nil {
			return subjectErr
		}
		if subject == account.OwnerID {
			return nil
		}
	}
	return fmt.Errorf("access denied: Bank officer, insurer administrator, or owning policyholder is required")
}

func mergedBankAccount(ctx contractapi.TransactionContextInterface, public *BankAccountReference) (*BankAccountReference, error) {
	if err := authorizeBankAccountRead(ctx, public); err != nil {
		return nil, err
	}
	private, err := readBankAccountPrivateState(ctx, public)
	if err != nil {
		return nil, err
	}
	merged := *public
	merged.AccountTokenHash = private.AccountTokenHash
	merged.BalanceMinor = private.BalanceMinor
	return &merged, nil
}

func persistBankAccount(ctx contractapi.TransactionContextInterface, account *BankAccountReference, create bool) error {
	if err := validateHash("accountTokenHash", account.AccountTokenHash); err != nil {
		return err
	}
	private := &BankAccountPrivateState{
		AssetType: "bankAccountPrivateState", SchemaVersion: SchemaVersion, ID: account.ID,
		AccountTokenHash: strings.ToLower(account.AccountTokenHash), BalanceMinor: account.BalanceMinor, UpdatedAt: account.UpdatedAt,
	}
	privateKey, err := privateBankAccountKey(ctx, account.ID)
	if err != nil {
		return err
	}
	privatePayload, err := json.Marshal(private)
	if err != nil {
		return fmt.Errorf("encode private Bank account state: %w", err)
	}
	if err := ctx.GetStub().PutPrivateData(bankInsurerPrivateCollection, privateKey, privatePayload); err != nil {
		return fmt.Errorf("write private Bank account %s: %w", account.ID, err)
	}
	public := *account
	public.AccountTokenHash = ""
	public.BalanceMinor = 0
	if create {
		return putState(ctx, "bankAccountReference", public.ID, &public)
	}
	return overwriteAsset(ctx, "bankAccountReference", public.ID, &public)
}

func parsePrivateOpeningInput(ctx contractapi.TransactionContextInterface) (*bankAccountOpeningPrivateInput, error) {
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, fmt.Errorf("read transient Bank account input: %w", err)
	}
	payload := transient[bankAccountTransientKey]
	if len(payload) == 0 {
		return nil, fmt.Errorf("transient field %s is required", bankAccountTransientKey)
	}
	var input bankAccountOpeningPrivateInput
	if err := json.Unmarshal(payload, &input); err != nil {
		return nil, fmt.Errorf("decode transient Bank account input: %w", err)
	}
	return &input, nil
}

func (c *Contract) OpenPrivateBankAccount(ctx contractapi.TransactionContextInterface, id, bankID, ownerID, accountType, accountLabel, maskedAccount string) (*BankAccountReference, error) {
	input, err := parsePrivateOpeningInput(ctx)
	if err != nil {
		return nil, err
	}
	return c.openBankAccount(ctx, id, bankID, ownerID, accountType, accountLabel, maskedAccount, input.AccountTokenHash, input.OpeningBalanceMinor)
}

func (c *Contract) MigrateBankAccountPrivateState(ctx contractapi.TransactionContextInterface, id string) (*BankAccountReference, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	public, err := getState[BankAccountReference](ctx, "bankAccountReference", id)
	if err != nil {
		return nil, err
	}
	if public.AccountTokenHash == "" {
		return c.ReadBankAccountReference(ctx, id)
	}
	if err := persistBankAccount(ctx, public, false); err != nil {
		return nil, err
	}
	return c.ReadBankAccountReference(ctx, id)
}

func publicBankAccountEvent(account *BankAccountReference) map[string]any {
	return map[string]any{
		"assetType": account.AssetType, "schemaVersion": account.SchemaVersion, "id": account.ID,
		"bankId": account.BankID, "ownerId": account.OwnerID, "accountType": account.AccountType,
		"accountLabel": account.AccountLabel, "maskedAccount": account.MaskedAccount,
		"currency": account.Currency, "status": account.Status, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt,
	}
}
