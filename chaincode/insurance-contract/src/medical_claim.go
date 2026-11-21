package insurance

import (
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalQuote struct {
	BilledMinor         int64                   `json:"billedMinor"`
	EligibleMinor       int64                   `json:"eligibleMinor"`
	DeductibleMinor     int64                   `json:"deductibleMinor"`
	InsurerShareMinor   int64                   `json:"insurerShareMinor"`
	RemainingCoverMinor int64                   `json:"remainingCoverMinor"`
	PayableMinor        int64                   `json:"payableMinor"`
	FilingDeadline      string                  `json:"filingDeadline"`
	EvidenceRequired    bool                    `json:"evidenceRequired"`
	StatementHash       string                  `json:"statementHash"`
	Terms               *MedicalTermsCommitment `json:"termsCommitment,omitempty" metadata:",optional"`
}

type MedicalTermsCommitment struct {
	PackageID     string `json:"packageId"`
	RulesVersion  int    `json:"rulesVersion"`
	TermsHash     string `json:"termsHash"`
	BreakdownHash string `json:"breakdownHash"`
}

type MedicalPreparation struct {
	ID             string `json:"id"`
	PolicyID       string `json:"policyId"`
	EpisodeID      string `json:"episodeId"`
	Revision       int    `json:"revision"`
	Owner          string `json:"owner"`
	PreparedAt     string `json:"preparedAt"`
	FilingDeadline string `json:"filingDeadline"`
}

type MedicalCoverage struct {
	UsedMinor int64 `json:"usedMinor"`
}

func medicalShare(amount, bps int64) int64 {
	return (amount/10000)*bps + ((amount%10000)*bps)/10000
}

func (c *Contract) medicalFacts(ctx contractapi.TransactionContextInterface, policyID, episodeID string, revision int, previous int64, filedAt string) (*Policy, *MedicalEpisode, *MedicalQuote, *MedicalCoverage, error) {
	if !isMedicalCandidate(ctx) {
		return nil, nil, nil, nil, fmt.Errorf("medical claims require the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, nil, nil, nil, err
	}
	owner, err := callerSubject(ctx)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if policy.PolicyholderID != owner || policy.MedicalRulesVersion != 1 || policy.Status == "PENDING_PAYMENT" || policy.Status == "CANCELLED" {
		return nil, nil, nil, nil, fmt.Errorf("paid medical coverage for this patient is required")
	}
	head, err := medicalEpisodeHead(ctx, episodeID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if head.Revision != revision {
		return nil, nil, nil, nil, fmt.Errorf("episode revision changed; reload the current episode")
	}
	episode, err := readMedicalEpisode(ctx, episodeID, revision)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if _, err := verifiedMedicalAssociation(ctx, episode, owner); err != nil {
		return nil, nil, nil, nil, err
	}
	if !slices.Contains(policy.HospitalIDs, episode.HospitalID) {
		return nil, nil, nil, nil, fmt.Errorf("hospital not in the issued provider network")
	}
	rules, err := c.ReadMedicalRules(ctx, policy.PackageID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if rules.TermsHash != policy.TermsHash || rules.Version != policy.MedicalRulesVersion {
		return nil, nil, nil, nil, fmt.Errorf("issued rule commitment mismatch")
	}
	if episode.Service != rules.Service {
		return nil, nil, nil, nil, fmt.Errorf("this service is excluded by the issued policy")
	}
	service, err := validateDate("documented service date", episode.ServiceDate)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("hospital clarification is needed for the documented service date")
	}
	start, err := validateDate("policy start", policy.StartDate)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if service.Before(start.AddDate(0, 0, rules.WaitingDays)) || episode.ServiceDate > policy.EndDate || episode.ServiceDate > policy.PaidThroughDate {
		return nil, nil, nil, nil, fmt.Errorf("service falls outside paid eligible coverage or the waiting period")
	}
	if err := c.requirePaidMedicalPeriod(ctx, policy, episode.ServiceDate); err != nil {
		return nil, nil, nil, nil, err
	}
	deadline := service.AddDate(0, 0, rules.FilingDays).Format(time.DateOnly)
	if filedAt == "" {
		filedAt, err = timestamp(ctx)
		if err != nil {
			return nil, nil, nil, nil, err
		}
	}
	filingTime, err := time.Parse(time.RFC3339Nano, filedAt)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	// Asia/Dhaka uses UTC+06:00 for contemporary policy dates.
	filingDate := filingTime.In(time.FixedZone("Asia/Dhaka", 6*60*60)).Format(time.DateOnly)
	if filingDate > deadline || filingDate < episode.ServiceDate {
		return nil, nil, nil, nil, fmt.Errorf("service date or original filing deadline makes the claim ineligible")
	}
	key, err := stateKey(ctx, "medicalCoverage", policyID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	coverage := &MedicalCoverage{}
	if raw != nil {
		coverage, err = getState[MedicalCoverage](ctx, "medicalCoverage", policyID)
		if err != nil {
			return nil, nil, nil, nil, err
		}
	}
	if previous < 0 || coverage.UsedMinor < previous || coverage.UsedMinor > policy.CoverageLimitMinor {
		return nil, nil, nil, nil, fmt.Errorf("invalid remaining coverage state")
	}
	eligible := min(episode.BillMinor, rules.ServiceSublimitMinor)
	deductible := min(medicalShare(eligible, rules.DeductibleBps), rules.DeductibleCapMinor)
	share := medicalShare(eligible-deductible, rules.InsurerShareBps)
	remaining := policy.CoverageLimitMinor - (coverage.UsedMinor - previous)
	quote := &MedicalQuote{BilledMinor: episode.BillMinor, EligibleMinor: eligible, DeductibleMinor: deductible,
		InsurerShareMinor: share, RemainingCoverMinor: remaining, PayableMinor: min(remaining, share),
		FilingDeadline: deadline, EvidenceRequired: rules.EvidenceRequired}
	quote.StatementHash = canonicalProtocolHash("fabric-medical-statement-v1", policy.ID, policy.TermsHash, head.RevisionHash,
		strconv.Itoa(revision), strconv.FormatInt(quote.PayableMinor, 10), strconv.FormatInt(remaining, 10))
	if usesMedicalApprovalCertificates(ctx) {
		quote.Terms = &MedicalTermsCommitment{PackageID: policy.PackageID, RulesVersion: rules.Version, TermsHash: rules.TermsHash,
			BreakdownHash: canonicalProtocolHash("fabric-medical-breakdown-v1", quote.StatementHash,
				strconv.FormatInt(quote.BilledMinor, 10), strconv.FormatInt(rules.ServiceSublimitMinor, 10), strconv.FormatInt(quote.EligibleMinor, 10),
				strconv.FormatInt(rules.DeductibleCapMinor, 10), strconv.FormatInt(quote.DeductibleMinor, 10),
				strconv.FormatInt(rules.InsurerShareBps, 10), strconv.FormatInt(quote.InsurerShareMinor, 10),
				strconv.FormatInt(policy.CoverageLimitMinor, 10), strconv.FormatInt(quote.RemainingCoverMinor, 10), strconv.FormatInt(quote.PayableMinor, 10))}
	}
	return policy, episode, quote, coverage, nil
}

func (c *Contract) requirePaidMedicalPeriod(ctx contractapi.TransactionContextInterface, policy *Policy, serviceDate string) error {
	payments, err := c.ListPremiumPayments(ctx)
	if err != nil {
		return err
	}
	adjustments, err := c.ListPremiumAdjustments(ctx)
	if err != nil {
		return err
	}
	for _, payment := range payments {
		if payment.PolicyID != policy.ID || serviceDate < payment.PeriodStartDate || serviceDate > payment.PeriodEndDate || payment.TransferID == "" {
			continue
		}
		transfer, err := c.ReadBankTransfer(ctx, payment.TransferID)
		if err != nil {
			return err
		}
		if transfer.Status != "SETTLED" || transfer.PaymentID != payment.ID {
			continue
		}
		net := payment.AmountMinor
		for _, adjustment := range adjustments {
			if adjustment.PaymentID == payment.ID {
				net -= adjustment.AmountMinor
			}
		}
		if net == policy.PremiumMinor {
			return nil
		}
	}
	return fmt.Errorf("no fully paid installment covers the documented service date")
}

func (c *Contract) QuoteMedicalClaim(ctx contractapi.TransactionContextInterface, policyID, episodeID string, revision int) (*MedicalQuote, error) {
	_, _, quote, _, err := c.medicalFacts(ctx, policyID, episodeID, revision, 0, "")
	return quote, err
}

func (c *Contract) PrepareMedicalClaim(ctx contractapi.TransactionContextInterface, id, policyID, episodeID string, revision int) (*MedicalPreparation, error) {
	policy, _, quote, _, err := c.medicalFacts(ctx, policyID, episodeID, revision, 0, "")
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	receipt := &MedicalPreparation{ID: id, PolicyID: policyID, EpisodeID: episodeID, Revision: revision, Owner: policy.PolicyholderID, PreparedAt: now, FilingDeadline: quote.FilingDeadline}
	if err := putPrivateState(ctx, "medicalPreparation", id, receipt); err != nil {
		return nil, err
	}
	return receipt, nil
}

func (c *Contract) SubmitMedicalClaim(ctx contractapi.TransactionContextInterface, id, policyID, episodeID string, revision int, acceptedStatementHash string) (*Claim, error) {
	policy, episode, quote, coverage, err := c.medicalFacts(ctx, policyID, episodeID, revision, 0, "")
	if err != nil {
		return nil, err
	}
	receipt, err := getPrivateState[MedicalPreparation](ctx, "medicalPreparation", id)
	if err != nil || receipt.Owner != policy.PolicyholderID || receipt.PolicyID != policyID || receipt.EpisodeID != episodeID || receipt.Revision != revision {
		return nil, fmt.Errorf("prepare this exact claim before submission")
	}
	if quote.PayableMinor <= 0 || acceptedStatementHash != quote.StatementHash {
		return nil, fmt.Errorf("review the current reimbursement statement before submission")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	claim := &Claim{AssetType: "claim", SchemaVersion: SchemaVersion, ID: id, PolicyID: policyID, ClaimantID: policy.PolicyholderID,
		HospitalID: episode.HospitalID, EpisodeID: episodeID, EpisodeRevision: revision, HospitalInvoiceID: medicalRevisionKey(episodeID, revision),
		AmountMinor: quote.PayableMinor, IncidentDate: episode.ServiceDate, DescriptionHash: quote.StatementHash, EvidenceIDs: []string{},
		Version: 1, Status: "SUBMITTED", CreatedAt: now, UpdatedAt: now, MedicalEvidenceRequired: quote.EvidenceRequired}
	association, err := verifiedMedicalAssociation(ctx, episode, claim.ClaimantID)
	if err != nil {
		return nil, err
	}
	claim.MedicalAssociationKey, claim.MedicalAssociationVersion = medicalAssociationKey(episode), association.Version
	if err := c.screenMedicalDuplicate(ctx, claim, episode); err != nil {
		return nil, err
	}
	if err := putState(ctx, "medicalPayableEpisode", episodeID, struct {
		ClaimID string `json:"claimId"`
	}{id}); err != nil {
		return nil, err
	}
	if err := putState(ctx, "claim", id, claim); err != nil {
		return nil, err
	}
	return c.saveMedicalVersion(ctx, claim, quote, coverage, 0)
}

func (c *Contract) saveMedicalVersion(ctx contractapi.TransactionContextInterface, claim *Claim, quote *MedicalQuote, coverage *MedicalCoverage, previous int64) (*Claim, error) {
	coverage.UsedMinor = coverage.UsedMinor - previous + quote.PayableMinor
	if err := overwriteAsset(ctx, "medicalCoverage", claim.PolicyID, coverage); err != nil {
		return nil, err
	}
	if err := storeMedicalStatement(ctx, claim, quote); err != nil {
		return nil, err
	}
	return claim, emit(ctx, "ClaimSubmitted", claim)
}

func storeMedicalStatement(ctx contractapi.TransactionContextInterface, claim *Claim, quote *MedicalQuote) error {
	key := medicalRevisionKey(claim.ID, claim.Version)
	if usesMedicalApprovalCertificates(ctx) && quote.Terms != nil {
		if err := putState(ctx, "medicalTermsCommitment", key, quote.Terms); err != nil {
			return err
		}
	}
	return putPrivateState(ctx, "medicalStatement", key, quote)
}

func (c *Contract) ReadMedicalStatement(ctx contractapi.TransactionContextInterface, id string, version int) (*MedicalQuote, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil || msp != "InsurerMSP" || (role != "insurerAdmin" && role != "policyholder") {
		return nil, fmt.Errorf("medical statement is restricted to the insurer and claimant")
	}
	claim, err := c.ReadClaim(ctx, id)
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil || (role == "policyholder" && subject != claim.ClaimantID) {
		return nil, fmt.Errorf("medical statement is unavailable")
	}
	return getPrivateState[MedicalQuote](ctx, "medicalStatement", medicalRevisionKey(id, version))
}

func (c *Contract) medicalCorrectionFacts(ctx contractapi.TransactionContextInterface, claimID string, revision int) (*Claim, *MedicalEpisode, *MedicalQuote, *MedicalCoverage, error) {
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if claim.EpisodeID == "" || claim.Status == "SETTLED" || claim.MedicalReserveReleasedAt != "" || revision < claim.EpisodeRevision {
		return nil, nil, nil, nil, fmt.Errorf("only an unpaid claim with a current episode revision can be corrected")
	}
	// Only the certificate channel can supersede an unpaid settlement and its
	// liability. Elsewhere a correction would orphan both and leave the claim
	// unable to settle, so refuse it before any state changes.
	if claim.MedicalSettlementID != "" && !usesMedicalApprovalCertificates(ctx) {
		return nil, nil, nil, nil, fmt.Errorf("a settlement is already authorized for this claim; complete or reconcile it before correcting")
	}
	_, episode, quote, coverage, err := c.medicalFacts(ctx, claim.PolicyID, claim.EpisodeID, revision, claim.AmountMinor, claim.CreatedAt)
	if err == nil && revision == claim.EpisodeRevision {
		link, linkErr := verifiedMedicalAssociation(ctx, episode, claim.ClaimantID)
		if linkErr != nil || link.Version == claim.MedicalAssociationVersion {
			return nil, nil, nil, nil, fmt.Errorf("no newer episode or verified association to reconfirm")
		}
	}
	return claim, episode, quote, coverage, err
}

func (c *Contract) QuoteMedicalCorrection(ctx contractapi.TransactionContextInterface, claimID string, revision int) (*MedicalQuote, error) {
	_, _, quote, _, err := c.medicalCorrectionFacts(ctx, claimID, revision)
	return quote, err
}

func (c *Contract) AcceptMedicalCorrection(ctx contractapi.TransactionContextInterface, claimID string, revision int, acceptedStatementHash string) (*Claim, error) {
	claim, episode, quote, coverage, err := c.medicalCorrectionFacts(ctx, claimID, revision)
	if err != nil {
		return nil, err
	}
	if claim.Status == "REJECTED" || claim.CurrentAppealID != "" {
		return nil, fmt.Errorf("apply a rejected-claim correction through medical appeal")
	}
	if claim.MedicalClarificationID != "" {
		note, err := c.readClarification(ctx, claim.MedicalClarificationID)
		if err != nil {
			return nil, err
		}
		if note.Status == "PENDING" {
			return nil, fmt.Errorf("answer or expire the clarification before accepting a correction")
		}
	}
	if quote.StatementHash != acceptedStatementHash {
		return nil, fmt.Errorf("review the corrected statement before reconfirming")
	}
	previous := claim.AmountMinor
	if usesMedicalApprovalCertificates(ctx) && claim.MedicalSettlementID != "" {
		if err := c.supersedeUnpaidMedicalSettlement(ctx, claim); err != nil {
			return nil, err
		}
	}
	link, err := verifiedMedicalAssociation(ctx, episode, claim.ClaimantID)
	if err != nil {
		return nil, err
	}
	claim.MedicalAssociationKey, claim.MedicalAssociationVersion = medicalAssociationKey(episode), link.Version
	if claim.CurrentReviewID != "" {
		review, err := c.ReadClaimReview(ctx, claim.CurrentReviewID)
		if err != nil {
			return nil, err
		}
		if review.Status == "OPEN" || review.Status == "PREPARING" {
			review.Status = "SUPERSEDED"
			if err := overwriteAsset(ctx, "claimReview", review.ID, review); err != nil {
				return nil, err
			}
		}
	}
	claim.AmountMinor, claim.DescriptionHash = quote.PayableMinor, quote.StatementHash
	claim.EpisodeRevision, claim.IncidentDate = revision, episode.ServiceDate
	claim.HospitalInvoiceID = medicalRevisionKey(episode.ID, revision)
	claim.Status, claim.OracleOutcome, claim.OracleResultHash = "SUBMITTED", "", ""
	if quote.PayableMinor == 0 {
		claim.Status = "NO_PAYABLE_AMOUNT"
	}
	claim.CurrentOracleRequestID, claim.CurrentReviewID, claim.HospitalVerificationID = "", "", ""
	claim.CurrentAppealID, claim.PrivacyPresentationID, claim.MedicalSettlementID = "", "", ""
	claim.EvidenceIDs = []string{}
	claim.MedicalRevisionKind, claim.MedicalSupplementHash = "CORRECTION", ""
	claim.MedicalEscalatedAt = ""
	claim.MedicalHeldReleaseID = ""
	if err := c.screenMedicalDuplicate(ctx, claim, episode); err != nil {
		return nil, err
	}
	claim.Version++
	claim.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return c.saveMedicalVersion(ctx, claim, quote, coverage, previous)
}
