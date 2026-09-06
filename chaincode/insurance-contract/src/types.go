package insurance

const SchemaVersion = 5

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
	AssetType              string `json:"assetType"`
	SchemaVersion          int    `json:"schemaVersion"`
	ID                     string `json:"id"`
	PackageID              string `json:"packageId"`
	PackageVersion         int    `json:"packageVersion"`
	PolicyholderID         string `json:"policyholderId"`
	StartDate              string `json:"startDate"`
	EndDate                string `json:"endDate"`
	PremiumMinor           int64  `json:"premiumMinor"`
	CoverageLimitMinor     int64  `json:"coverageLimitMinor"`
	TermsHash              string `json:"termsHash"`
	Status                 string `json:"status"`
	PremiumIntervalDays    int    `json:"premiumIntervalDays"`
	GracePeriodDays        int    `json:"gracePeriodDays"`
	PaidThroughDate        string `json:"paidThroughDate"`
	NextPremiumDueDate     string `json:"nextPremiumDueDate"`
	RenewedFromPolicyID    string `json:"renewedFromPolicyId"`
	CancellationReasonHash string `json:"cancellationReasonHash"`
	BenefitPlanID          string `json:"benefitPlanId"`
	BenefitPlanVersion     int    `json:"benefitPlanVersion"`
	DeathBenefitMinor      int64  `json:"deathBenefitMinor"`
	SurrenderBenefitMinor  int64  `json:"surrenderBenefitMinor"`
	MaturityBenefitMinor   int64  `json:"maturityBenefitMinor"`
	BenefitRulesHash       string `json:"benefitRulesHash"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
}

type BankAccountReference struct {
	AssetType        string `json:"assetType"`
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	OwnerID          string `json:"ownerId"`
	AccountTokenHash string `json:"accountTokenHash"`
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type BankMandate struct {
	AssetType          string `json:"assetType"`
	SchemaVersion      int    `json:"schemaVersion"`
	ID                 string `json:"id"`
	PolicyID           string `json:"policyId"`
	AccountReferenceID string `json:"accountReferenceId"`
	OwnerID            string `json:"ownerId"`
	AmountMinor        int64  `json:"amountMinor"`
	IntervalDays       int    `json:"intervalDays"`
	NextDebitDate      string `json:"nextDebitDate"`
	ExpiryDate         string `json:"expiryDate"`
	Status             string `json:"status"`
	DecisionHash       string `json:"decisionHash"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

type PremiumPayment struct {
	AssetType             string `json:"assetType"`
	SchemaVersion         int    `json:"schemaVersion"`
	ID                    string `json:"id"`
	PolicyID              string `json:"policyId"`
	MandateID             string `json:"mandateId"`
	PeriodStartDate       string `json:"periodStartDate"`
	PeriodEndDate         string `json:"periodEndDate"`
	AmountMinor           int64  `json:"amountMinor"`
	ExternalReferenceHash string `json:"externalReferenceHash"`
	Method                string `json:"method"`
	RecordedAt            string `json:"recordedAt"`
}

type PremiumAdjustment struct {
	AssetType             string `json:"assetType"`
	SchemaVersion         int    `json:"schemaVersion"`
	ID                    string `json:"id"`
	PaymentID             string `json:"paymentId"`
	PolicyID              string `json:"policyId"`
	AmountMinor           int64  `json:"amountMinor"`
	ExternalReferenceHash string `json:"externalReferenceHash"`
	ReasonHash            string `json:"reasonHash"`
	Type                  string `json:"type"`
	RecordedAt            string `json:"recordedAt"`
}

type PremiumCollection struct {
	AssetType     string `json:"assetType"`
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	PolicyID      string `json:"policyId"`
	MandateID     string `json:"mandateId"`
	DueDate       string `json:"dueDate"`
	AmountMinor   int64  `json:"amountMinor"`
	Status        string `json:"status"`
	PaymentID     string `json:"paymentId"`
	FailureHash   string `json:"failureHash"`
	AttemptCount  int    `json:"attemptCount"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type BeneficiaryAllocation struct {
	BeneficiaryID string `json:"beneficiaryId"`
	ShareBps      int    `json:"shareBps"`
}

type BenefitPlan struct {
	AssetType             string `json:"assetType"`
	SchemaVersion         int    `json:"schemaVersion"`
	ID                    string `json:"id"`
	PackageID             string `json:"packageId"`
	Version               int    `json:"version"`
	DeathBenefitMinor     int64  `json:"deathBenefitMinor"`
	SurrenderBenefitMinor int64  `json:"surrenderBenefitMinor"`
	MaturityBenefitMinor  int64  `json:"maturityBenefitMinor"`
	RulesHash             string `json:"rulesHash"`
	Status                string `json:"status"`
	CreatedAt             string `json:"createdAt"`
	UpdatedAt             string `json:"updatedAt"`
}

type BeneficiaryDesignation struct {
	AssetType     string                  `json:"assetType"`
	SchemaVersion int                     `json:"schemaVersion"`
	PolicyID      string                  `json:"policyId"`
	OwnerID       string                  `json:"ownerId"`
	Revision      int                     `json:"revision"`
	Allocations   []BeneficiaryAllocation `json:"allocations"`
	UpdatedAt     string                  `json:"updatedAt"`
}

type BenefitRequest struct {
	AssetType            string                  `json:"assetType"`
	SchemaVersion        int                     `json:"schemaVersion"`
	ID                   string                  `json:"id"`
	PolicyID             string                  `json:"policyId"`
	RequesterID          string                  `json:"requesterId"`
	BenefitType          string                  `json:"benefitType"`
	BenefitPlanID        string                  `json:"benefitPlanId"`
	BenefitPlanVersion   int                     `json:"benefitPlanVersion"`
	BenefitRulesHash     string                  `json:"benefitRulesHash"`
	EventDate            string                  `json:"eventDate"`
	AmountMinor          int64                   `json:"amountMinor"`
	EvidenceHash         string                  `json:"evidenceHash"`
	DecisionHash         string                  `json:"decisionHash"`
	FundingReferenceHash string                  `json:"fundingReferenceHash"`
	BankReferenceHash    string                  `json:"bankReferenceHash"`
	Status               string                  `json:"status"`
	Allocations          []BeneficiaryAllocation `json:"allocations"`
	CreatedAt            string                  `json:"createdAt"`
	UpdatedAt            string                  `json:"updatedAt"`
}

type Liability struct {
	AssetType            string `json:"assetType"`
	SchemaVersion        int    `json:"schemaVersion"`
	ID                   string `json:"id"`
	SourceType           string `json:"sourceType"`
	SourceID             string `json:"sourceId"`
	PolicyID             string `json:"policyId"`
	AmountMinor          int64  `json:"amountMinor"`
	Status               string `json:"status"`
	FundingReferenceHash string `json:"fundingReferenceHash"`
	BankReferenceHash    string `json:"bankReferenceHash"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
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
	CurrentReviewID        string   `json:"currentReviewId"`
	CurrentAppealID        string   `json:"currentAppealId"`
	ReviewRound            int      `json:"reviewRound"`
	AppealCount            int      `json:"appealCount"`
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
	GrantID          string `json:"grantId"`
	AccessorMSP      string `json:"accessorMsp"`
	AccessorRole     string `json:"accessorRole"`
	AccessorIdentity string `json:"accessorIdentity"`
	Purpose          string `json:"purpose"`
	CreatedAt        string `json:"createdAt"`
}

type EvidenceAccessGrant struct {
	AssetType      string `json:"assetType"`
	SchemaVersion  int    `json:"schemaVersion"`
	ID             string `json:"id"`
	EvidenceID     string `json:"evidenceId"`
	ClaimID        string `json:"claimId"`
	OwnerID        string `json:"ownerId"`
	GranteeMSP     string `json:"granteeMsp"`
	GranteeRole    string `json:"granteeRole"`
	GranteeSubject string `json:"granteeSubject"`
	Purpose        string `json:"purpose"`
	ExpiresAt      string `json:"expiresAt"`
	MaxAccesses    int    `json:"maxAccesses"`
	AccessCount    int    `json:"accessCount"`
	Status         string `json:"status"`
	CreatedAt      string `json:"createdAt"`
	RevokedAt      string `json:"revokedAt"`
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
	ReviewID        string `json:"reviewId"`
	ReviewRound     int    `json:"reviewRound"`
	AuditorID       string `json:"auditorId"`
	AuditorIdentity string `json:"auditorIdentity"`
	Outcome         string `json:"outcome"`
	ReasonHash      string `json:"reasonHash"`
	CreatedAt       string `json:"createdAt"`
}

type ClaimReview struct {
	AssetType          string   `json:"assetType"`
	SchemaVersion      int      `json:"schemaVersion"`
	ID                 string   `json:"id"`
	ClaimID            string   `json:"claimId"`
	AppealID           string   `json:"appealId"`
	Round              int      `json:"round"`
	Kind               string   `json:"kind"`
	AssignedAuditorIDs []string `json:"assignedAuditorIds"`
	ApprovalThreshold  int      `json:"approvalThreshold"`
	RejectionThreshold int      `json:"rejectionThreshold"`
	Approvals          int      `json:"approvals"`
	Rejections         int      `json:"rejections"`
	VotesCast          int      `json:"votesCast"`
	Status             string   `json:"status"`
	Deadline           string   `json:"deadline"`
	OpenedAt           string   `json:"openedAt"`
	ClosedAt           string   `json:"closedAt"`
}

type ClaimAppeal struct {
	AssetType     string `json:"assetType"`
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	ClaimID       string `json:"claimId"`
	ClaimantID    string `json:"claimantId"`
	Round         int    `json:"round"`
	ReasonHash    string `json:"reasonHash"`
	EvidenceHash  string `json:"evidenceHash"`
	ReviewID      string `json:"reviewId"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
	ResolvedAt    string `json:"resolvedAt"`
}

type FraudAssessment struct {
	AssetType     string   `json:"assetType"`
	SchemaVersion int      `json:"schemaVersion"`
	ID            string   `json:"id"`
	ClaimID       string   `json:"claimId"`
	EngineID      string   `json:"engineId"`
	EngineVersion string   `json:"engineVersion"`
	ModelHash     string   `json:"modelHash"`
	InputHash     string   `json:"inputHash"`
	ScoreBps      int      `json:"scoreBps"`
	RiskLevel     string   `json:"riskLevel"`
	Signals       []string `json:"signals"`
	Advisory      bool     `json:"advisory"`
	RecordedBy    string   `json:"recordedBy"`
	CreatedAt     string   `json:"createdAt"`
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
