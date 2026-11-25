package insurance

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) requireBankSubject(ctx contractapi.TransactionContextInterface, bankID string) error {
	roster, err := c.activeAuditorRoster(ctx)
	if err != nil || roster == nil {
		return err
	}
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return err
	}
	identity := ctx.GetClientIdentity()
	subject, found, err := identity.GetAttributeValue("subjectId")
	if err != nil {
		return err
	}
	if found && subject != "" && subject == bankID {
		return nil
	}
	// The original dev-lite bankOfficer certificate predates subjectId.
	if !found && bankID == "bank-demo" {
		enrollment, enrolled, err := identity.GetAttributeValue("hf.EnrollmentID")
		if err != nil {
			return err
		}
		cert, err := identity.GetX509Certificate()
		if err == nil && cert != nil && enrolled && enrollment == "bankOfficer" && cert.Subject.CommonName == enrollment {
			return nil
		}
	}
	return fmt.Errorf("Bank signing subject does not match the account's bank")
}

func (c *Contract) requireBankAccountSubject(ctx contractapi.TransactionContextInterface, accountID string) error {
	roster, err := c.activeAuditorRoster(ctx)
	if err != nil || roster == nil {
		return err
	}
	account, err := getState[BankAccountReference](ctx, "bankAccountReference", accountID)
	if err != nil {
		return err
	}
	return c.requireBankSubject(ctx, account.BankID)
}
