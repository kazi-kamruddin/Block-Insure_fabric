package insurance

const SchemaVersion = 12

type PartnerAgreement struct {
	AssetType     string `json:"assetType"`
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	PartnerType   string `json:"partnerType"`
	PartnerID     string `json:"partnerId"`
	Name          string `json:"name"`
	Location      string `json:"location"`
	Tier          string `json:"tier"`
	AccessScope   string `json:"accessScope"`
	EffectiveDate string `json:"effectiveDate"`
	ExpiryDate    string `json:"expiryDate"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type HospitalInvoice struct {
	AssetType            string `json:"assetType"`
	SchemaVersion        int    `json:"schemaVersion"`
	ID                   string `json:"id"`
	HospitalID           string `json:"hospitalId"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	InvoiceReferenceHash string `json:"invoiceReferenceHash"`
	TreatmentHash        string `json:"treatmentHash"`
	AmountMinor          int64  `json:"amountMinor"`
	AdmissionDate        string `json:"admissionDate"`
	DischargeDate        string `json:"dischargeDate"`
	Status               string `json:"status"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
}

type PolicyPackage struct {
	AssetType          string   `json:"assetType"`
	SchemaVersion      int      `json:"schemaVersion"`
	ID                 string   `json:"id"`
	Version            int      `json:"version"`
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	PremiumMinor       int64    `json:"premiumMinor"`
	CoverageLimitMinor int64    `json:"coverageLimitMinor"`
	TermsHash          string   `json:"termsHash"`
	HospitalIDs        []string `json:"hospitalIds"`
	BankIDs            []string `json:"bankIds"`
	Status             string   `json:"status"`
	CreatedAt          string   `json:"createdAt"`
	UpdatedAt          string   `json:"updatedAt"`
}

type Policy struct {
	AssetType              string   `json:"assetType"`
	SchemaVersion          int      `json:"schemaVersion"`
	ID                     string   `json:"id"`
	PackageID              string   `json:"packageId"`
	PackageVersion         int      `json:"packageVersion"`
	PolicyholderID         string   `json:"policyholderId"`
	StartDate              string   `json:"startDate"`
	EndDate                string   `json:"endDate"`
	PremiumMinor           int64    `json:"premiumMinor"`
	CoverageLimitMinor     int64    `json:"coverageLimitMinor"`
	TermsHash              string   `json:"termsHash"`
	HospitalIDs            []string `json:"hospitalIds"`
	BankIDs                []string `json:"bankIds"`
	Status                 string   `json:"status"`
	PremiumIntervalDays    int      `json:"premiumIntervalDays"`
	GracePeriodDays        int      `json:"gracePeriodDays"`
	PaidThroughDate        string   `json:"paidThroughDate"`
	NextPremiumDueDate     string   `json:"nextPremiumDueDate"`
	RenewedFromPolicyID    string   `json:"renewedFromPolicyId"`
	CancellationReasonHash string   `json:"cancellationReasonHash"`
	BenefitPlanID          string   `json:"benefitPlanId"`
	BenefitPlanVersion     int      `json:"benefitPlanVersion"`
	DeathBenefitMinor      int64    `json:"deathBenefitMinor"`
	SurrenderBenefitMinor  int64    `json:"surrenderBenefitMinor"`
	MaturityBenefitMinor   int64    `json:"maturityBenefitMinor"`
	BenefitRulesHash       string   `json:"benefitRulesHash"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
}

type BankAccountReference struct {
	AssetType        string `json:"assetType"`
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	BankID           string `json:"bankId"`
	OwnerID          string `json:"ownerId"`
	AccountType      string `json:"accountType"`
	AccountLabel     string `json:"accountLabel"`
	MaskedAccount    string `json:"maskedAccount"`
	AccountTokenHash string `json:"accountTokenHash,omitempty"`
	Currency         string `json:"currency"`
	// BalanceMinor is deliberately serialized as a zero-valued public placeholder.
	// The authoritative balance remains in bankInsurerPrivateData, while keeping
	// this scalar present satisfies Fabric's generated transaction schema.
	BalanceMinor int64  `json:"balanceMinor"`
	Status       string `json:"status"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// BankAccountPrivateState is stored only in bankInsurerPrivateData. The public
// BankAccountReference retains organization, ownership, masked display, and
// lifecycle fields while token and balance data remain private to BankMSP and
// InsurerMSP peers.
type BankAccountPrivateState struct {
	AssetType        string `json:"assetType"`
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	AccountTokenHash string `json:"accountTokenHash"`
	BalanceMinor     int64  `json:"balanceMinor"`
	UpdatedAt        string `json:"updatedAt"`
}

type BankTransfer struct {
	AssetType             string `json:"assetType"`
	SchemaVersion         int    `json:"schemaVersion"`
	ID                    string `json:"id"`
	BankID                string `json:"bankId"`
	SourceAccountID       string `json:"sourceAccountId"`
	DestinationAccountID  string `json:"destinationAccountId"`
	PolicyID              string `json:"policyId"`
	MandateID             string `json:"mandateId"`
	CollectionID          string `json:"collectionId"`
	PaymentID             string `json:"paymentId"`
	SettlementID          string `json:"settlementId"`
	AmountMinor           int64  `json:"amountMinor"`
	Currency              string `json:"currency"`
	Method                string `json:"method"`
	Status                string `json:"status"`
	FailureCode           string `json:"failureCode"`
	ExternalReferenceHash string `json:"externalReferenceHash"`
	AuthorizationHash     string `json:"authorizationHash"`
	CreatedAt             string `json:"createdAt"`
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
	TransferID            string `json:"transferId"`
	SourceAccountID       string `json:"sourceAccountId"`
	DestinationAccountID  string `json:"destinationAccountId"`
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
	TransferID            string `json:"transferId"`
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
	TransferID    string `json:"transferId"`
	FailureHash   string `json:"failureHash"`
	FailureCode   string `json:"failureCode"`
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
	HospitalID             string   `json:"hospitalId"`
	HospitalInvoiceID      string   `json:"hospitalInvoiceId"`
	AmountMinor            int64    `json:"amountMinor"`
	IncidentDate           string   `json:"incidentDate"`
	DescriptionHash        string   `json:"descriptionHash"`
	EvidenceIDs            []string `json:"evidenceIds"`
	HospitalVerificationID string   `json:"hospitalVerificationId"`
	AuditorDecisionID      string   `json:"auditorDecisionId"`
	CurrentReviewID        string   `json:"currentReviewId"`
	CurrentAppealID        string   `json:"currentAppealId"`
	CurrentOracleRequestID string   `json:"currentOracleRequestId"`
	OracleOutcome          string   `json:"oracleOutcome"`
	OracleResultHash       string   `json:"oracleResultHash"`
	Version                int      `json:"version"`
	ReviewRound            int      `json:"reviewRound"`
	AppealCount            int      `json:"appealCount"`
	Status                 string   `json:"status"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
}

type OracleRegistrySnapshot struct {
	AssetType     string `json:"assetType"`
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	Version       int    `json:"version"`
	RootHash      string `json:"rootHash"`
	RulesVersion  string `json:"rulesVersion"`
	RulesHash     string `json:"rulesHash"`
	RecordCount   int    `json:"recordCount"`
	PublishedBy   string `json:"publishedBy"`
	CreatedAt     string `json:"createdAt"`
}

type OracleRequest struct {
	AssetType              string   `json:"assetType"`
	SchemaVersion          int      `json:"schemaVersion"`
	ID                     string   `json:"id"`
	ClaimID                string   `json:"claimId"`
	ClaimVersion           int      `json:"claimVersion"`
	HospitalVerificationID string   `json:"hospitalVerificationId"`
	AppealID               string   `json:"appealId"`
	AppealCommitmentHash   string   `json:"appealCommitmentHash"`
	QueryHash              string   `json:"queryHash"`
	RegistrySnapshotID     string   `json:"registrySnapshotId"`
	RegistryVersion        int      `json:"registryVersion"`
	RegistryRootHash       string   `json:"registryRootHash"`
	RulesVersion           string   `json:"rulesVersion"`
	RulesHash              string   `json:"rulesHash"`
	ModelVersion           string   `json:"modelVersion"`
	ModelHash              string   `json:"modelHash"`
	AssignedOracleIDs      []string `json:"assignedOracleIds"`
	RequiredConfirmations  int      `json:"requiredConfirmations"`
	ExpectedResponses      int      `json:"expectedResponses"`
	CommitmentCount        int      `json:"commitmentCount"`
	RevealCount            int      `json:"revealCount"`
	Status                 string   `json:"status"`
	VerifiedResult         bool     `json:"verifiedResult"`
	ResultHash             string   `json:"resultHash"`
	FinalizationCode       string   `json:"finalizationCode"`
	CommitDeadline         string   `json:"commitDeadline"`
	RevealDeadline         string   `json:"revealDeadline"`
	RequestedAt            string   `json:"requestedAt"`
	FinalizedAt            string   `json:"finalizedAt"`
}

type OracleCommitment struct {
	AssetType      string `json:"assetType"`
	SchemaVersion  int    `json:"schemaVersion"`
	ID             string `json:"id"`
	RequestID      string `json:"requestId"`
	ClaimID        string `json:"claimId"`
	ClaimVersion   int    `json:"claimVersion"`
	OracleID       string `json:"oracleId"`
	OracleIdentity string `json:"oracleIdentity"`
	CommitmentHash string `json:"commitmentHash"`
	CreatedAt      string `json:"createdAt"`
}

type OracleResult struct {
	AssetType        string `json:"assetType"`
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	RequestID        string `json:"requestId"`
	ClaimID          string `json:"claimId"`
	ClaimVersion     int    `json:"claimVersion"`
	RegistryVersion  int    `json:"registryVersion"`
	ModelVersion     string `json:"modelVersion"`
	OracleID         string `json:"oracleId"`
	OracleIdentity   string `json:"oracleIdentity"`
	Verified         bool   `json:"verified"`
	VerificationCode string `json:"verificationCode"`
	RecordHash       string `json:"recordHash"`
	ResultHash       string `json:"resultHash"`
	CreatedAt        string `json:"createdAt"`
}

type OracleRequestHistoryRecord struct {
	TxID      string         `json:"txId"`
	Timestamp string         `json:"timestamp"`
	IsDelete  bool           `json:"isDelete"`
	Value     *OracleRequest `json:"value,omitempty"`
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
	ClaimVersion         int    `json:"claimVersion"`
	DocumentType         string `json:"documentType"`
	ContentHash          string `json:"contentHash"`
	StorageReferenceHash string `json:"storageReferenceHash"`
	SubmittedBy          string `json:"submittedBy"`
	CreatedAt            string `json:"createdAt"`
}

type EvidenceMerkleBatch struct {
	AssetType     string   `json:"assetType"`
	SchemaVersion int      `json:"schemaVersion"`
	ID            string   `json:"id"`
	RootHash      string   `json:"rootHash"`
	HashAlgorithm string   `json:"hashAlgorithm"`
	LeafEncoding  string   `json:"leafEncoding"`
	EvidenceIDs   []string `json:"evidenceIds"`
	LeafCount     int      `json:"leafCount"`
	PublishedBy   string   `json:"publishedBy"`
	CreatedAt     string   `json:"createdAt"`
}

type MerkleProofStep struct {
	Hash     string `json:"hash"`
	Position string `json:"position"`
}

type EvidenceInclusionVerification struct {
	BatchID       string `json:"batchId"`
	EvidenceID    string `json:"evidenceId"`
	LeafHash      string `json:"leafHash"`
	ComputedRoot  string `json:"computedRoot"`
	AnchoredRoot  string `json:"anchoredRoot"`
	ProofSteps    int    `json:"proofSteps"`
	Included      bool   `json:"included"`
	HashAlgorithm string `json:"hashAlgorithm"`
	LeafEncoding  string `json:"leafEncoding"`
}

type HospitalVerification struct {
	AssetType             string `json:"assetType"`
	SchemaVersion         int    `json:"schemaVersion"`
	ID                    string `json:"id"`
	ClaimID               string `json:"claimId"`
	ClaimVersion          int    `json:"claimVersion"`
	AppealID              string `json:"appealId"`
	HospitalIdentity      string `json:"hospitalIdentity"`
	Outcome               string `json:"outcome"`
	ClinicalReferenceHash string `json:"clinicalReferenceHash"`
	AttestationHash       string `json:"attestationHash"`
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
	AssetType                     string `json:"assetType"`
	SchemaVersion                 int    `json:"schemaVersion"`
	ID                            string `json:"id"`
	ClaimID                       string `json:"claimId"`
	ClaimantID                    string `json:"claimantId"`
	ClaimVersion                  int    `json:"claimVersion"`
	Round                         int    `json:"round"`
	CommitmentVersion             string `json:"commitmentVersion"`
	CommitmentHash                string `json:"commitmentHash"`
	ReasonCategory                string `json:"reasonCategory"`
	ReasonHash                    string `json:"reasonHash"`
	DescriptionHash               string `json:"descriptionHash"`
	EvidenceHash                  string `json:"evidenceHash"`
	OriginalClaimHash             string `json:"originalClaimHash"`
	ProposedHospitalID            string `json:"proposedHospitalId"`
	ProposedAmountMinor           int64  `json:"proposedAmountMinor"`
	ProposedIncidentDate          string `json:"proposedIncidentDate"`
	ProposedDescriptionHash       string `json:"proposedDescriptionHash"`
	ProposedClinicalReferenceHash string `json:"proposedClinicalReferenceHash"`
	HospitalVerificationID        string `json:"hospitalVerificationId"`
	ReviewID                      string `json:"reviewId"`
	Status                        string `json:"status"`
	CreatedAt                     string `json:"createdAt"`
	ResolvedAt                    string `json:"resolvedAt"`
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
	AssetType            string `json:"assetType"`
	SchemaVersion        int    `json:"schemaVersion"`
	ID                   string `json:"id"`
	ClaimID              string `json:"claimId"`
	SourceAccountID      string `json:"sourceAccountId"`
	DestinationAccountID string `json:"destinationAccountId"`
	TransferID           string `json:"transferId"`
	AmountMinor          int64  `json:"amountMinor"`
	Currency             string `json:"currency"`
	Status               string `json:"status"`
	FailureCode          string `json:"failureCode"`
	BankReferenceHash    string `json:"bankReferenceHash"`
	AuthorizedAt         string `json:"authorizedAt"`
	ConfirmedAt          string `json:"confirmedAt"`
	UpdatedAt            string `json:"updatedAt"`
}

type HistoryRecord struct {
	TxID      string `json:"txId"`
	Timestamp string `json:"timestamp"`
	IsDelete  bool   `json:"isDelete"`
	Value     *Claim `json:"value,omitempty"`
}
