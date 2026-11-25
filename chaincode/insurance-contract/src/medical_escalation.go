package insurance

import (
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalEscalationDelay = 24 * time.Hour

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
	if claim.ClaimantID != owner || claim.EpisodeID == "" || claim.MedicalEscalatedAt != "" || claim.CurrentReviewID != "" ||
		(claim.Status != "SUBMITTED" && claim.Status != "APPEAL_SUBMITTED" && claim.Status != "ORACLE_PENDING" &&
			claim.Status != "ORACLE_FAILED" && claim.Status != "MEDICAL_REVIEW_REQUIRED" && claim.Status != "MEDICAL_AUDIT_PENDING") {
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
	start, err := time.Parse(time.RFC3339Nano, claim.UpdatedAt)
	if err != nil {
		return nil, err
	}
	due := start.Add(medicalEscalationDelay)
	request, err := c.medicalApprovalRequest(ctx, claim)
	if err != nil {
		return nil, err
	}
	if request != nil && request.ClaimVersion != claim.Version {
		return nil, fmt.Errorf("current Oracle request required")
	}
	var auditPeriod *MedicalAuditPeriod
	if claim.Status == "MEDICAL_AUDIT_PENDING" && request != nil && request.AuditPeriodID != "" {
		period, err := c.ReadMedicalAuditPeriod(ctx, request.AuditPeriodID)
		if err != nil {
			return nil, err
		}
		if period.GraceEndsAt != "" {
			due, err = time.Parse(time.RFC3339Nano, period.GraceEndsAt)
			if err != nil {
				return nil, err
			}
			auditPeriod = period
		}
	}
	if request != nil && request.Status == "PENDING" {
		due, err = time.Parse(time.RFC3339Nano, request.RevealDeadline)
		if err != nil {
			return nil, err
		}
		due = due.Add(time.Second)
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
	return c.createMedicalPreparation(ctx, claim, medicalRevisionKey(claim.ID, claim.Version), current.Add(7*24*time.Hour).Format(time.RFC3339), panel, false, "")
}
