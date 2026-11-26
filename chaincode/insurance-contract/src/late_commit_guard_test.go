package insurance

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// These tests reproduce the clock-tolerance attack recorded as F01/C1/C2 in the
// 26 November 2026 pre-freeze audit. A proposal timestamp may sit up to
// ledgerTimeTolerance behind the endorsing peer's wall clock. Without a state
// guard, a subject that withheld its sealed value could therefore submit one
// after another subject's value had been revealed, backdated to just before
// the deadline. The first reveal must close sealing in ledger state.

// backdate sets the proposal timestamp just before deadline while the peer's
// wall clock is already past it, but still inside the accepted tolerance.
func backdate(t *testing.T, ctx *testContext, deadline time.Time) {
	t.Helper()
	ctx.wallTime = deadline.Add(10 * time.Second)
	ctx.stub.timestamp = timestamppb.New(deadline.Add(-time.Second))
	now, err := ledgerNow(ctx)
	requireNoError(t, err)
	if !now.Before(deadline) {
		t.Fatal("backdated proposal should look timely to a deadline-only check")
	}
}

func lateGuardOracleV2Request(t *testing.T, id string) (*Contract, *testContext, *OracleRequest, string) {
	t.Helper()
	c, ctx := medicalTestContext()
	ctx.stub.channelID = medicalDevLiteChannel
	r1Roster(t, c, ctx)
	raw, err := os.ReadFile("testdata/oracle-v2-protocol.json")
	requireNoError(t, err)
	var fixture struct{ Vector OracleV2FactVector }
	requireNoError(t, json.Unmarshal(raw, &fixture))
	vector := fixture.Vector
	vector.ModelAdvice = "REVIEW"
	envelope, err := oracleV2Canonical(vector)
	requireNoError(t, err)
	claim := &Claim{ID: vector.ClaimID, Version: vector.ClaimVersion, ClaimantID: "holder", EpisodeID: "episode", Status: "ORACLE_PENDING", CurrentOracleRequestID: id}
	request := &OracleRequest{ID: id, ClaimID: claim.ID, ClaimVersion: claim.Version, ProtocolVersion: "v2",
		Status: "PENDING", ManifestHash: vector.ManifestHash, PolicyVersion: oracleV2Policy, RosterVersion: "roster-one",
		RequiredConfirmations: 2, ExpectedResponses: 3, AssignedOracleIDs: []string{"oracle1", "oracle2", "oracle3"},
		CommitDeadline: "2026-09-05T12:01:00Z", RevealDeadline: "2026-09-05T12:03:00Z"}
	requireNoError(t, putState(ctx, "oracleRequest", request.ID, request))
	requireNoError(t, putState(ctx, "claim", claim.ID, claim))
	return c, ctx, request, envelope
}

func commitV2(t *testing.T, c *Contract, ctx *testContext, request *OracleRequest, subject, envelope, salt string) error {
	t.Helper()
	commitment, err := oracleV2Commitment(medicalDevLiteChannel, request.ID, request.ClaimVersion, subject, oracleV2FactVectorHash(envelope), "PANEL_REVIEW", salt)
	requireNoError(t, err)
	r1Actor(ctx, "oracle", subject)
	_, err = c.SubmitOracleCommitmentV2(ctx, request.ID, commitment)
	return err
}

func TestOracleV2FirstRevealClosesCommitPhase(t *testing.T) {
	c, ctx, request, envelope := lateGuardOracleV2Request(t, "v2-late-guard")
	deadline, err := time.Parse(time.RFC3339Nano, request.CommitDeadline)
	requireNoError(t, err)
	salt, diagnostics := strings.Repeat("b", 64), strings.Repeat("d", 64)
	requireNoError(t, commitV2(t, c, ctx, request, "oracle1", envelope, salt))
	requireNoError(t, commitV2(t, c, ctx, request, "oracle2", envelope, salt))

	// The commit deadline passes with oracle3 silent, so reveals open.
	ctx.wallTime = time.Time{}
	ctx.stub.timestamp = timestamppb.New(deadline.Add(10 * time.Second))
	r1Actor(ctx, "oracle", "oracle1")
	_, err = c.RevealOracleResultV2(ctx, request.ID, envelope, "PANEL_REVIEW", salt, diagnostics)
	requireNoError(t, err)

	// oracle3 has now seen oracle1's public fact vector and copies it.
	backdate(t, ctx, deadline)
	requireError(t, commitV2(t, c, ctx, request, "oracle3", envelope, salt), "commit phase has ended")

	// The honest second reveal still reaches the exact 2-of-3 outcome.
	ctx.wallTime = time.Time{}
	ctx.stub.timestamp = timestamppb.New(deadline.Add(20 * time.Second))
	r1Actor(ctx, "oracle", "oracle2")
	_, err = c.RevealOracleResultV2(ctx, request.ID, envelope, "PANEL_REVIEW", salt, diagnostics)
	requireNoError(t, err)
	final, err := c.ReadOracleRequest(ctx, request.ID)
	requireNoError(t, err)
	if final.CommitmentCount != 2 || final.RevealCount != 2 || final.Decision != "PANEL_REVIEW" || final.Status != "FAILED" {
		t.Fatalf("late commitment changed the request or quorum failed: %+v", final)
	}
}

func TestOracleV2ToleratedCommitBeforeAnyRevealStillCounts(t *testing.T) {
	c, ctx, request, envelope := lateGuardOracleV2Request(t, "v2-tolerated-commit")
	deadline, err := time.Parse(time.RFC3339Nano, request.CommitDeadline)
	requireNoError(t, err)
	salt := strings.Repeat("c", 64)
	backdate(t, ctx, deadline)
	requireNoError(t, commitV2(t, c, ctx, request, "oracle1", envelope, salt))
	current, err := c.ReadOracleRequest(ctx, request.ID)
	requireNoError(t, err)
	if current.CommitmentCount != 1 || current.RevealCount != 0 {
		t.Fatalf("tolerated pre-reveal commitment was not recorded: %+v", current)
	}
}

func TestOracleV1FirstRevealClosesCommitPhase(t *testing.T) {
	contract, ctx, request := setupOracleRequestWithProfile(t, "late-guard-v1", `["oracle1","oracle2","oracle3"]`, 2)
	deadline, err := time.Parse(time.RFC3339, request.CommitDeadline)
	requireNoError(t, err)
	recordHash := strings.Repeat("d", 64)
	resultHash := commitOracleTestResult(t, contract, ctx, request, "oracle1", true, "VERIFIED", recordHash, strings.Repeat("1", 64))
	commitOracleTestResult(t, contract, ctx, request, "oracle2", true, "VERIFIED", recordHash, strings.Repeat("2", 64))
	ctx.stub.timestamp = timestamppb.New(deadline.Add(10 * time.Second))
	revealOracleTestResult(t, contract, ctx, request, "oracle1", true, "VERIFIED", recordHash, resultHash, strings.Repeat("1", 64))

	backdate(t, ctx, deadline)
	setIdentity(ctx, "certificate-oracle3", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle3"})
	late := oracleCommitmentDigest(request, true, oracleResultDigest(request, true, "VERIFIED", recordHash), strings.Repeat("3", 64))
	_, err = contract.SubmitOracleCommitment(ctx, request.ID, late)
	requireError(t, err, "commit phase has ended")
}

func TestSealedPanelFirstRevealClosesSealing(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	activateR2Roster(t, f)
	c, ctx, claim := f.contract, f.context, f.claim
	start := ctx.stub.timestamp.AsTime()
	deadline := start.Add(time.Minute)
	review := &ClaimReview{ID: "sealed-late-guard", ClaimID: claim.ID, MedicalVersion: claim.Version, Round: 1, Kind: "INITIAL", Status: "OPEN",
		BallotVersion: sealedPanelBallot, RosterVersion: "auditors-r2", AssignedAuditorIDs: []string{"auditor1", "auditor2", "auditor3", "auditor4"},
		ApprovalThreshold: 3, RejectionThreshold: 2, OpenedAt: start.Format(time.RFC3339),
		CommitDeadline: deadline.Format(time.RFC3339), Deadline: start.Add(2 * time.Minute).Format(time.RFC3339)}
	claim.CurrentReviewID, claim.Status, claim.ReviewRound = review.ID, "UNDER_REVIEW", review.Round
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	requireNoError(t, putState(ctx, "claimReview", review.ID, review))
	reason, salt := strings.Repeat("a", 64), strings.Repeat("b", 64)
	code := "EVIDENCE_DOES_NOT_SUPPORT_SERVICE"
	digest := canonicalProtocolHash("medical-reason-v1", code, reason)
	auditor := func(subject string) {
		setIdentity(ctx, subject, "AuditorMSP", "auditor", map[string]string{"subjectId": subject})
	}

	auditor("auditor1")
	_, err := c.CommitAuditorVote(ctx, review.ID, 1, sealedVoteHash(review, "auditor1", "REJECT", digest, salt))
	requireNoError(t, err)
	ctx.stub.timestamp = timestamppb.New(deadline.Add(time.Second))
	_, err = c.RevealAuditorVote(ctx, review.ID, 1, "late-guard-vote1", "REJECT", code, reason, salt)
	requireNoError(t, err)

	// auditor2 has seen a revealed REJECT and tries to seal a matching ballot.
	backdate(t, ctx, deadline)
	auditor("auditor2")
	_, err = c.CommitAuditorVote(ctx, review.ID, 1, sealedVoteHash(review, "auditor2", "REJECT", digest, salt))
	requireError(t, err, "deadline has elapsed")
	current, err := c.ReadClaimReview(ctx, review.ID)
	requireNoError(t, err)
	if current.CommitmentsCast != 1 || current.VotesCast != 1 || current.Rejections != 1 {
		t.Fatalf("late ballot changed the sealed review: %+v", current)
	}
}
