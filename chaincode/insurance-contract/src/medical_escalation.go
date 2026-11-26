package insurance

import (
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalEscalationDelay = 24 * time.Hour

func (c *Contract) ReadMedicalClaimEscalationDeadline(ctx contractapi.TransactionContextInterface, claimID string) (string, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return "", nil
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil || !canEscalateMedicalClaim(claim) {
		return "", err
	}
	request, err := c.medicalApprovalRequest(ctx, claim)
	if err != nil {
		return "", err
	}
	due, _, err := c.medicalEscalationDue(ctx, claim, request)
	if err != nil {
		return "", err
	}
	return due.Format(time.RFC3339Nano), nil
}

func canEscalateMedicalClaim(claim *Claim) bool {
	if claim == nil || claim.EpisodeID == "" || claim.MedicalEscalatedAt != "" || claim.CurrentReviewID != "" {
		return false
	}
	switch claim.Status {
	case "SUBMITTED", "APPEAL_SUBMITTED", "ORACLE_PENDING", "ORACLE_FAILED", "MEDICAL_REVIEW_REQUIRED", "MEDICAL_AUDIT_PENDING":
		return true
	default:
		return false
	}
}

func (c *Contract) EscalateStalledMedicalClaim(ctx contractapi.TransactionContextInterface, claimID string) (*ClaimReview, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("escalation requires the medical development channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	owner, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.ClaimantID != owner || !canEscalateMedicalClaim(claim) {
		return nil, fmt.Errorf("claim is not eligible for escalation")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	current, err := time.Parse(time.RFC3339Nano, now)
	if err != nil {
		return nil, err
	}
	request, err := c.medicalApprovalRequest(ctx, claim)
	if err != nil {
		return nil, err
	}
	due, auditPeriod, err := c.medicalEscalationDue(ctx, claim, request)
	if err != nil {
		return nil, err
	}
	if current.Before(due) {
		return nil, fmt.Errorf("escalation deadline has not elapsed")
	}
	if auditPeriod != nil {
		selection, err := c.resolveMedicalAuditSelectionV2(ctx, auditPeriod, claim)
		if err != nil {
			return nil, err
		}
		if err := putState(ctx, "medicalAuditSelection", medicalRevisionKey(claim.ID, claim.Version), selection); err != nil {
			return nil, err
		}
	}
	if _, err := c.requireXGBoostEvidence(ctx, claim); err != nil {
		return nil, err
	}
	panel, err := c.medicalReviewPanel(ctx, claim)
	if err != nil {
		return nil, err
	}
	if request != nil && request.Status == "PENDING" {
		if err := c.finalizeOracleRequest(ctx, request, claim, false, "", "ESCALATED_TIMEOUT", now); err != nil {
			return nil, err
		}
	}
	claim.MedicalEscalatedAt = now
	return c.createMedicalPreparation(ctx, claim, medicalRevisionKey(claim.ID, claim.Version), "", panel, false, "")
}

func (c *Contract) medicalEscalationDue(ctx contractapi.TransactionContextInterface, claim *Claim, request *OracleRequest) (time.Time, *MedicalAuditPeriod, error) {
	if request != nil {
		if request.ClaimVersion != claim.Version {
			return time.Time{}, nil, fmt.Errorf("current Oracle request required")
		}
		if request.Status == "PENDING" {
			reveal, err := time.Parse(time.RFC3339Nano, request.RevealDeadline)
			return reveal.Add(time.Second), nil, err
		}
		if claim.Status == "MEDICAL_AUDIT_PENDING" && request.AuditPeriodID != "" {
			period, err := c.ReadMedicalAuditPeriod(ctx, request.AuditPeriodID)
			if err != nil {
				return time.Time{}, nil, err
			}
			if period.GraceEndsAt != "" {
				due, err := time.Parse(time.RFC3339Nano, period.GraceEndsAt)
				return due, period, err
			}
		}
		if request.TimingProfile != "" {
			start, err := time.Parse(time.RFC3339Nano, request.FinalizedAt)
			return start.Add(timingWaits(request.TimingProfile).escalation), nil, err
		}
	} else if claim.MedicalEscalationEligibleAt != "" {
		due, err := time.Parse(time.RFC3339Nano, claim.MedicalEscalationEligibleAt)
		return due, nil, err
	}
	start, err := time.Parse(time.RFC3339Nano, claim.UpdatedAt)
	return start.Add(medicalEscalationDelay), nil, err
}
