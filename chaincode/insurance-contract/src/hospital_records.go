package insurance

import (
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func validateInvoiceStatus(status string) (string, error) {
	status = strings.ToUpper(strings.TrimSpace(status))
	if status != "DRAFT" && status != "FINALIZED" && status != "VOID" {
		return "", fmt.Errorf("status must be DRAFT, FINALIZED, or VOID")
	}
	return status, nil
}

func validateInvoiceFields(patientReferenceHash, invoiceReferenceHash, treatmentHash string, amountMinor int64, admissionDate, dischargeDate string) error {
	for field, value := range map[string]string{
		"patientReferenceHash": patientReferenceHash,
		"invoiceReferenceHash": invoiceReferenceHash,
		"treatmentHash":        treatmentHash,
	} {
		if err := validateHash(field, value); err != nil {
			return err
		}
	}
	if amountMinor <= 0 {
		return fmt.Errorf("amountMinor must be positive")
	}
	admission, err := validateDate("admissionDate", admissionDate)
	if err != nil {
		return err
	}
	discharge, err := validateDate("dischargeDate", dischargeDate)
	if err != nil {
		return err
	}
	if discharge.Before(admission) {
		return fmt.Errorf("dischargeDate must not be before admissionDate")
	}
	return nil
}

func (c *Contract) CreateHospitalInvoice(
	ctx contractapi.TransactionContextInterface,
	id, patientReferenceHash, invoiceReferenceHash, treatmentHash string,
	amountMinor int64, admissionDate, dischargeDate, status string,
) (*HospitalInvoice, error) {
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	hospitalID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "HOSPITAL", hospitalID); err != nil {
		return nil, err
	}
	if err := validateInvoiceFields(patientReferenceHash, invoiceReferenceHash, treatmentHash, amountMinor, admissionDate, dischargeDate); err != nil {
		return nil, err
	}
	status, err = validateInvoiceStatus(status)
	if err != nil {
		return nil, err
	}
	if status == "VOID" {
		return nil, fmt.Errorf("a new invoice cannot start as VOID")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	invoice := &HospitalInvoice{
		AssetType: "hospitalInvoice", SchemaVersion: SchemaVersion, ID: id, HospitalID: hospitalID,
		PatientReferenceHash: strings.ToLower(patientReferenceHash),
		InvoiceReferenceHash: strings.ToLower(invoiceReferenceHash), TreatmentHash: strings.ToLower(treatmentHash),
		AmountMinor: amountMinor, AdmissionDate: admissionDate, DischargeDate: dischargeDate,
		Status: status, CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "hospitalInvoice", id, invoice); err != nil {
		return nil, err
	}
	if err := emit(ctx, "HospitalInvoiceCreated", invoice); err != nil {
		return nil, err
	}
	return invoice, nil
}

func (c *Contract) UpdateHospitalInvoice(
	ctx contractapi.TransactionContextInterface,
	id, patientReferenceHash, invoiceReferenceHash, treatmentHash string,
	amountMinor int64, admissionDate, dischargeDate, status string,
) (*HospitalInvoice, error) {
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	hospitalID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "HOSPITAL", hospitalID); err != nil {
		return nil, err
	}
	invoice, err := c.ReadHospitalInvoice(ctx, id)
	if err != nil {
		return nil, err
	}
	if invoice.HospitalID != hospitalID {
		return nil, fmt.Errorf("access denied: invoice %s belongs to hospital %s", id, invoice.HospitalID)
	}
	status, err = validateInvoiceStatus(status)
	if err != nil {
		return nil, err
	}
	if invoice.Status == "VOID" {
		return nil, fmt.Errorf("void invoice %s cannot be updated", id)
	}
	if invoice.Status == "FINALIZED" && status != "VOID" {
		return nil, fmt.Errorf("finalized invoice %s is immutable; void it and create a correction", id)
	}
	if status != "VOID" {
		if err := validateInvoiceFields(patientReferenceHash, invoiceReferenceHash, treatmentHash, amountMinor, admissionDate, dischargeDate); err != nil {
			return nil, err
		}
		invoice.PatientReferenceHash = strings.ToLower(patientReferenceHash)
		invoice.InvoiceReferenceHash = strings.ToLower(invoiceReferenceHash)
		invoice.TreatmentHash = strings.ToLower(treatmentHash)
		invoice.AmountMinor = amountMinor
		invoice.AdmissionDate = admissionDate
		invoice.DischargeDate = dischargeDate
	}
	invoice.Status = status
	invoice.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "hospitalInvoice", id, invoice); err != nil {
		return nil, err
	}
	if err := emit(ctx, "HospitalInvoiceUpdated", invoice); err != nil {
		return nil, err
	}
	return invoice, nil
}

func (c *Contract) ReadHospitalInvoice(ctx contractapi.TransactionContextInterface, id string) (*HospitalInvoice, error) {
	return getState[HospitalInvoice](ctx, "hospitalInvoice", id)
}

func (c *Contract) ListHospitalInvoices(ctx contractapi.TransactionContextInterface) ([]HospitalInvoice, error) {
	return listState[HospitalInvoice](ctx, "hospitalInvoice")
}

func (c *Contract) CrossCheckClaimInvoice(ctx contractapi.TransactionContextInterface, claimID, verificationID string) (*HospitalVerification, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "SUBMITTED" && claim.Status != "APPEAL_SUBMITTED" {
		return nil, fmt.Errorf("claim %s must be SUBMITTED or APPEAL_SUBMITTED for invoice cross-check", claimID)
	}
	if claim.HospitalVerificationID != "" {
		return nil, fmt.Errorf("claim %s already has an invoice verification for version %d", claimID, claim.Version)
	}
	if claim.HospitalInvoiceID == "" {
		return nil, fmt.Errorf("claim %s has no bound hospital invoice", claimID)
	}
	invoice, err := c.ReadHospitalInvoice(ctx, claim.HospitalInvoiceID)
	if err != nil {
		return nil, err
	}
	outcome := "VERIFIED"
	incident, incidentErr := validateDate("incidentDate", claim.IncidentDate)
	admission, admissionErr := validateDate("admissionDate", invoice.AdmissionDate)
	discharge, dischargeErr := validateDate("dischargeDate", invoice.DischargeDate)
	if invoice.HospitalID != claim.HospitalID || invoice.Status != "FINALIZED" || claim.AmountMinor > invoice.AmountMinor ||
		incidentErr != nil || admissionErr != nil || dischargeErr != nil || incident.Before(admission) || incident.After(discharge) {
		outcome = "INVALID"
	}
	if claim.Status == "APPEAL_SUBMITTED" {
		appeal, readErr := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
		if readErr != nil {
			return nil, readErr
		}
		if !strings.EqualFold(appeal.ProposedClinicalReferenceHash, invoice.InvoiceReferenceHash) {
			outcome = "INVALID"
		}
	}
	return c.recordClaimVerification(ctx, claim, verificationID, outcome, invoice.InvoiceReferenceHash, invoice.HospitalID)
}
