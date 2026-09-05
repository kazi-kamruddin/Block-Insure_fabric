package insurance

const SchemaVersion = 2

type PolicyPackage struct {
	AssetType          string `json:"assetType"`
	SchemaVersion      int    `json:"schemaVersion"`
	ID                 string `json:"id"`
	Version            int    `json:"version"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	PremiumMinor       int64  `json:"premiumMinor"`
	CoverageLimitMinor int64  `json:"coverageLimitMinor"`
	TermsHash          string `json:"termsHash"`
	Status             string `json:"status"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

type Policy struct {
	AssetType          string `json:"assetType"`
	SchemaVersion      int    `json:"schemaVersion"`
	ID                 string `json:"id"`
	PackageID          string `json:"packageId"`
	PackageVersion     int    `json:"packageVersion"`
	PolicyholderID     string `json:"policyholderId"`
	StartDate          string `json:"startDate"`
	EndDate            string `json:"endDate"`
	PremiumMinor       int64  `json:"premiumMinor"`
	CoverageLimitMinor int64  `json:"coverageLimitMinor"`
	TermsHash          string `json:"termsHash"`
	Status             string `json:"status"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

type Claim struct {
	AssetType              string   `json:"assetType"`
	SchemaVersion          int      `json:"schemaVersion"`
	ID                     string   `json:"id"`
	PolicyID               string   `json:"policyId"`
	ClaimantID             string   `json:"claimantId"`
	AmountMinor            int64    `json:"amountMinor"`
	IncidentDate           string   `json:"incidentDate"`
	DescriptionHash        string   `json:"descriptionHash"`
	EvidenceIDs            []string `json:"evidenceIds"`
	HospitalVerificationID string   `json:"hospitalVerificationId"`
	AuditorDecisionID      string   `json:"auditorDecisionId"`
	Status                 string   `json:"status"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
}

type EvidenceAccessRecord struct {
	AssetType        string `json:"assetType"`
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	EvidenceID       string `json:"evidenceId"`
	ClaimID          string `json:"claimId"`
	AccessorMSP      string `json:"accessorMsp"`
	AccessorRole     string `json:"accessorRole"`
	AccessorIdentity string `json:"accessorIdentity"`
	Purpose          string `json:"purpose"`
	CreatedAt        string `json:"createdAt"`
}

type EvidenceReference struct {
	AssetType            string `json:"assetType"`
	SchemaVersion        int    `json:"schemaVersion"`
	ID                   string `json:"id"`
	ClaimID              string `json:"claimId"`
	DocumentType         string `json:"documentType"`
	ContentHash          string `json:"contentHash"`
	StorageReferenceHash string `json:"storageReferenceHash"`
	SubmittedBy          string `json:"submittedBy"`
	CreatedAt            string `json:"createdAt"`
}

type HospitalVerification struct {
	AssetType             string `json:"assetType"`
	SchemaVersion         int    `json:"schemaVersion"`
	ID                    string `json:"id"`
	ClaimID               string `json:"claimId"`
	HospitalIdentity      string `json:"hospitalIdentity"`
	Outcome               string `json:"outcome"`
	ClinicalReferenceHash string `json:"clinicalReferenceHash"`
	CreatedAt             string `json:"createdAt"`
}

type AuditorDecision struct {
	AssetType       string `json:"assetType"`
	SchemaVersion   int    `json:"schemaVersion"`
	ID              string `json:"id"`
	ClaimID         string `json:"claimId"`
	AuditorIdentity string `json:"auditorIdentity"`
	Outcome         string `json:"outcome"`
	ReasonHash      string `json:"reasonHash"`
	CreatedAt       string `json:"createdAt"`
}

type Settlement struct {
	AssetType         string `json:"assetType"`
	SchemaVersion     int    `json:"schemaVersion"`
	ID                string `json:"id"`
	ClaimID           string `json:"claimId"`
	AmountMinor       int64  `json:"amountMinor"`
	Status            string `json:"status"`
	BankReferenceHash string `json:"bankReferenceHash"`
	AuthorizedAt      string `json:"authorizedAt"`
	ConfirmedAt       string `json:"confirmedAt"`
}

type HistoryRecord struct {
	TxID      string `json:"txId"`
	Timestamp string `json:"timestamp"`
	IsDelete  bool   `json:"isDelete"`
	Value     *Claim `json:"value,omitempty"`
}
