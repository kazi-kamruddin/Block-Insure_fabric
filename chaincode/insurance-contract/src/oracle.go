package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const (
	oracleProtocolVersion       = "block-insure-oracle-v1"
	oracleRequiredConfirmations = 2
)

var oracleVerificationCodes = map[string]bool{
	"VERIFIED":                  true,
	"SNAPSHOT_VERSION_MISMATCH": true,
	"REGISTRY_ROOT_MISMATCH":    true,
	"RULES_VERSION_MISMATCH":    true,
	"MODEL_VERSION_MISMATCH":    true,
	"RECORD_NOT_FOUND":          true,
	"RECORD_INVALID":            true,
	"AMOUNT_OUT_OF_RANGE":       true,
	"INCIDENT_DATE_MISMATCH":    true,
	"DESCRIPTION_MISMATCH":      true,
}

func canonicalProtocolHash(domain string, values ...string) string {
	var canonical strings.Builder
	canonical.WriteString(domain)
	for _, value := range values {
		canonical.WriteByte('|')
		canonical.WriteString(strconv.Itoa(len(value)))
		canonical.WriteByte(':')
		canonical.WriteString(value)
	}
	digest := sha256.Sum256([]byte(canonical.String()))
	return hex.EncodeToString(digest[:])
}

func oracleQueryHash(claim *Claim, verification *HospitalVerification) string {
	return canonicalProtocolHash(
		oracleProtocolVersion+":query",
		claim.ID,
		strconv.Itoa(claim.Version),
		claim.PolicyID,
		claim.ClaimantID,
		strconv.FormatInt(claim.AmountMinor, 10),
		claim.IncidentDate,
		strings.ToLower(claim.DescriptionHash),
		verification.ID,
		verification.HospitalIdentity,
		verification.Outcome,
		strings.ToLower(verification.ClinicalReferenceHash),
	)
}

func oracleResultDigest(request *OracleRequest, verified bool, verificationCode, recordHash string) string {
	return canonicalProtocolHash(
		oracleProtocolVersion+":result",
		request.ID,
		request.ClaimID,
		request.QueryHash,
		strconv.Itoa(request.ClaimVersion),
		request.HospitalVerificationID,
		request.RegistrySnapshotID,
		strconv.Itoa(request.RegistryVersion),
		request.RegistryRootHash,
		request.RulesVersion,
		request.RulesHash,
		request.ModelVersion,
		request.ModelHash,
		strconv.FormatBool(verified),
		verificationCode,
		strings.ToLower(recordHash),
	)
}

func oracleCommitmentDigest(request *OracleRequest, verified bool, resultHash, salt string) string {
	return canonicalProtocolHash(
		oracleProtocolVersion+":commitment",
		request.ID,
		strconv.Itoa(request.ClaimVersion),
		strconv.Itoa(request.RegistryVersion),
		strconv.FormatBool(verified),
		strings.ToLower(resultHash),
		request.ModelVersion,
		request.ModelHash,
		strings.ToLower(salt),
	)
}

func requireOracleIdentity(ctx contractapi.TransactionContextInterface) (string, string, error) {
	identity, err := requireIdentity(ctx, "OracleMSP", "oracle")
	if err != nil {
		return "", "", err
	}
	subject, found, err := ctx.GetClientIdentity().GetAttributeValue("subjectId")
	if err != nil {
		return "", "", fmt.Errorf("read Oracle subjectId: %w", err)
	}
	subject = strings.TrimSpace(subject)
	if !found || !idPattern.MatchString(subject) {
		return "", "", fmt.Errorf("access denied: Oracle certificate requires a valid subjectId")
	}
	return identity, subject, nil
}

func parseTwoOracleAssignments(raw string) ([]string, error) {
	var assignments []string
	if err := json.Unmarshal([]byte(raw), &assignments); err != nil {
		return nil, fmt.Errorf("assignedOracleIds must be a JSON string array")
	}
	if len(assignments) != oracleRequiredConfirmations {
		return nil, fmt.Errorf("exactly two Oracle certificate subjects must be assigned")
	}
	seen := make(map[string]bool, len(assignments))
	for index, value := range assignments {
		value = strings.TrimSpace(value)
		if !idPattern.MatchString(value) {
			return nil, fmt.Errorf("assigned Oracle id %q is invalid", value)
		}
		if seen[value] {
			return nil, fmt.Errorf("assigned Oracle id %s is duplicated", value)
		}
		seen[value] = true
		assignments[index] = value
	}
	return assignments, nil
}

func parseOracleDeadlines(ctx contractapi.TransactionContextInterface, commitDeadline, revealDeadline string) (string, string, error) {
	commit, err := time.Parse(time.RFC3339, commitDeadline)
	if err != nil {
		return "", "", fmt.Errorf("commitDeadline must use RFC3339")
	}
	reveal, err := time.Parse(time.RFC3339, revealDeadline)
	if err != nil {
		return "", "", fmt.Errorf("revealDeadline must use RFC3339")
	}
	tx, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", "", fmt.Errorf("read transaction timestamp: %w", err)
	}
	if !commit.After(tx.AsTime()) {
		return "", "", fmt.Errorf("commitDeadline must be after the transaction time")
	}
	if !reveal.After(commit) {
		return "", "", fmt.Errorf("revealDeadline must be after commitDeadline")
	}
	return commit.UTC().Format(time.RFC3339), reveal.UTC().Format(time.RFC3339), nil
}

func containsOracleAssignment(assignments []string, subject string) bool {
	for _, assigned := range assignments {
		if assigned == subject {
			return true
		}
	}
	return false
}

func oracleSubmissionID(requestID, oracleID string) string {
	return requestID + ":" + oracleID
}

func (c *Contract) PublishOracleRegistrySnapshot(
	ctx contractapi.TransactionContextInterface,
	id string,
	version int,
	rootHash, rulesVersion, rulesHash string,
	recordCount int,
) (*OracleRegistrySnapshot, error) {
	publishedBy, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin")
	if err != nil {
		return nil, err
	}
	if version < 1 {
		return nil, fmt.Errorf("registry snapshot version must be positive")
	}
	if err := validateHash("rootHash", rootHash); err != nil {
		return nil, err
	}
	if !idPattern.MatchString(strings.TrimSpace(rulesVersion)) {
		return nil, fmt.Errorf("rulesVersion is invalid")
	}
	if err := validateHash("rulesHash", rulesHash); err != nil {
		return nil, err
	}
	if recordCount < 1 {
		return nil, fmt.Errorf("recordCount must be positive")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	snapshot := &OracleRegistrySnapshot{
		AssetType: "oracleRegistrySnapshot", SchemaVersion: SchemaVersion, ID: id,
		Version: version, RootHash: strings.ToLower(rootHash), RulesVersion: strings.TrimSpace(rulesVersion),
		RulesHash: strings.ToLower(rulesHash), RecordCount: recordCount, PublishedBy: publishedBy, CreatedAt: now,
	}
	if err := putState(ctx, "oracleRegistrySnapshot", id, snapshot); err != nil {
		return nil, err
	}
	if err := emit(ctx, "OracleRegistrySnapshotPublished", snapshot); err != nil {
		return nil, err
	}
	return snapshot, nil
}

func (c *Contract) RequestOracleVerification(
	ctx contractapi.TransactionContextInterface,
	requestID, claimID, snapshotID, modelVersion, modelHash, assignedOracleIDsJSON, commitDeadline, revealDeadline string,
) (*OracleRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "HOSPITAL_VERIFIED" && claim.Status != "APPEAL_SUBMITTED" {
		return nil, fmt.Errorf("claim %s is not ready for Oracle verification", claimID)
	}
	verification, err := c.ReadHospitalVerification(ctx, claim.HospitalVerificationID)
	if err != nil {
		return nil, err
	}
	if verification.Outcome != "VERIFIED" || verification.ClaimID != claimID {
		return nil, fmt.Errorf("claim %s requires a current verified hospital attestation", claimID)
	}
	snapshot, err := c.ReadOracleRegistrySnapshot(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	if !idPattern.MatchString(strings.TrimSpace(modelVersion)) {
		return nil, fmt.Errorf("modelVersion is invalid")
	}
	if err := validateHash("modelHash", modelHash); err != nil {
		return nil, err
	}
	assignments, err := parseTwoOracleAssignments(assignedOracleIDsJSON)
	if err != nil {
		return nil, err
	}
	commitDeadline, revealDeadline, err = parseOracleDeadlines(ctx, commitDeadline, revealDeadline)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	request := &OracleRequest{
		AssetType: "oracleRequest", SchemaVersion: SchemaVersion, ID: requestID,
		ClaimID: claimID, ClaimVersion: claim.Version, HospitalVerificationID: verification.ID,
		QueryHash: oracleQueryHash(claim, verification), RegistrySnapshotID: snapshot.ID,
		RegistryVersion: snapshot.Version, RegistryRootHash: snapshot.RootHash,
		RulesVersion: snapshot.RulesVersion, RulesHash: snapshot.RulesHash,
		ModelVersion: strings.TrimSpace(modelVersion), ModelHash: strings.ToLower(modelHash),
		AssignedOracleIDs: assignments, RequiredConfirmations: oracleRequiredConfirmations,
		ExpectedResponses: len(assignments), Status: "PENDING", CommitDeadline: commitDeadline,
		RevealDeadline: revealDeadline, RequestedAt: now,
	}
	if err := putState(ctx, "oracleRequest", requestID, request); err != nil {
		return nil, err
	}
	claim.CurrentOracleRequestID = requestID
	claim.OracleOutcome = "PENDING"
	claim.OracleResultHash = ""
	claim.Status = "ORACLE_PENDING"
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "OracleVerificationRequested", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) SubmitOracleCommitment(ctx contractapi.TransactionContextInterface, requestID, commitmentHash string) (*OracleCommitment, error) {
	oracleIdentity, oracleID, err := requireOracleIdentity(ctx)
	if err != nil {
		return nil, err
	}
	if err := validateHash("commitmentHash", commitmentHash); err != nil {
		return nil, err
	}
	request, err := c.ReadOracleRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}
	if request.Status != "PENDING" {
		return nil, fmt.Errorf("Oracle request %s is already finalized", requestID)
	}
	if !containsOracleAssignment(request.AssignedOracleIDs, oracleID) {
		return nil, fmt.Errorf("Oracle %s is not assigned to request %s", oracleID, requestID)
	}
	claim, err := c.ReadClaim(ctx, request.ClaimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "ORACLE_PENDING" || claim.Version != request.ClaimVersion || claim.CurrentOracleRequestID != request.ID {
		return nil, fmt.Errorf("Oracle request %s is stale for claim %s", requestID, claim.ID)
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, fmt.Errorf("read transaction timestamp: %w", err)
	}
	deadline, _ := time.Parse(time.RFC3339, request.CommitDeadline)
	if txTime.AsTime().After(deadline) {
		return nil, fmt.Errorf("Oracle request %s commit phase has ended", requestID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	commitment := &OracleCommitment{
		AssetType: "oracleCommitment", SchemaVersion: SchemaVersion, ID: oracleSubmissionID(requestID, oracleID),
		RequestID: requestID, ClaimID: request.ClaimID, ClaimVersion: request.ClaimVersion,
		OracleID: oracleID, OracleIdentity: oracleIdentity, CommitmentHash: strings.ToLower(commitmentHash), CreatedAt: now,
	}
	if err := putState(ctx, "oracleCommitment", commitment.ID, commitment); err != nil {
		return nil, err
	}
	request.CommitmentCount++
	if err := overwriteAsset(ctx, "oracleRequest", request.ID, request); err != nil {
		return nil, err
	}
	if err := emit(ctx, "OracleCommitmentSubmitted", commitment); err != nil {
		return nil, err
	}
	return commitment, nil
}

func (c *Contract) RevealOracleResult(
	ctx contractapi.TransactionContextInterface,
	requestID string,
	verified bool,
	verificationCode, recordHash, resultHash string,
	claimVersion, registryVersion int,
	modelVersion, modelHash, salt string,
) (*OracleResult, error) {
	oracleIdentity, oracleID, err := requireOracleIdentity(ctx)
	if err != nil {
		return nil, err
	}
	request, err := c.ReadOracleRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}
	if request.Status != "PENDING" {
		return nil, fmt.Errorf("Oracle request %s is already finalized", requestID)
	}
	if !containsOracleAssignment(request.AssignedOracleIDs, oracleID) {
		return nil, fmt.Errorf("Oracle %s is not assigned to request %s", oracleID, requestID)
	}
	claim, err := c.ReadClaim(ctx, request.ClaimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "ORACLE_PENDING" || claim.Version != request.ClaimVersion || claim.CurrentOracleRequestID != request.ID {
		return nil, fmt.Errorf("Oracle request %s is stale for claim %s", requestID, claim.ID)
	}
	if claimVersion != request.ClaimVersion {
		return nil, fmt.Errorf("claim version mismatch")
	}
	if registryVersion != request.RegistryVersion {
		return nil, fmt.Errorf("registry version mismatch")
	}
	if modelVersion != request.ModelVersion || strings.ToLower(modelHash) != request.ModelHash {
		return nil, fmt.Errorf("model version mismatch")
	}
	verificationCode = strings.ToUpper(strings.TrimSpace(verificationCode))
	if !oracleVerificationCodes[verificationCode] {
		return nil, fmt.Errorf("verificationCode %s is not supported", verificationCode)
	}
	if verified != (verificationCode == "VERIFIED") {
		return nil, fmt.Errorf("verified must be true exactly when verificationCode is VERIFIED")
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{name: "recordHash", value: recordHash},
		{name: "resultHash", value: resultHash},
		{name: "modelHash", value: modelHash},
		{name: "salt", value: salt},
	} {
		if err := validateHash(field.name, field.value); err != nil {
			return nil, err
		}
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, fmt.Errorf("read transaction timestamp: %w", err)
	}
	commitDeadline, _ := time.Parse(time.RFC3339, request.CommitDeadline)
	revealDeadline, _ := time.Parse(time.RFC3339, request.RevealDeadline)
	if request.CommitmentCount < request.ExpectedResponses && !txTime.AsTime().After(commitDeadline) {
		return nil, fmt.Errorf("Oracle request %s reveal phase has not started", requestID)
	}
	if txTime.AsTime().After(revealDeadline) {
		return nil, fmt.Errorf("Oracle request %s reveal phase has ended", requestID)
	}
	commitment, err := c.ReadOracleCommitment(ctx, oracleSubmissionID(requestID, oracleID))
	if err != nil {
		return nil, fmt.Errorf("Oracle %s must commit before revealing: %w", oracleID, err)
	}
	expectedResultHash := oracleResultDigest(request, verified, verificationCode, recordHash)
	if strings.ToLower(resultHash) != expectedResultHash {
		return nil, fmt.Errorf("resultHash does not match the canonical Oracle result")
	}
	expectedCommitment := oracleCommitmentDigest(request, verified, expectedResultHash, salt)
	if commitment.CommitmentHash != expectedCommitment {
		return nil, fmt.Errorf("Oracle reveal does not match its commitment")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	result := &OracleResult{
		AssetType: "oracleResult", SchemaVersion: SchemaVersion, ID: oracleSubmissionID(requestID, oracleID),
		RequestID: requestID, ClaimID: request.ClaimID, ClaimVersion: claimVersion,
		RegistryVersion: registryVersion, ModelVersion: modelVersion, OracleID: oracleID,
		OracleIdentity: oracleIdentity, Verified: verified, VerificationCode: verificationCode,
		RecordHash: strings.ToLower(recordHash), ResultHash: expectedResultHash, CreatedAt: now,
	}
	if err := putState(ctx, "oracleResult", result.ID, result); err != nil {
		return nil, err
	}
	request.RevealCount++
	// Fabric range queries do not guarantee that an asset written earlier in the
	// same simulation is visible. Count this reveal explicitly and read only the
	// other assigned Oracle's deterministic result key from world state.
	matching := 1
	for _, assignedOracleID := range request.AssignedOracleIDs {
		if assignedOracleID == oracleID {
			continue
		}
		otherKey, keyErr := stateKey(ctx, "oracleResult", oracleSubmissionID(request.ID, assignedOracleID))
		if keyErr != nil {
			return nil, keyErr
		}
		otherPayload, stateErr := ctx.GetStub().GetState(otherKey)
		if stateErr != nil {
			return nil, fmt.Errorf("read Oracle result %s: %w", assignedOracleID, stateErr)
		}
		if otherPayload == nil {
			continue
		}
		var otherResult OracleResult
		if decodeErr := json.Unmarshal(otherPayload, &otherResult); decodeErr != nil {
			return nil, fmt.Errorf("decode Oracle result %s: %w", assignedOracleID, decodeErr)
		}
		if otherResult.RequestID == request.ID && otherResult.ResultHash == expectedResultHash {
			matching++
		}
	}
	finalized := false
	if matching >= request.RequiredConfirmations {
		finalized = true
		if verified {
			err = c.finalizeOracleRequest(ctx, request, claim, true, expectedResultHash, "EXACT_CONSENSUS", now)
		} else {
			err = c.finalizeOracleRequest(ctx, request, claim, false, expectedResultHash, "NEGATIVE_RESULT", now)
		}
	} else if request.RevealCount >= request.ExpectedResponses {
		finalized = true
		err = c.finalizeOracleRequest(ctx, request, claim, false, "", "CONFLICT", now)
	} else {
		err = overwriteAsset(ctx, "oracleRequest", request.ID, request)
	}
	if err != nil {
		return nil, err
	}
	eventName := "OracleResultRevealed"
	eventPayload := any(result)
	if finalized {
		// Fabric retains one chaincode event per transaction. The final reveal is
		// already persisted as an OracleResult asset, so emit the terminal request
		// event that downstream projections need to observe.
		eventName = "OracleRequestFinalized"
		eventPayload = request
	}
	if err := emit(ctx, eventName, eventPayload); err != nil {
		return nil, err
	}
	return result, nil
}

func (c *Contract) finalizeOracleRequest(ctx contractapi.TransactionContextInterface, request *OracleRequest, claim *Claim, verified bool, resultHash, code, now string) error {
	request.VerifiedResult = verified
	request.ResultHash = resultHash
	request.FinalizationCode = code
	request.FinalizedAt = now
	claim.OracleResultHash = resultHash
	claim.OracleOutcome = code
	claim.UpdatedAt = now
	if verified {
		request.Status = "CONSENSUS"
		claim.Status = "APPROVED"
		if claim.CurrentAppealID != "" {
			appeal, err := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
			if err != nil {
				return err
			}
			if appeal.Status == "SUBMITTED" {
				appeal.Status = "OVERTURNED"
				appeal.ResolvedAt = now
				if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
					return err
				}
			}
		}
	} else {
		request.Status = "FAILED"
		claim.Status = "ORACLE_FAILED"
	}
	if err := overwriteAsset(ctx, "oracleRequest", request.ID, request); err != nil {
		return err
	}
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return err
	}
	return nil
}

func (c *Contract) FinalizeOracleTimeout(ctx contractapi.TransactionContextInterface, requestID string) (*OracleRequest, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	request, err := c.ReadOracleRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}
	if request.Status != "PENDING" {
		return nil, fmt.Errorf("Oracle request %s is already finalized", requestID)
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, fmt.Errorf("read transaction timestamp: %w", err)
	}
	revealDeadline, _ := time.Parse(time.RFC3339, request.RevealDeadline)
	if !txTime.AsTime().After(revealDeadline) {
		return nil, fmt.Errorf("Oracle request %s has not timed out", requestID)
	}
	claim, err := c.ReadClaim(ctx, request.ClaimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "ORACLE_PENDING" || claim.Version != request.ClaimVersion || claim.CurrentOracleRequestID != request.ID {
		return nil, fmt.Errorf("Oracle request %s is stale for claim %s", requestID, claim.ID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	if err := c.finalizeOracleRequest(ctx, request, claim, false, "", "TIMEOUT", now); err != nil {
		return nil, err
	}
	if err := emit(ctx, "OracleRequestFinalized", request); err != nil {
		return nil, err
	}
	return request, nil
}

func (c *Contract) RouteOracleFailureToReview(
	ctx contractapi.TransactionContextInterface,
	requestID, reviewID, assignedAuditorIDsJSON string,
	approvalThreshold, rejectionThreshold int,
	deadline string,
) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	request, err := c.ReadOracleRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}
	if request.Status != "FAILED" || request.FinalizationCode == "" {
		return nil, fmt.Errorf("Oracle request %s is not a finalized failure", requestID)
	}
	claim, err := c.ReadClaim(ctx, request.ClaimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "ORACLE_FAILED" || claim.Version != request.ClaimVersion || claim.CurrentOracleRequestID != request.ID {
		return nil, fmt.Errorf("Oracle request %s is not the claim's current failed request", requestID)
	}
	appealID := ""
	kind := "INITIAL"
	if claim.CurrentAppealID != "" {
		appeal, readErr := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
		if readErr != nil {
			return nil, readErr
		}
		if appeal.Status == "SUBMITTED" {
			appealID = appeal.ID
			kind = "APPEAL"
		}
	}
	review, err := c.openReview(ctx, claim, reviewID, appealID, kind, assignedAuditorIDsJSON, approvalThreshold, rejectionThreshold, deadline)
	if err != nil {
		return nil, err
	}
	if appealID != "" {
		appeal, readErr := c.ReadClaimAppeal(ctx, appealID)
		if readErr != nil {
			return nil, readErr
		}
		appeal.Status = "UNDER_REVIEW"
		appeal.ReviewID = review.ID
		if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
			return nil, err
		}
	}
	return review, nil
}

func (c *Contract) ReadOracleRegistrySnapshot(ctx contractapi.TransactionContextInterface, id string) (*OracleRegistrySnapshot, error) {
	return getState[OracleRegistrySnapshot](ctx, "oracleRegistrySnapshot", id)
}

func (c *Contract) ReadOracleRequest(ctx contractapi.TransactionContextInterface, id string) (*OracleRequest, error) {
	return getState[OracleRequest](ctx, "oracleRequest", id)
}

func (c *Contract) ReadOracleCommitment(ctx contractapi.TransactionContextInterface, id string) (*OracleCommitment, error) {
	return getState[OracleCommitment](ctx, "oracleCommitment", id)
}

func (c *Contract) ReadOracleResult(ctx contractapi.TransactionContextInterface, id string) (*OracleResult, error) {
	return getState[OracleResult](ctx, "oracleResult", id)
}

func (c *Contract) GetOracleRequestHistory(ctx contractapi.TransactionContextInterface, id string) ([]OracleRequestHistoryRecord, error) {
	key, err := stateKey(ctx, "oracleRequest", id)
	if err != nil {
		return nil, err
	}
	iterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, fmt.Errorf("read Oracle request history: %w", err)
	}
	defer iterator.Close()
	history := make([]OracleRequestHistoryRecord, 0)
	for iterator.HasNext() {
		entry, err := iterator.Next()
		if err != nil {
			return nil, fmt.Errorf("iterate Oracle request history: %w", err)
		}
		record := OracleRequestHistoryRecord{
			TxID: entry.TxId, Timestamp: entry.Timestamp.AsTime().UTC().Format(time.RFC3339Nano), IsDelete: entry.IsDelete,
		}
		if !entry.IsDelete {
			var value OracleRequest
			if err := json.Unmarshal(entry.Value, &value); err != nil {
				return nil, fmt.Errorf("decode Oracle request history: %w", err)
			}
			record.Value = &value
		}
		history = append(history, record)
	}
	return history, nil
}
