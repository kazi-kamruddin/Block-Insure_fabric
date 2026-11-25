package insurance

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

var auditShareMSPs = []string{"AuditorMSP", "HospitalMSP", "InsurerMSP"}

type MedicalAuditCandidate struct {
	ClaimID             string `json:"claimId"`
	Version             int    `json:"version"`
	EpisodeRevisionHash string `json:"episodeRevisionHash"`
}

type MedicalAuditShare struct {
	MSP        string `json:"msp"`
	Commitment string `json:"commitment"`
	Share      string `json:"share,omitempty" metadata:",optional"`
}

func medicalAuditActor(ctx contractapi.TransactionContextInterface) (string, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return "", err
	}
	if (msp == "AuditorMSP" && role == "auditor") || (msp == "HospitalMSP" && role == "hospitalOfficer") ||
		(msp == "InsurerMSP" && role == "insurerAdmin") {
		return msp, nil
	}
	return "", fmt.Errorf("audit periods require an Insurer, Auditor or Hospital role")
}

func (c *Contract) CreateMedicalAuditPeriod(ctx contractapi.TransactionContextInterface, id, start, end string, rateBps, graceSeconds int) (*MedicalAuditPeriod, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical audit sampling requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	from, startErr := time.Parse(time.RFC3339, start)
	to, endErr := time.Parse(time.RFC3339, end)
	duration := to.Sub(from)
	if startErr != nil || endErr != nil || !from.After(now) || duration < time.Minute || duration > 31*24*time.Hour ||
		graceSeconds < 60 || graceSeconds > 7*24*60*60 || rateBps < 1 || rateBps > 10_000 || !idPattern.MatchString(id) {
		return nil, fmt.Errorf("invalid audit period, grace duration or sampling rate")
	}
	key, err := stateKey(ctx, "medicalAuditActive", "period")
	if err != nil {
		return nil, err
	}
	previous, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if previous != nil {
		prior, err := c.ReadMedicalAuditPeriod(ctx, string(previous))
		if err != nil {
			return nil, err
		}
		if prior.Status != "FINALIZED" && prior.Status != "AUDIT_SEED_DEFAULTED" && prior.Status != "CANCELLED" &&
			!(prior.Status == "" && prior.Seed != "") {
			return nil, fmt.Errorf("prior audit period has not been resolved")
		}
	}
	period := &MedicalAuditPeriod{ID: id, StartsAt: from.Format(time.RFC3339), EndsAt: to.Format(time.RFC3339), RateBps: rateBps,
		GraceEndsAt: to.Add(time.Duration(graceSeconds) * time.Second).Format(time.RFC3339), Status: "PROPOSED"}
	if err := putState(ctx, "medicalAuditPeriod", id, period); err != nil {
		return nil, err
	}
	return period, ctx.GetStub().PutState(key, []byte(id))
}

func (c *Contract) CommitMedicalAuditSeedShare(ctx contractapi.TransactionContextInterface, id, commitment string) (*MedicalAuditPeriod, error) {
	msp, err := medicalAuditActor(ctx)
	if err != nil {
		return nil, err
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, id)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	start, err := time.Parse(time.RFC3339, period.StartsAt)
	if err != nil || period.Status != "PROPOSED" || !now.Before(start) || !oracleV2Hash.MatchString(commitment) {
		return nil, fmt.Errorf("a valid seed commitment is required before the audit period starts")
	}
	if slices.ContainsFunc(period.Shares, func(share MedicalAuditShare) bool { return share.MSP == msp }) {
		return nil, fmt.Errorf("this MSP already committed a share")
	}
	period.Shares = append(period.Shares, MedicalAuditShare{MSP: msp, Commitment: commitment})
	slices.SortFunc(period.Shares, func(a, b MedicalAuditShare) int {
		return slices.Index(auditShareMSPs, a.MSP) - slices.Index(auditShareMSPs, b.MSP)
	})
	return period, overwriteAsset(ctx, "medicalAuditPeriod", id, period)
}

func (c *Contract) OpenMedicalAuditPeriod(ctx contractapi.TransactionContextInterface, id string) (*MedicalAuditPeriod, error) {
	if _, err := medicalAuditActor(ctx); err != nil {
		return nil, err
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, id)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	start, startErr := time.Parse(time.RFC3339, period.StartsAt)
	end, endErr := time.Parse(time.RFC3339, period.EndsAt)
	if period.Status != "PROPOSED" || len(period.Shares) != len(auditShareMSPs) || startErr != nil || endErr != nil ||
		now.Before(start) || !now.Before(end) {
		return nil, fmt.Errorf("opening requires three prior commitments and a current audit window")
	}
	claims, err := listState[Claim](ctx, "claim")
	if err != nil {
		return nil, err
	}
	for _, claim := range claims {
		if claim.EpisodeID == "" || claim.CurrentOracleRequestID != "" ||
			(claim.Status != "SUBMITTED" && claim.Status != "APPEAL_SUBMITTED") || requiresMedicalPanel(&claim) {
			continue
		}
		head, err := medicalEpisodeHead(ctx, claim.EpisodeID)
		if err != nil {
			return nil, err
		}
		if head.Revision != claim.EpisodeRevision {
			continue
		}
		pin, err := stateKey(ctx, "medicalAuditFrozenPeriod", medicalRevisionKey(claim.ID, claim.Version))
		if err != nil {
			return nil, err
		}
		previous, err := ctx.GetStub().GetState(pin)
		if err != nil {
			return nil, err
		}
		if len(previous) != 0 {
			continue
		}
		if err := ctx.GetStub().PutState(pin, []byte(period.ID)); err != nil {
			return nil, err
		}
		period.Eligible = append(period.Eligible, MedicalAuditCandidate{ClaimID: claim.ID, Version: claim.Version, EpisodeRevisionHash: head.RevisionHash})
	}
	period.Status = "OPEN"
	if err := overwriteAsset(ctx, "medicalAuditPeriod", id, period); err != nil {
		return nil, err
	}
	return period, emit(ctx, "MedicalAuditPeriodOpened", period)
}

func (c *Contract) RevealMedicalAuditSeedShare(ctx contractapi.TransactionContextInterface, id, share string) (*MedicalAuditPeriod, error) {
	msp, err := medicalAuditActor(ctx)
	if err != nil {
		return nil, err
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, id)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	start, startErr := time.Parse(time.RFC3339, period.EndsAt)
	end, endErr := time.Parse(time.RFC3339, period.GraceEndsAt)
	if period.Status != "OPEN" || startErr != nil || endErr != nil || now.Before(start) || !now.Before(end) || !oracleV2Hash.MatchString(share) {
		return nil, fmt.Errorf("a valid seed share is required in the reveal window")
	}
	index := slices.IndexFunc(period.Shares, func(record MedicalAuditShare) bool { return record.MSP == msp })
	if index < 0 || period.Shares[index].Share != "" ||
		period.Shares[index].Commitment != canonicalProtocolHash("fabric-medical-audit-share-v2", id, msp, share) {
		return nil, fmt.Errorf("seed share does not match an unrevealed MSP commitment")
	}
	period.Shares[index].Share = share
	return period, overwriteAsset(ctx, "medicalAuditPeriod", id, period)
}

func (c *Contract) FinalizeMedicalAuditPeriod(ctx contractapi.TransactionContextInterface, id string) (*MedicalAuditPeriod, error) {
	if _, err := medicalAuditActor(ctx); err != nil {
		return nil, err
	}
	period, err := c.ReadMedicalAuditPeriod(ctx, id)
	if err != nil {
		return nil, err
	}
	if period.Status == "FINALIZED" || period.Status == "AUDIT_SEED_DEFAULTED" || period.Status == "CANCELLED" {
		return period, nil
	}
	if err := finalizeMedicalAuditSeed(ctx, period); err != nil {
		return nil, err
	}
	return period, emit(ctx, "MedicalAuditPeriodResolved", period)
}

func finalizeMedicalAuditSeed(ctx contractapi.TransactionContextInterface, period *MedicalAuditPeriod) error {
	if period.Status != "OPEN" && period.Status != "PROPOSED" {
		return fmt.Errorf("audit period is not eligible for finalization")
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return err
	}
	end, err := time.Parse(time.RFC3339, period.EndsAt)
	if err != nil || now.Before(end) {
		return fmt.Errorf("audit period has not ended")
	}
	shares := make([]string, 0, len(auditShareMSPs))
	for _, record := range period.Shares {
		if record.Share != "" {
			shares = append(shares, record.Share)
		}
	}
	if period.Status == "PROPOSED" {
		period.Status = "CANCELLED"
	} else if len(shares) == len(auditShareMSPs) {
		period.Status = "FINALIZED"
		period.Seed = canonicalProtocolHash("fabric-medical-audit-combined-seed-v2", shares...)
	} else {
		grace, err := time.Parse(time.RFC3339, period.GraceEndsAt)
		if err != nil || now.Before(grace) {
			return fmt.Errorf("audit seed reveal grace remains active")
		}
		period.Status, period.PanelLoad = "AUDIT_SEED_DEFAULTED", len(period.Eligible)
	}
	return overwriteAsset(ctx, "medicalAuditPeriod", period.ID, period)
}

func medicalAuditCandidate(period *MedicalAuditPeriod, claim *Claim) *MedicalAuditCandidate {
	for _, candidate := range period.Eligible {
		if candidate.ClaimID == claim.ID && candidate.Version == claim.Version {
			return &candidate
		}
	}
	return nil
}

func (c *Contract) ReadMedicalAuditSelection(ctx contractapi.TransactionContextInterface, claimID string, version int) (*MedicalAuditSelection, error) {
	return getState[MedicalAuditSelection](ctx, "medicalAuditSelection", medicalRevisionKey(claimID, version))
}

func (c *Contract) resolveMedicalAuditSelectionV2(ctx contractapi.TransactionContextInterface, period *MedicalAuditPeriod, claim *Claim) (*MedicalAuditSelection, error) {
	if period.Status == "OPEN" {
		if err := finalizeMedicalAuditSeed(ctx, period); err != nil {
			return nil, err
		}
	}
	candidate := medicalAuditCandidate(period, claim)
	if candidate == nil || (period.Status != "FINALIZED" && period.Status != "AUDIT_SEED_DEFAULTED") {
		return nil, fmt.Errorf("frozen claim version and finalized audit period required")
	}
	head, err := currentMedicalHead(ctx, claim)
	if err != nil || candidate.EpisodeRevisionHash != head.RevisionHash {
		return nil, fmt.Errorf("episode revision does not match the frozen audit input")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	record := &MedicalAuditSelection{PeriodID: period.ID, ClaimID: claim.ID, Version: claim.Version, EpisodeRevisionHash: candidate.EpisodeRevisionHash,
		RateBps: period.RateBps, Status: period.Status, ResolvedAt: now}
	if period.Status == "AUDIT_SEED_DEFAULTED" {
		record.Selected = true
	} else {
		key, err := hex.DecodeString(period.Seed)
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("invalid combined audit seed")
		}
		h := hmac.New(sha256.New, key)
		fmt.Fprintf(h, "fabric-medical-audit-selection-v2|%d:%s|%d:%d|%d:%s", len(claim.ID), claim.ID,
			len(strconv.Itoa(claim.Version)), claim.Version, len(candidate.EpisodeRevisionHash), candidate.EpisodeRevisionHash)
		record.Digest = hex.EncodeToString(h.Sum(nil))
		value, _ := strconv.ParseUint(record.Digest[:8], 16, 32)
		record.Selected = value*10_000 < uint64(period.RateBps)*(1<<32)
	}
	record.Hash = medicalSamplingRecordHash(record)
	return record, nil
}
