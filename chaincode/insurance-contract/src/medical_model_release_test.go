package insurance

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestDevLiteLegacyCommitmentFinishesAlongsideReleaseRequest(t *testing.T) {
	for _, unavailable := range []bool{false, true} {
		f := newMedicalSettlementFixture(t)
		c, ctx := f.contract, f.context
		release, err := c.activeMedicalRoutingRelease(ctx)
		requireNoError(t, err)
		request, err := c.ReadOracleRequest(ctx, f.claim.CurrentOracleRequestID)
		requireNoError(t, err)
		claim := f.claim
		claim.Version, claim.Status = 2, "ORACLE_PENDING"
		request.ClaimVersion, request.Status = 2, "PENDING"
		request.ModelVersion, request.ModelHash = release.ModelVersion, release.ArtifactHash
		request.ExpectedResponses, request.RequiredConfirmations = 3, 2
		request.AssignedOracleIDs = []string{"oracle1", "oracle2", "oracle3"}
		request.CommitDeadline, request.RevealDeadline = "2026-09-05T12:01:00Z", "2026-09-05T12:03:00Z"
		other := *request
		other.ID, other.ModelReleaseID = "new-request", release.ID
		if unavailable {
			request.ModelReleaseID = release.ID
		}
		requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
		requireNoError(t, overwriteAsset(ctx, "oracleRequest", request.ID, request))
		requireNoError(t, putState(ctx, "oracleRequest", other.ID, &other))
		if effectiveMedicalModelReleaseID(request) != release.ID {
			t.Fatal("legacy request did not resolve to seed release")
		}
		hash, salt := strings.Repeat("a", 64), strings.Repeat("b", 64)
		code := "XGB_AUTO:" + strings.ToUpper(hash)
		if unavailable {
			code = "XGB_EVALUATOR_UNAVAILABLE"
		}
		result := oracleResultDigest(request, !unavailable, code, hash)
		commitment := oracleCommitmentDigest(request, !unavailable, result, salt)
		for _, id := range request.AssignedOracleIDs[:2] {
			setIdentity(ctx, id, "OracleMSP", "oracle", map[string]string{"subjectId": id})
			_, err = c.SubmitOracleCommitment(ctx, request.ID, commitment)
			requireNoError(t, err)
		}
		ctx.stub.timestamp = timestamppb.New(time.Date(2026, 9, 5, 12, 2, 0, 0, time.UTC))
		for _, id := range request.AssignedOracleIDs[:2] {
			setIdentity(ctx, id, "OracleMSP", "oracle", map[string]string{"subjectId": id})
			_, err = c.RevealOracleResult(ctx, request.ID, !unavailable, code, hash, result, claim.Version,
				request.RegistryVersion, request.ModelVersion, request.ModelHash, salt)
			requireNoError(t, err)
		}
		final, err := c.ReadClaim(ctx, claim.ID)
		requireNoError(t, err)
		want := "APPROVED"
		if unavailable {
			want = "ORACLE_FAILED"
			setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
			_, err = c.PrepareMedicalReview(ctx, claim.ID, "unavailable-panel", "2026-09-06T12:00:00Z")
			requireNoError(t, err)
		}
		if final.Status != want {
			t.Fatalf("final status %s, want %s", final.Status, want)
		}
	}
}

func TestDevLiteHeldReleaseSettlementAndOracleOrder(t *testing.T) {
	const prepareBy = "2026-09-06T12:00:00Z"
	for _, phase := range []string{"before commit", "between commit and reveal", "after reveal before authorization", "correction during hold"} {
		t.Run(phase, func(t *testing.T) {
			f := newMedicalSettlementFixture(t)
			c, ctx := f.contract, f.context
			hash := strings.Repeat("a", 64)
			release, err := c.activeMedicalRoutingRelease(ctx)
			requireNoError(t, err)
			request, err := c.ReadOracleRequest(ctx, f.claim.CurrentOracleRequestID)
			requireNoError(t, err)
			request.ModelReleaseID = release.ID
			request.AssignedOracleIDs = []string{"oracle1", "oracle2", "oracle3"}
			request.CommitDeadline = "2026-09-05T12:01:00Z"
			request.RevealDeadline = "2026-09-05T12:03:00Z"
			request.ModelVersion, request.ModelHash = release.ModelVersion, release.ArtifactHash
			if phase == "before commit" || phase == "between commit and reveal" {
				request.Status, f.claim.Status = "PENDING", "ORACLE_PENDING"
			}
			if phase == "correction during hold" {
				f.claim.Version++
				f.claim.CurrentOracleRequestID, f.claim.MedicalRevisionKind, f.claim.Status = "", "CORRECTION", "SUBMITTED"
			}
			requireNoError(t, overwriteAsset(ctx, "oracleRequest", request.ID, request))
			requireNoError(t, overwriteAsset(ctx, "claim", f.claim.ID, f.claim))
			if phase == "between commit and reveal" {
				setIdentity(ctx, "oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
				_, err = c.SubmitOracleCommitment(ctx, request.ID, hash)
				requireNoError(t, err)
			}
			setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
			_, err = c.HoldMedicalModelRelease(ctx, release.ID, hash)
			requireNoError(t, err)
			if phase == "after reveal before authorization" {
				_, err = f.authorize()
				requireError(t, err, "model release is held")
			}
			if phase == "before commit" || phase == "between commit and reveal" {
				setIdentity(ctx, "oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
				if phase == "before commit" {
					_, err = c.SubmitOracleCommitment(ctx, request.ID, hash)
				} else {
					_, err = c.RevealOracleResult(ctx, request.ID, true, "XGB_AUTO:"+hash, hash, hash,
						request.ClaimVersion, request.RegistryVersion, request.ModelVersion, request.ModelHash, hash)
				}
				requireError(t, err, "model release is held")
			}
			setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
			review, err := c.PrepareMedicalReview(ctx, f.claim.ID, "held-review", prepareBy)
			requireNoError(t, err)
			claim, err := c.ReadClaim(ctx, f.claim.ID)
			requireNoError(t, err)
			if review.MedicalVersion != claim.Version || claim.MedicalHeldReleaseID != release.ID || claim.Status != "MEDICAL_REVIEW_PREPARING" {
				t.Fatal("held release did not route the current claim into panel preparation")
			}
		})
	}
}

func TestDevLiteModelReleaseApprovalAndHoldOrder(t *testing.T) {
	for _, holdFirst := range []bool{false, true} {
		name := "promotion then hold"
		if holdFirst {
			name = "hold then promotion"
		}
		t.Run(name, func(t *testing.T) {
			c, ctx := medicalTestContext()
			ctx.stub.channelID = medicalDevLiteChannel
			hash := strings.Repeat("a", 64)
			_, err := c.RegisterMedicalModelRelease(ctx, "next-release", "medical-next", hash, "schema-v1", "threshold-v1", "ROUTING")
			requireNoError(t, err)
			_, err = c.ShadowMedicalModelRelease(ctx, "next-release", hash)
			requireNoError(t, err)
			_, err = c.ApproveMedicalModelRelease(ctx, "next-release", "")
			requireNoError(t, err)
			_, err = c.ApproveMedicalModelRelease(ctx, "next-release", "")
			requireError(t, err, "already approved")
			setIdentity(ctx, "auditor1", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor1"})
			_, err = c.ApproveMedicalModelRelease(ctx, "next-release", "")
			requireNoError(t, err)
			setIdentity(ctx, "oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
			if holdFirst {
				_, err = c.HoldMedicalModelRelease(ctx, "next-release", hash)
				requireNoError(t, err)
				_, err = c.ApproveMedicalModelRelease(ctx, "next-release", hash)
				requireError(t, err, "SHADOW")
			} else {
				_, err := c.ApproveMedicalModelRelease(ctx, "next-release", strings.Repeat("b", 64))
				requireError(t, err, "does not match")
				release, err := c.ApproveMedicalModelRelease(ctx, "next-release", hash)
				requireNoError(t, err)
				if release.Status != "PROMOTED" || len(release.ApprovedMSPs) != 3 {
					t.Fatalf("release did not record three distinct approvals: %+v", release)
				}
				_, err = c.HoldMedicalModelRelease(ctx, "next-release", hash)
				requireNoError(t, err)
			}
			release, err := c.ReadMedicalModelRelease(ctx, "next-release")
			requireNoError(t, err)
			if release.Status != "HELD" {
				t.Fatalf("hold did not remain effective: %+v", release)
			}
		})
	}
}
