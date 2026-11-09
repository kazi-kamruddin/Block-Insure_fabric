package insurance

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Optional immutable source facts for the synthetic frozen-model adapter.
// Values stay in the existing Hospital/Insurer/Oracle private collection.
type HospitalModelFacts struct {
	InvoiceID        string `json:"invoiceId"`
	TreatmentType    string `json:"treatmentType"`
	DiagnosisCode    string `json:"diagnosisCode"`
	InvoiceDate      string `json:"invoiceDate"`
	ExpectedMinMinor int64  `json:"expectedMinMinor"`
	ExpectedMaxMinor int64  `json:"expectedMaxMinor"`
	LicenseStatus    string `json:"licenseStatus"`
}

func (c *Contract) RecordHospitalModelFacts(ctx contractapi.TransactionContextInterface, invoiceID string) (*HospitalModelFacts, error) {
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	invoice, err := c.ReadHospitalInvoice(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil || subject != invoice.HospitalID {
		return nil, fmt.Errorf("access denied: invoice belongs to another Hospital")
	}
	if invoice.Status != "FINALIZED" {
		return nil, fmt.Errorf("model facts require a finalized source invoice")
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, err
	}
	var facts HospitalModelFacts
	if err := json.Unmarshal(transient["hospitalModelFacts"], &facts); err != nil {
		return nil, fmt.Errorf("transient hospitalModelFacts is required")
	}
	if facts.InvoiceID != invoiceID || strings.TrimSpace(facts.TreatmentType) == "" || len(facts.TreatmentType) > 80 || len(facts.DiagnosisCode) > 40 ||
		facts.ExpectedMinMinor < 0 || facts.ExpectedMaxMinor <= 0 || facts.ExpectedMinMinor > facts.ExpectedMaxMinor || facts.ExpectedMaxMinor > 9007199254740991 {
		return nil, fmt.Errorf("invalid model source facts")
	}
	if _, err := validateDate("invoiceDate", facts.InvoiceDate); err != nil {
		return nil, err
	}
	if facts.InvoiceDate < invoice.DischargeDate {
		return nil, fmt.Errorf("invoiceDate cannot precede discharge")
	}
	if facts.LicenseStatus != "ACTIVE" && facts.LicenseStatus != "SUSPENDED" && facts.LicenseStatus != "BLACKLISTED" {
		return nil, fmt.Errorf("explicit licenseStatus is required")
	}
	if err := putPrivateState(ctx, "hospitalModelFacts", invoiceID, &facts); err != nil {
		return nil, err
	}
	return &facts, nil
}

func (c *Contract) ReadHospitalModelFacts(ctx contractapi.TransactionContextInterface, invoiceID string) (*HospitalModelFacts, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if msp == "HospitalMSP" && role == "hospitalOfficer" {
		invoice, err := c.ReadHospitalInvoice(ctx, invoiceID)
		if err != nil {
			return nil, err
		}
		subject, err := callerSubject(ctx)
		if err != nil || subject != invoice.HospitalID {
			return nil, fmt.Errorf("access denied: invoice belongs to another Hospital")
		}
	} else if !(msp == "InsurerMSP" && role == "insurerAdmin") && !(msp == "OracleMSP" && role == "oracle") {
		return nil, fmt.Errorf("access denied: Hospital, insurer administrator or Oracle required")
	}
	return getPrivateState[HospitalModelFacts](ctx, "hospitalModelFacts", invoiceID)
}
