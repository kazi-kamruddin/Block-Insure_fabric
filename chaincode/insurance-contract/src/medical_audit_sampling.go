package insurance

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalAuditPeriod struct {
	ID         string `json:"id"`
	StartsAt   string `json:"startsAt"`
	EndsAt     string `json:"endsAt"`
	RateBps    int    `json:"rateBps"`
	Commitment string `json:"commitment"`
	Seed       string `json:"seed"`
}

type MedicalAuditSelection struct {
	PeriodID   string `json:"periodId"`
	ClaimID    string `json:"claimId"`
	Version    int    `json:"version"`
	ResultHash string `json:"resultHash"`
	Digest     string `json:"digest"`
	RateBps    int    `json:"rateBps"`
	Selected   bool   `json:"selected"`
}

func (c *Contract) ReadMedicalAuditPeriod(ctx contractapi.TransactionContextInterface, id string) (*MedicalAuditPeriod, error) {
	return getState[MedicalAuditPeriod](ctx, "medicalAuditPeriod", id)
}

func (c *Contract) CommitMedicalAuditPeriod(ctx contractapi.TransactionContextInterface, id, start, end string, rateBps int, commitment string) (*MedicalAuditPeriod, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical audit sampling requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
		return nil, err
	}
	if err := validateHash("seedCommitment", commitment); err != nil {
		return nil, err
	}
	from, err := time.Parse(time.RFC3339, start)
	if err != nil {
		return nil, err
	}
	to, err := time.Parse(time.RFC3339, end)
	if err != nil {
		return nil, err
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, err
	}
	if !from.After(txTime.AsTime()) || !to.After(from) || rateBps < 1 || rateBps > 10_000 || !idPattern.MatchString(id) {
		return nil, fmt.Errorf("invalid audit period or sampling rate")
	}
	key, err := stateKey(ctx, "medicalAuditActive", "period")
	if err != nil {
		return nil, err
	}
	active, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if active != nil {
		prior, err := c.ReadMedicalAuditPeriod(ctx, string(active))
		if err != nil {
			return nil, err
		}
		priorEnd, err := time.Parse(time.RFC3339, prior.EndsAt)
		if err != nil || txTime.AsTime().Before(priorEnd) {
			return nil, fmt.Errorf("prior audit period has not ended")
		}
	}
	period := &MedicalAuditPeriod{ID: id, StartsAt: from.UTC().Format(time.RFC3339), EndsAt: to.UTC().Format(time.RFC3339),
		RateBps: rateBps, Commitment: strings.ToLower(commitment)}
	if err := putState(ctx, "medicalAuditPeriod", id, period); err != nil {
		return nil, err
	}
	return period, ctx.GetStub().PutState(key, []byte(id))
}

func (c *Contract) RevealMedicalAuditSeed(ctx contractapi.TransactionContextInterface, id, seed string) (*MedicalAuditPeriod, error) {
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
		return nil, err
	}
	if err := validateHash("seed", seed); err != nil {
		return nil, err
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, id)
	if err != nil {
		return nil, err
	}
	now, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, err
	}
	end, err := time.Parse(time.RFC3339, period.EndsAt)
	if err != nil || now.AsTime().Before(end) || period.Seed != "" {
		return nil, fmt.Errorf("audit seed may be revealed once after the period")
	}
	seed = strings.ToLower(seed)
	if canonicalProtocolHash("fabric-medical-audit-seed-v1", id, seed) != period.Commitment {
		return nil, fmt.Errorf("audit seed does not reproduce the pre-period commitment")
	}
	period.Seed = seed
	return period, overwriteAsset(ctx, "medicalAuditPeriod", id, period)
}

func (c *Contract) medicalAuditPeriodForRequest(ctx contractapi.TransactionContextInterface, now string) (string, error) {
	key, err := stateKey(ctx, "medicalAuditActive", "period")
	if err != nil {
		return "", err
	}
	active, err := ctx.GetStub().GetState(key)
	if err != nil || active == nil {
		return "", err
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, string(active))
	if err != nil {
		return "", err
	}
	at, err := time.Parse(time.RFC3339Nano, now)
	if err != nil {
		return "", err
	}
	start, err := time.Parse(time.RFC3339, period.StartsAt)
	if err != nil {
		return "", err
	}
	end, err := time.Parse(time.RFC3339, period.EndsAt)
	if err != nil {
		return "", err
	}
	if at.Before(start) || !at.Before(end) {
		return "", nil
	}
	return period.ID, nil
}

func medicalAuditSelection(period *MedicalAuditPeriod, request *OracleRequest) MedicalAuditSelection {
	digest := canonicalProtocolHash("fabric-medical-audit-selection-v1", period.Seed, request.ClaimID,
		strconv.Itoa(request.ClaimVersion), request.ResultHash)
	value, _ := strconv.ParseUint(digest[:8], 16, 32)
	return MedicalAuditSelection{PeriodID: period.ID, ClaimID: request.ClaimID, Version: request.ClaimVersion,
		ResultHash: request.ResultHash, Digest: digest, RateBps: period.RateBps, Selected: value*10_000 < uint64(period.RateBps)*(1<<32)}
}

func (c *Contract) ResolveMedicalAuditSelection(ctx contractapi.TransactionContextInterface, claimID string) (*MedicalAuditSelection, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical audit sampling requires dev-lite")
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "MEDICAL_AUDIT_PENDING" {
		return nil, fmt.Errorf("claim does not await audit selection")
	}
	request, err := c.ReadOracleRequest(ctx, claim.CurrentOracleRequestID)
	if err != nil {
		return nil, err
	}
	if request.ClaimID != claimID || request.ClaimVersion != claim.Version || request.Status != "CONSENSUS" ||
		!request.VerifiedResult || request.ResultHash != claim.OracleResultHash {
		return nil, fmt.Errorf("current audit result is unavailable")
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, request.AuditPeriodID)
	if err != nil {
		return nil, err
	}
	if period.Seed == "" {
		return nil, fmt.Errorf("audit seed has not been revealed")
	}
	selection := medicalAuditSelection(period, request)
	if err := putState(ctx, "medicalAuditSelection", medicalRevisionKey(claim.ID, claim.Version), &selection); err != nil {
		return nil, err
	}
	held, err := c.heldMedicalRequest(ctx, request)
	if err != nil {
		return nil, err
	}
	claim.Status = "APPROVED"
	if selection.Selected || requiresMedicalPanel(claim) || held {
		claim.Status = "MEDICAL_REVIEW_REQUIRED"
		if held {
			claim.MedicalHeldReleaseID = effectiveMedicalModelReleaseID(request)
		}
	} else if err := c.recordMedicalApproval(ctx, claim, request, nil); err != nil {
		return nil, err
	}
	claim.UpdatedAt, err = timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return &selection, emit(ctx, "MedicalAuditSelectionResolved", &selection)
}
