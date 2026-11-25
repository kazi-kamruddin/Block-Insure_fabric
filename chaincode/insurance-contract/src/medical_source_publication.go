package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalHospitalInvoiceNumber = "medicalHospitalInvoiceNumber"

type hospitalInvoiceReference struct {
	Number string `json:"number"`
}

type HospitalClaimSource struct {
	ClaimID       string `json:"claimId"`
	ClaimVersion  int    `json:"claimVersion"`
	HospitalID    string `json:"hospitalId"`
	Service       string `json:"service"`
	ServiceDate   string `json:"serviceDate"`
	InvoiceDate   string `json:"invoiceDate"`
	AdmissionDate string `json:"admissionDate"`
	DischargeDate string `json:"dischargeDate"`
	DiagnosisCode string `json:"diagnosisCode"`
	BillMinor     int64  `json:"billMinor"`
	InvoiceHash   string `json:"invoiceHash"`
	InvoiceNumber string `json:"invoiceNumber"`
}

type MedicalClaimReceiptSource struct {
	ClaimID      string             `json:"claimId"`
	ClaimVersion int                `json:"claimVersion"`
	Receipt      *MedicalOCRSummary `json:"receipt,omitempty" metadata:",optional"`
}

type publishedSourcePin struct {
	IssuerID    string `json:"issuerId"`
	FeedVersion int    `json:"feedVersion"`
	Root        string `json:"root"`
}

func rememberMedicalInvoiceNumber(ctx contractapi.TransactionContextInterface, episodeID, episodeReferenceHash, number string) error {
	if number == "" || !usesMedicalApprovalCertificates(ctx) {
		return nil
	}
	sum := sha256.Sum256([]byte(number))
	if !medicalReceiptNumber.MatchString(number) || hex.EncodeToString(sum[:]) != episodeReferenceHash {
		return fmt.Errorf("invoice number must match the Hospital episode reference")
	}
	if isMissingPrivate(ctx, medicalHospitalInvoiceNumber, episodeID) {
		return putPrivateState(ctx, medicalHospitalInvoiceNumber, episodeID, hospitalInvoiceReference{Number: number})
	}
	stored, err := getPrivateState[hospitalInvoiceReference](ctx, medicalHospitalInvoiceNumber, episodeID)
	if err != nil {
		return err
	}
	if stored.Number != number {
		return fmt.Errorf("invoice number differs from the committed Hospital reference")
	}
	return nil
}

func medicalHospitalFeedRecordID(claimID string, version int) string {
	sum := sha256.Sum256([]byte(claimID + ":" + strconv.Itoa(version)))
	return "his-" + hex.EncodeToString(sum[:])
}

func medicalPublicationClaim(c *Contract, ctx contractapi.TransactionContextInterface, claimID string, version int) (*Claim, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical source publication requires the dev-lite medical channel")
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Version != version || claim.EpisodeID == "" || (claim.Status != "SUBMITTED" && claim.Status != "APPEAL_SUBMITTED") {
		return nil, fmt.Errorf("the requested medical claim version is not awaiting source publication")
	}
	return claim, nil
}

// ReadHospitalClaimSource returns only the invoice fields used in S-A. The
// publisher evaluates this transaction on the Hospital peer.
func (c *Contract) ReadHospitalClaimSource(ctx contractapi.TransactionContextInterface, claimID string, version int) (*HospitalClaimSource, error) {
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	claim, err := medicalPublicationClaim(c, ctx, claimID, version)
	if err != nil {
		return nil, err
	}
	hospital, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if hospital != claim.HospitalID {
		return nil, fmt.Errorf("only the hospital of record can publish this invoice")
	}
	head, err := currentMedicalHead(ctx, claim)
	if err != nil {
		return nil, err
	}
	episode, err := readMedicalEpisode(ctx, head.ID, head.Revision)
	if err != nil {
		return nil, err
	}
	reference, err := getPrivateState[hospitalInvoiceReference](ctx, medicalHospitalInvoiceNumber, head.ID)
	if err != nil {
		return nil, fmt.Errorf("hospital must record its invoice number before processing")
	}
	return &HospitalClaimSource{ClaimID: claim.ID, ClaimVersion: claim.Version, HospitalID: hospital,
		Service: episode.Service, ServiceDate: episode.ServiceDate, InvoiceDate: episode.InvoiceDate, AdmissionDate: episode.AdmissionDate,
		DischargeDate: episode.DischargeDate, DiagnosisCode: episode.DiagnosisCode, BillMinor: episode.BillMinor,
		InvoiceHash: head.RevisionHash, InvoiceNumber: reference.Number}, nil
}

func (c *Contract) ReadMedicalClaimReceiptSource(ctx contractapi.TransactionContextInterface, claimID string, version int) (*MedicalClaimReceiptSource, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := medicalPublicationClaim(c, ctx, claimID, version)
	if err != nil {
		return nil, err
	}
	source := &MedicalClaimReceiptSource{ClaimID: claim.ID, ClaimVersion: claim.Version}
	id := medicalRevisionKey(claimID, version)
	key, err := privateStateKey(ctx, "medicalOCRSummary", id)
	if err != nil {
		return nil, err
	}
	hash, err := ctx.GetStub().GetPrivateDataHash(oracleProofCollection, key)
	if err != nil || len(hash) == 0 {
		return source, err
	}
	source.Receipt, err = getPrivateState[MedicalOCRSummary](ctx, "medicalOCRSummary", id)
	return source, err
}

// RequestPublishedMedicalOracleVerification prevents starting a newer
// revision with feeds published for a previous version of the same claim.
func (c *Contract) RequestPublishedMedicalOracleVerification(ctx contractapi.TransactionContextInterface, requestID, claimID string, version int, pinsJSON string) (*OracleRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := medicalPublicationClaim(c, ctx, claimID, version)
	if err != nil {
		return nil, err
	}
	var pins []publishedSourcePin
	if len(pinsJSON) > 1024 || json.Unmarshal([]byte(pinsJSON), &pins) != nil || len(pins) != 3 {
		return nil, fmt.Errorf("three published source pins are required")
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	manifest, _, err := buildOracleV2Manifest(ctx, claim.HospitalID, now)
	if err != nil {
		return nil, err
	}
	for i, pin := range manifest.Pins {
		if pins[i] != (publishedSourcePin{IssuerID: pin.IssuerID, FeedVersion: pin.FeedVersion, Root: pin.Root}) {
			return nil, fmt.Errorf("source anchors changed after publication; refresh and try again")
		}
	}
	return c.RequestOracleVerificationV2(ctx, requestID, claimID)
}
