package insurance

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalCandidateChannel = "insurance-medical-reimbursement"

func isMedicalCandidate(ctx contractapi.TransactionContextInterface) bool {
	return ctx.GetStub().GetChannelID() == medicalCandidateChannel
}

// Only the reference commitment, revision number and digest are public.
type MedicalEpisodeHead struct {
	ID           string `json:"id"`
	HospitalID   string `json:"hospitalId"`
	Revision     int    `json:"revision"`
	RevisionHash string `json:"revisionHash"`
}

type MedicalEpisode struct {
	ID                   string `json:"id"`
	HospitalID           string `json:"hospitalId"`
	Revision             int    `json:"revision"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	Service              string `json:"service"`
	ServiceDate          string `json:"serviceDate"`
	AdmissionDate        string `json:"admissionDate"`
	DischargeDate        string `json:"dischargeDate"`
	BillMinor            int64  `json:"billMinor"`
	InvoiceDate          string `json:"invoiceDate"`
	DiagnosisCode        string `json:"diagnosisCode"`
}

type medicalEpisodeInput struct {
	InvoiceDate          string `json:"invoiceDate"`
	DiagnosisCode        string `json:"diagnosisCode"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	Service              string `json:"service"`
	ServiceDate          string `json:"serviceDate"`
	AdmissionDate        string `json:"admissionDate"`
	DischargeDate        string `json:"dischargeDate"`
	BillMinor            int64  `json:"billMinor"`
}

func medicalRevisionKey(id string, revision int) string {
	return canonicalProtocolHash("fabric-medical-episode-revision-v1", id, strconv.Itoa(revision))
}

func readMedicalEpisode(ctx contractapi.TransactionContextInterface, id string, revision int) (*MedicalEpisode, error) {
	return getPrivateState[MedicalEpisode](ctx, "medicalEpisodeRevision", medicalRevisionKey(id, revision))
}

// SaveMedicalEpisode records only factual intake. A compare-and-set revision
// protects corrections from concurrent writes; an identical retry is idempotent.
func (c *Contract) SaveMedicalEpisode(ctx contractapi.TransactionContextInterface, episodeReferenceHash string, expectedRevision int) (*MedicalEpisodeHead, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("medical intake requires the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	hospital, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "HOSPITAL", hospital); err != nil {
		return nil, err
	}
	if err := validateHash("episodeReferenceHash", episodeReferenceHash); err != nil {
		return nil, err
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, err
	}
	var input medicalEpisodeInput
	decoder := json.NewDecoder(bytes.NewReader(transient["medicalEpisode"]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return nil, fmt.Errorf("invalid medical episode intake: %w", err)
	}
	if err := validateHash("patientReferenceHash", input.PatientReferenceHash); err != nil {
		return nil, err
	}
	if !validMedicalService(input.Service) || input.BillMinor <= 0 || input.BillMinor > 9007199254740991 {
		return nil, fmt.Errorf("invalid service category or billed amount")
	}
	admission, err := validateDate("admissionDate", input.AdmissionDate)
	if err != nil {
		return nil, err
	}
	discharge, err := validateDate("dischargeDate", input.DischargeDate)
	if err != nil || discharge.Before(admission) {
		return nil, fmt.Errorf("invalid discharge date")
	}
	if input.ServiceDate != "" {
		serviceDate, err := validateDate("serviceDate", input.ServiceDate)
		if err != nil || serviceDate.Before(admission) || serviceDate.After(discharge) {
			return nil, fmt.Errorf("documented service date must fall within the episode")
		}
	}
	if len(input.DiagnosisCode) > 40 {
		return nil, fmt.Errorf("invalid documented diagnosis code")
	}
	if input.InvoiceDate != "" {
		date, err := validateDate("invoice date", input.InvoiceDate)
		if err != nil || date.Before(discharge) {
			return nil, fmt.Errorf("invoice date cannot precede discharge")
		}
	}
	id := canonicalProtocolHash("fabric-medical-episode-v1", hospital, episodeReferenceHash)
	key, err := stateKey(ctx, "medicalEpisode", id)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	head := &MedicalEpisodeHead{ID: id, HospitalID: hospital}
	if raw != nil {
		if err := json.Unmarshal(raw, head); err != nil {
			return nil, err
		}
	}
	digest := canonicalProtocolHash("fabric-medical-intake-v1", id, input.PatientReferenceHash, input.Service,
		input.ServiceDate, input.AdmissionDate, input.DischargeDate, strconv.FormatInt(input.BillMinor, 10), input.InvoiceDate, input.DiagnosisCode)
	if head.RevisionHash == digest {
		return head, nil
	}
	if expectedRevision != head.Revision {
		return nil, fmt.Errorf("episode revision changed; reload before saving a correction")
	}
	head.Revision++
	head.RevisionHash = digest
	revision := &MedicalEpisode{ID: id, HospitalID: hospital, Revision: head.Revision,
		PatientReferenceHash: input.PatientReferenceHash, Service: input.Service, ServiceDate: input.ServiceDate,
		AdmissionDate: input.AdmissionDate, DischargeDate: input.DischargeDate, BillMinor: input.BillMinor, InvoiceDate: input.InvoiceDate, DiagnosisCode: input.DiagnosisCode}
	if err := putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(id, head.Revision), revision); err != nil {
		return nil, err
	}
	if err := overwriteState(ctx, key, head); err != nil {
		return nil, err
	}
	return head, emit(ctx, "MedicalEpisodeSaved", head)
}
