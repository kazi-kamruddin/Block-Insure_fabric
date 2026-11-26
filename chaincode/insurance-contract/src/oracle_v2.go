package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const oracleV2CommitWindow = 60 * time.Second
const oracleV2RevealWindow = 120 * time.Second

type MedicalOracleProtocol struct {
	ProtocolVersion string `json:"protocolVersion"`
}

func (c *Contract) ReadMedicalOracleProtocol(ctx contractapi.TransactionContextInterface) (*MedicalOracleProtocol, error) {
	if usesMedicalApprovalCertificates(ctx) {
		return &MedicalOracleProtocol{ProtocolVersion: "v2"}, nil
	}
	return &MedicalOracleProtocol{ProtocolVersion: "v1"}, nil
}

func (c *Contract) RequestOracleVerificationV2(ctx contractapi.TransactionContextInterface, requestID, claimID string) (*OracleRequest, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("Oracle v2 requires the dev-lite medical channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.EpisodeID == "" || !slices.Contains([]string{"SUBMITTED", "APPEAL_SUBMITTED"}, claim.Status) {
		return nil, fmt.Errorf("claim is not awaiting medical verification")
	}
	episode, err := readMedicalEpisode(ctx, claim.EpisodeID, claim.EpisodeRevision)
	if err != nil {
		return nil, err
	}
	if episode.Service != "DIAGNOSTIC" {
		return nil, fmt.Errorf("Oracle v2 supports DIAGNOSTIC medical claims")
	}
	if episode.InvoiceDate == "" {
		return nil, fmt.Errorf("Oracle v2 requires a dated invoice")
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	profile, err := c.ReadMedicalTimingProfile(ctx)
	if err != nil {
		return nil, err
	}
	waits := timingWaits(profile.Profile)
	manifest, manifestHash, err := buildOracleV2Manifest(ctx, claim.HospitalID, now)
	if err != nil {
		return nil, err
	}
	roster, err := c.ReadActiveOracleRoster(ctx)
	if err != nil {
		return nil, err
	}
	if roster.Status != "ACTIVE" || len(roster.Subjects) != 3 || roster.RequiredConfirmations != 2 {
		return nil, fmt.Errorf("medical Oracle roster requires exactly three subjects and two confirmations")
	}
	assignments := make([]string, 0, 3)
	valid := 0
	for _, subject := range roster.Subjects {
		revoked, err := oracleSubjectRevoked(ctx, subject)
		if err != nil {
			return nil, err
		}
		if !revoked {
			valid++
		}
		assignments = append(assignments, subject.SubjectID)
	}
	if valid < 2 {
		return nil, fmt.Errorf("active medical Oracle roster has fewer than two eligible subjects")
	}
	release, err := c.requireActiveMedicalV2Release(ctx)
	if err != nil {
		return nil, err
	}
	verification, err := c.bindMedicalOracle(ctx, claim, requestID)
	if err != nil {
		return nil, err
	}
	request := &OracleRequest{
		AssetType: "oracleRequest", SchemaVersion: SchemaVersion, ID: requestID, ClaimID: claimID, ClaimVersion: claim.Version,
		HospitalVerificationID: verification.ID, QueryHash: oracleQueryHash(claim, verification), ProtocolVersion: "v2",
		Manifest: manifest, ManifestHash: manifestHash, PolicyVersion: oracleV2Policy, RosterVersion: roster.Version,
		ModelVersion: release.ModelVersion, ModelHash: release.ArtifactHash, ModelReleaseID: release.ID,
		AssignedOracleIDs: assignments, RequiredConfirmations: 2, ExpectedResponses: 3, Status: "PENDING", RequestedAt: manifest.RequestedAt,
		TimingProfile: profile.Profile, CommitDeadline: now.Add(waits.commit).Format(time.RFC3339Nano),
		RevealDeadline: now.Add(waits.commit + waits.reveal).Format(time.RFC3339Nano),
	}
	if release.ModelVersion == medicalModelE3 {
		if episode.DigestVersion != 2 {
			return nil, fmt.Errorf("E3 requires a nonce-bound current medical episode revision")
		}
		key, err := getState[MedicalPatientTokenEpoch](ctx, "medicalPatientTokenKeyVersion", patientTokenEpoch)
		if err != nil || key.Version < 1 {
			return nil, fmt.Errorf("E3 requires an initialized patient token key")
		}
		request.PatientTokenKeyVersion = key.Version
	}
	if claim.Status == "APPEAL_SUBMITTED" {
		appeal, err := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
		if err != nil {
			return nil, err
		}
		if appeal.ClaimVersion != claim.Version || appeal.CommitmentHash == "" || appeal.CommitmentHash != appealCommitmentHash(appeal) {
			return nil, fmt.Errorf("medical appeal commitment is out of date")
		}
		request.AppealID, request.AppealCommitmentHash = appeal.ID, appeal.CommitmentHash
		appeal.HospitalVerificationID, appeal.Status = verification.ID, "ORACLE_PENDING"
		if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
			return nil, err
		}
	}
	request.AuditPeriodID, err = c.medicalAuditPeriodForRequest(ctx, claim, request.RequestedAt)
	if err != nil {
		return nil, err
	}
	if err := putState(ctx, "oracleRequest", requestID, request); err != nil {
		return nil, err
	}
	claim.CurrentOracleRequestID, claim.OracleOutcome, claim.OracleResultHash = requestID, "PENDING", ""
	claim.Status, claim.UpdatedAt = "ORACLE_PENDING", request.RequestedAt
	if err := overwriteAsset(ctx, "claim", claimID, claim); err != nil {
		return nil, err
	}
	return request, emit(ctx, "OracleVerificationRequested", request)
}

func (c *Contract) currentOracleV2Request(ctx contractapi.TransactionContextInterface, requestID, subject string) (*OracleRequest, *Claim, error) {
	request, err := c.ReadOracleRequest(ctx, requestID)
	if err != nil {
		return nil, nil, err
	}
	if request.ProtocolVersion != "v2" || request.Status != "PENDING" || !containsOracleAssignment(request.AssignedOracleIDs, subject) {
		return nil, nil, fmt.Errorf("Oracle v2 request is unavailable for this subject")
	}
	if err := requireOracleRosterSubject(ctx, request.RosterVersion, subject); err != nil {
		return nil, nil, err
	}
	if err := c.requireUsableMedicalRelease(ctx, request); err != nil {
		return nil, nil, err
	}
	claim, err := c.ReadClaim(ctx, request.ClaimID)
	if err != nil {
		return nil, nil, err
	}
	if claim.Status != "ORACLE_PENDING" || claim.Version != request.ClaimVersion || claim.CurrentOracleRequestID != request.ID {
		return nil, nil, fmt.Errorf("Oracle v2 request is stale")
	}
	return request, claim, nil
}

func (c *Contract) SubmitOracleCommitmentV2(ctx contractapi.TransactionContextInterface, requestID, commitmentHash string) (*OracleCommitment, error) {
	identity, subject, err := requireOracleIdentity(ctx)
	if err != nil {
		return nil, err
	}
	if !oracleV2Hash.MatchString(commitmentHash) {
		return nil, fmt.Errorf("invalid Oracle v2 commitment hash")
	}
	request, _, err := c.currentOracleV2Request(ctx, requestID, subject)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	deadline, err := time.Parse(time.RFC3339Nano, request.CommitDeadline)
	// The first reveal closes the commit phase in ledger state. The ±15 s
	// timestamp tolerance can then never admit a commitment chosen after
	// another subject's fact vector became public. CommitmentCount++ below
	// writes the same request key, so MVCC serializes a racing reveal.
	if err != nil || now.After(deadline) || request.RevealCount > 0 {
		return nil, fmt.Errorf("Oracle commit phase has ended")
	}
	key, err := ctx.GetStub().CreateCompositeKey("oracleCommitmentHash", []string{requestID, commitmentHash})
	if err != nil {
		return nil, err
	}
	used, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if len(used) > 0 {
		return nil, fmt.Errorf("commitment digest already submitted for this request")
	}
	commitment := &OracleCommitment{
		AssetType: "oracleCommitment", SchemaVersion: SchemaVersion, ID: oracleSubmissionID(requestID, subject),
		RequestID: requestID, ClaimID: request.ClaimID, ClaimVersion: request.ClaimVersion, OracleID: subject, OracleIdentity: identity,
		CommitmentHash: commitmentHash, CreatedAt: now.Format(time.RFC3339Nano),
	}
	if err := putState(ctx, "oracleCommitment", commitment.ID, commitment); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(key, []byte(subject)); err != nil {
		return nil, err
	}
	request.CommitmentCount++
	if err := overwriteAsset(ctx, "oracleRequest", requestID, request); err != nil {
		return nil, err
	}
	return commitment, emit(ctx, "OracleCommitmentSubmitted", commitment)
}

func (c *Contract) RevealOracleResultV2(ctx contractapi.TransactionContextInterface, requestID, encoded, decision, salt, diagnosticsHash string) (*OracleResult, error) {
	identity, subject, err := requireOracleIdentity(ctx)
	if err != nil {
		return nil, err
	}
	request, claim, err := c.currentOracleV2Request(ctx, requestID, subject)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	commitBy, e1 := time.Parse(time.RFC3339Nano, request.CommitDeadline)
	revealBy, e2 := time.Parse(time.RFC3339Nano, request.RevealDeadline)
	if e1 != nil || e2 != nil || now.After(revealBy) || (request.CommitmentCount < request.ExpectedResponses && !now.After(commitBy)) {
		return nil, fmt.Errorf("Oracle v2 reveal phase is closed")
	}
	if !oracleV2Hash.MatchString(diagnosticsHash) {
		return nil, fmt.Errorf("invalid worker diagnostics hash")
	}
	vector, err := parseOracleV2FactVector(encoded)
	if err != nil {
		return nil, err
	}
	if vector.ClaimID != claim.ID || vector.ClaimVersion != claim.Version || vector.ManifestHash != request.ManifestHash || vector.PolicyVersion != request.PolicyVersion {
		return nil, fmt.Errorf("Oracle v2 fact vector does not match pinned request")
	}
	derived, err := oracleV2Decision(vector)
	if err != nil || decision != derived {
		return nil, fmt.Errorf("Oracle v2 decision does not match facts")
	}
	hash := oracleV2FactVectorHash(encoded)
	expected, err := oracleV2Commitment(ctx.GetStub().GetChannelID(), requestID, claim.Version, subject, hash, decision, salt)
	if err != nil {
		return nil, err
	}
	commitment, err := c.ReadOracleCommitment(ctx, oracleSubmissionID(requestID, subject))
	if err != nil || commitment.CommitmentHash != expected || commitment.OracleIdentity != identity {
		return nil, fmt.Errorf("Oracle v2 reveal does not match the subject's commitment")
	}
	verified := decision == "AUTO_APPROVE"
	if verified {
		if _, err := currentMedicalHead(ctx, claim); err != nil {
			return nil, err
		}
	}
	result := &OracleResult{
		AssetType: "oracleResult", SchemaVersion: SchemaVersion, ID: oracleSubmissionID(requestID, subject),
		RequestID: requestID, ClaimID: claim.ID, ClaimVersion: claim.Version, OracleID: subject, OracleIdentity: identity,
		ModelVersion: request.ModelVersion, Verified: verified, VerificationCode: "V2:" + decision + ":" + hash, ResultHash: hash,
		ProtocolVersion: "v2", WorkerDiagnosticsHash: diagnosticsHash, FactVectorJSON: encoded, Decision: decision, CreatedAt: now.Format(time.RFC3339Nano),
	}
	if err := putState(ctx, "oracleResult", result.ID, result); err != nil {
		return nil, err
	}
	request.RevealCount++
	roster, err := c.ReadOracleRoster(ctx, request.RosterVersion)
	if err != nil {
		return nil, err
	}
	matching := 1
	for _, other := range roster.Subjects {
		if other.SubjectID == subject {
			continue
		}
		revoked, err := oracleSubjectRevoked(ctx, other)
		if err != nil {
			return nil, err
		}
		if revoked {
			continue
		}
		key, err := stateKey(ctx, "oracleResult", oracleSubmissionID(requestID, other.SubjectID))
		if err != nil {
			return nil, err
		}
		raw, err := ctx.GetStub().GetState(key)
		if err != nil {
			return nil, err
		}
		if len(raw) == 0 {
			continue
		}
		var prior OracleResult
		if err := json.Unmarshal(raw, &prior); err != nil {
			return nil, err
		}
		if prior.ProtocolVersion == "v2" && prior.RequestID == requestID && prior.FactVectorJSON == encoded && prior.Decision == decision {
			matching++
		}
	}
	if matching >= request.RequiredConfirmations {
		request.FactVectorHash, request.Decision, request.FactVectorJSON = hash, decision, encoded
		err = c.finalizeOracleRequest(ctx, request, claim, verified, hash, result.VerificationCode, result.CreatedAt)
	} else if request.RevealCount == request.ExpectedResponses {
		err = c.finalizeOracleRequest(ctx, request, claim, false, "", "CONFLICT", result.CreatedAt)
	} else {
		err = overwriteAsset(ctx, "oracleRequest", requestID, request)
	}
	if err != nil {
		return nil, err
	}
	if request.Status != "PENDING" {
		return result, emit(ctx, "OracleRequestFinalized", request)
	}
	return result, emit(ctx, "OracleResultRevealed", result)
}

func requireEligibleClaimDeadlineActor(ctx contractapi.TransactionContextInterface, claim *Claim, assignedAuditorIDs []string) error {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return err
	}
	if msp == "InsurerMSP" && role == "insurerAdmin" {
		return nil
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return err
	}
	if (msp == "InsurerMSP" && role == "policyholder" && subject == claim.ClaimantID) ||
		(msp == "AuditorMSP" && role == "auditor" && slices.Contains(assignedAuditorIDs, subject)) {
		return nil
	}
	return fmt.Errorf("only the claimant, insurer or assigned auditor may act after the deadline")
}
