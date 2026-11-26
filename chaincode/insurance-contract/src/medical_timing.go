package insurance

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const (
	medicalTimingReal   = "REAL"
	medicalTimingDemo   = "DEMO"
	medicalTimingAsset  = "medicalTimingProfile"
	medicalTimingActive = "active"
)

type medicalProtocolWaits struct {
	commit, reveal, activation, escalation            time.Duration
	replacement, escalationPrepare, appeal            time.Duration
	reviewMin, reviewMax, prepareDefault, voteDefault time.Duration
}

func timingWaits(profile string) medicalProtocolWaits {
	if profile == medicalTimingDemo {
		return medicalProtocolWaits{
			commit: 15 * time.Second, reveal: 30 * time.Second, activation: 30 * time.Second,
			escalation: 2 * time.Minute, replacement: 30 * time.Second, escalationPrepare: 10 * time.Minute,
			appeal: 30 * time.Minute, reviewMin: 15 * time.Second, reviewMax: 20 * time.Minute,
			prepareDefault: 3 * time.Minute, voteDefault: 2 * time.Minute,
		}
	}
	return medicalProtocolWaits{
		commit: oracleV2CommitWindow, reveal: oracleV2RevealWindow, activation: medicalReleaseActivationDelay,
		escalation: medicalEscalationDelay, replacement: 5 * time.Minute, escalationPrepare: 7 * 24 * time.Hour,
		appeal: medicalAppealWindow, reviewMin: time.Minute, reviewMax: 14 * 24 * time.Hour,
		prepareDefault: 48 * time.Hour, voteDefault: 24 * time.Hour,
	}
}

type MedicalTimingProfile struct {
	ID            string `json:"id"`
	Profile       string `json:"profile"`
	Revision      int    `json:"revision"`
	ActivatedAt   string `json:"activatedAt"`
	TransactionID string `json:"transactionId"`
}

type MedicalTimingProposal struct {
	ID           string `json:"id"`
	Profile      string `json:"profile"`
	BaseRevision int    `json:"baseRevision"`
}

func (c *Contract) ReadMedicalTimingProfile(ctx contractapi.TransactionContextInterface) (*MedicalTimingProfile, error) {
	defaults := &MedicalTimingProfile{ID: medicalTimingActive, Profile: medicalTimingReal}
	if !usesMedicalApprovalCertificates(ctx) {
		return defaults, nil
	}
	key, err := stateKey(ctx, medicalTimingAsset, medicalTimingActive)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return defaults, nil
	}
	var profile MedicalTimingProfile
	if err := json.Unmarshal(raw, &profile); err != nil {
		return nil, err
	}
	if profile.Profile != medicalTimingDemo && profile.Profile != medicalTimingReal {
		return nil, fmt.Errorf("invalid active medical timing profile")
	}
	return &profile, nil
}

func (c *Contract) ProposeMedicalTimingProfile(ctx contractapi.TransactionContextInterface, id, profile string) (*MedicalTimingProposal, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical timing governance requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if profile != medicalTimingDemo && profile != medicalTimingReal {
		return nil, fmt.Errorf("medical timing profile must be REAL or DEMO")
	}
	active, err := c.ReadMedicalTimingProfile(ctx)
	if err != nil {
		return nil, err
	}
	if active.Profile == profile {
		return nil, fmt.Errorf("medical timing profile is already active")
	}
	proposal := &MedicalTimingProposal{ID: id, Profile: profile, BaseRevision: active.Revision}
	if err := putState(ctx, "medicalTimingProposal", id, proposal); err != nil {
		return nil, err
	}
	return proposal, emit(ctx, "MedicalTimingProfileProposed", proposal)
}

func (c *Contract) ApproveMedicalTimingProfile(ctx contractapi.TransactionContextInterface, id string) (*MedicalTimingProfile, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical timing governance requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
		return nil, err
	}
	proposal, err := getState[MedicalTimingProposal](ctx, "medicalTimingProposal", id)
	if err != nil {
		return nil, err
	}
	active, err := c.ReadMedicalTimingProfile(ctx)
	if err != nil {
		return nil, err
	}
	if proposal.BaseRevision != active.Revision {
		return nil, fmt.Errorf("medical timing proposal is stale")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	profile := &MedicalTimingProfile{ID: id, Profile: proposal.Profile, Revision: active.Revision + 1, ActivatedAt: now, TransactionID: ctx.GetStub().GetTxID()}
	if err := overwriteAsset(ctx, medicalTimingAsset, medicalTimingActive, profile); err != nil {
		return nil, err
	}
	return profile, emit(ctx, "MedicalTimingProfileActivated", profile)
}

func (c *Contract) setInitialMedicalEscalation(ctx contractapi.TransactionContextInterface, claim *Claim, timestamp string) error {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil
	}
	profile, err := c.ReadMedicalTimingProfile(ctx)
	if err != nil {
		return err
	}
	due, err := afterMedicalWait(timestamp, timingWaits(profile.Profile).escalation)
	if err != nil {
		return err
	}
	claim.MedicalEscalationEligibleAt = due
	return nil
}

func afterMedicalWait(timestamp string, wait time.Duration) (string, error) {
	start, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return "", err
	}
	return start.Add(wait).Format(time.RFC3339Nano), nil
}
