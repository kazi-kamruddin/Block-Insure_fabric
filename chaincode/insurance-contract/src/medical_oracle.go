package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalOracleBenchmark struct {
	EffectiveFrom    string `json:"effectiveFrom,omitempty" metadata:",optional"`
	HospitalID       string `json:"hospitalId"`
	Service          string `json:"service"`
	ExpectedMinMinor int64  `json:"expectedMinMinor"`
	ExpectedMaxMinor int64  `json:"expectedMaxMinor"`
	LicenseStatus    string `json:"licenseStatus"`
	SourceHash       string `json:"sourceHash"`
}

func (c *Contract) RegisterMedicalOracleBenchmark(ctx contractapi.TransactionContextInterface, hospitalID, service string, minimum, maximum int64, licenseStatus, sourceHash string) (*MedicalOracleBenchmark, error) {
	return c.registerMedicalOracleBenchmark(ctx, hospitalID, service, minimum, maximum, licenseStatus, sourceHash, "")
}

func (c *Contract) RegisterMedicalOracleBenchmarkVersion(ctx contractapi.TransactionContextInterface, hospitalID, service string, minimum, maximum int64, licenseStatus, sourceHash, effectiveFrom string) (*MedicalOracleBenchmark, error) {
	if _, err := validateDate("benchmark effective date", effectiveFrom); err != nil {
		return nil, err
	}
	return c.registerMedicalOracleBenchmark(ctx, hospitalID, service, minimum, maximum, licenseStatus, sourceHash, effectiveFrom)
}

func (c *Contract) registerMedicalOracleBenchmark(ctx contractapi.TransactionContextInterface, hospitalID, service string, minimum, maximum int64, licenseStatus, sourceHash, effectiveFrom string) (*MedicalOracleBenchmark, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("medical benchmark requires the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "HOSPITAL", hospitalID); err != nil {
		return nil, err
	}
	if !validMedicalService(service) || minimum < 0 || maximum <= 0 || minimum > maximum || maximum > 9007199254740991 ||
		(licenseStatus != "ACTIVE" && licenseStatus != "SUSPENDED" && licenseStatus != "BLACKLISTED") {
		return nil, fmt.Errorf("invalid benchmark or recorded license status")
	}
	if err := validateHash("sourceHash", sourceHash); err != nil {
		return nil, err
	}
	benchmark := &MedicalOracleBenchmark{HospitalID: hospitalID, Service: service, ExpectedMinMinor: minimum, ExpectedMaxMinor: maximum, LicenseStatus: licenseStatus, SourceHash: sourceHash}
	key := canonicalProtocolHash("fabric-medical-benchmark-v1", hospitalID, service)
	if effectiveFrom != "" {
		benchmark.EffectiveFrom = effectiveFrom
		indexKey, err := stateKey(ctx, "medicalOracleBenchmarkDates", key)
		if err != nil {
			return nil, err
		}
		raw, err := ctx.GetStub().GetState(indexKey)
		if err != nil {
			return nil, err
		}
		dates := []string{}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &dates); err != nil {
				return nil, err
			}
		}
		if slices.Contains(dates, effectiveFrom) {
			return nil, fmt.Errorf("medical benchmark version already exists")
		}
		dates = append(dates, effectiveFrom)
		slices.Sort(dates)
		versionKey, err := ctx.GetStub().CreateCompositeKey("medicalOracleBenchmark", []string{hospitalID, service, effectiveFrom})
		if err != nil {
			return nil, err
		}
		if err := writeMedicalPrivate(ctx, versionKey, benchmark); err != nil {
			return nil, err
		}
		if err := overwriteAsset(ctx, "medicalOracleBenchmarkDates", key, dates); err != nil {
			return nil, err
		}
		return benchmark, nil
	}
	if err := putPrivateState(ctx, "medicalOracleBenchmark", key, benchmark); err != nil {
		return nil, err
	}
	return benchmark, nil
}

func medicalOracleBenchmarkAt(ctx contractapi.TransactionContextInterface, hospitalID, service, serviceDate string) (*MedicalOracleBenchmark, error) {
	id := canonicalProtocolHash("fabric-medical-benchmark-v1", hospitalID, service)
	index, err := stateKey(ctx, "medicalOracleBenchmarkDates", id)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(index)
	if err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		var dates []string
		if err := json.Unmarshal(raw, &dates); err != nil {
			return nil, err
		}
		pos, exact := slices.BinarySearch(dates, serviceDate)
		if !exact {
			pos--
		}
		if pos >= 0 {
			key, err := ctx.GetStub().CreateCompositeKey("medicalOracleBenchmark", []string{hospitalID, service, dates[pos]})
			if err != nil {
				return nil, err
			}
			raw, err := ctx.GetStub().GetPrivateData(oracleProofCollection, key)
			if err != nil {
				return nil, err
			}
			var benchmark MedicalOracleBenchmark
			if err := json.Unmarshal(raw, &benchmark); err != nil {
				return nil, err
			}
			return &benchmark, nil
		}
	}
	return getPrivateState[MedicalOracleBenchmark](ctx, "medicalOracleBenchmark", id)
}

type MedicalOracleSource struct {
	Invoice       HospitalInvoice    `json:"invoice"`
	Facts         HospitalModelFacts `json:"facts"`
	BenchmarkHash string             `json:"benchmarkHash"`
	Complete      bool               `json:"complete"`
}

// ListMedicalOracleSources creates the existing evaluator's documented inputs
// from private, institution-owned facts and a distinct insurer benchmark.
func (c *Contract) ListMedicalOracleSources(ctx contractapi.TransactionContextInterface) ([]MedicalOracleSource, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("medical source listing requires the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	heads, err := listState[MedicalEpisodeHead](ctx, "medicalEpisode")
	if err != nil {
		return nil, err
	}
	sources := []MedicalOracleSource{}
	for _, head := range heads {
		episode, err := readMedicalEpisode(ctx, head.ID, head.Revision)
		if err != nil {
			return nil, err
		}
		association, err := getPrivateState[MedicalAssociation](ctx, "medicalAssociation", medicalAssociationKey(episode))
		if err != nil || !association.Verified {
			// An unlinked episode cannot be safely assigned to patient history.
			// Flag incomplete history; never expose its private details.
			sources = append(sources, MedicalOracleSource{Invoice: HospitalInvoice{ID: medicalRevisionKey(head.ID, head.Revision), HospitalID: head.HospitalID}})
			continue
		}
		invoice := HospitalInvoice{ID: medicalRevisionKey(head.ID, head.Revision), HospitalID: head.HospitalID,
			PatientReferenceHash: patientSubjectHash(association.BeneficiaryID), InvoiceReferenceHash: head.RevisionHash,
			TreatmentHash: head.RevisionHash, AmountMinor: episode.BillMinor, AdmissionDate: episode.AdmissionDate,
			DischargeDate: episode.DischargeDate, Status: "FINALIZED"}
		source := MedicalOracleSource{Invoice: invoice}
		benchmark, err := medicalOracleBenchmarkAt(ctx, episode.HospitalID, episode.Service, episode.ServiceDate)
		if err == nil && episode.InvoiceDate != "" {
			source.Complete = true
			source.BenchmarkHash = benchmark.SourceHash
			source.Facts = HospitalModelFacts{InvoiceID: invoice.ID, TreatmentType: episode.Service, DiagnosisCode: episode.DiagnosisCode,
				InvoiceDate: episode.InvoiceDate, ExpectedMinMinor: benchmark.ExpectedMinMinor, ExpectedMaxMinor: benchmark.ExpectedMaxMinor, LicenseStatus: benchmark.LicenseStatus}
		}
		sources = append(sources, source)
	}
	return sources, nil
}

func (c *Contract) bindMedicalOracle(ctx contractapi.TransactionContextInterface, claim *Claim, requestID string) (*HospitalVerification, error) {
	if claim.Status != "SUBMITTED" && claim.Status != "APPEAL_SUBMITTED" {
		return nil, fmt.Errorf("medical claim is not awaiting verification")
	}
	head, err := currentMedicalHead(ctx, claim)
	if err != nil {
		return nil, err
	}
	episode, err := readMedicalEpisode(ctx, claim.EpisodeID, claim.EpisodeRevision)
	if err != nil {
		return nil, err
	}
	association, err := verifiedMedicalAssociation(ctx, episode, claim.ClaimantID)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, err
	}
	if err := c.requirePaidMedicalPeriod(ctx, policy, claim.IncidentDate); err != nil {
		return nil, err
	}
	evidence, err := c.requireXGBoostEvidence(ctx, claim)
	if err != nil {
		return nil, err
	}
	digests := make([]string, 0, len(evidence))
	for _, doc := range evidence {
		digests = append(digests, canonicalProtocolHash("fabric-medical-document-v1", doc.ID, doc.DocumentType, doc.ContentHash, doc.StorageReferenceHash))
	}
	slices.Sort(digests)
	manifest := canonicalProtocolHash("fabric-medical-evidence-v1", digests...)
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	binding := &HospitalVerification{AssetType: "hospitalVerification", SchemaVersion: SchemaVersion,
		ID: "oracle-invoice-" + patientSubjectHash(requestID), ClaimID: claim.ID, ClaimVersion: claim.Version,
		HospitalIdentity: claim.HospitalID, Outcome: "SOURCE_BOUND", ClinicalReferenceHash: head.RevisionHash, CreatedAt: now,
		AppealID: claim.CurrentAppealID, MedicalRevisionKind: claim.MedicalRevisionKind}
	binding.AttestationHash = canonicalProtocolHash("fabric-medical-oracle-binding-v1", claim.ID, strconv.Itoa(claim.Version),
		claim.EpisodeID, head.RevisionHash, policy.TermsHash, claim.DescriptionHash, manifest, strconv.Itoa(association.Version), claim.MedicalRevisionKind)
	if err := putState(ctx, "hospitalVerification", binding.ID, binding); err != nil {
		return nil, err
	}
	claim.HospitalVerificationID = binding.ID
	return binding, nil
}

func currentMedicalHead(ctx contractapi.TransactionContextInterface, claim *Claim) (*MedicalEpisodeHead, error) {
	head, err := medicalEpisodeHead(ctx, claim.EpisodeID)
	if err != nil {
		return nil, err
	}
	if head.Revision != claim.EpisodeRevision {
		return nil, fmt.Errorf("episode has a newer revision; reconfirm before continuing")
	}
	association, err := getState[struct {
		Version int `json:"version"`
	}](ctx, "medicalAssociationVersion", claim.MedicalAssociationKey)
	if err != nil || association.Version != claim.MedicalAssociationVersion {
		return nil, fmt.Errorf("episode association changed; verify and reconfirm before continuing")
	}
	return head, nil
}
