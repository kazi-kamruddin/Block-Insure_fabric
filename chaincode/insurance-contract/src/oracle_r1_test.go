package insurance

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func r1Actor(ctx *testContext, role, subject string) {
	msp := map[string]string{"insurerAdmin": "InsurerMSP", "policyholder": "InsurerMSP", "auditor": "AuditorMSP", "oracle": "OracleMSP", "hospitalOfficer": "HospitalMSP", "bankOfficer": "BankMSP"}[role]
	setIdentity(ctx, subject, msp, role, map[string]string{"subjectId": subject})
}

func r1Roster(t *testing.T, c *Contract, ctx *testContext) {
	t.Helper()
	r1Actor(ctx, "insurerAdmin", "insurer")
	_, err := c.ProposeOracleRoster(ctx, "roster-one", `[{"subjectId":"oracle1","keyVersion":1},{"subjectId":"oracle2","keyVersion":1},{"subjectId":"oracle3","keyVersion":1}]`)
	requireNoError(t, err)
	_, err = c.ActivateOracleRoster(ctx, "roster-one")
	requireError(t, err, "approved")
	for _, actor := range [][2]string{{"insurerAdmin", "insurer"}, {"auditor", "auditor1"}, {"oracle", "oracle1"}} {
		r1Actor(ctx, actor[0], actor[1])
		_, err = c.ApproveOracleRoster(ctx, "roster-one")
		requireNoError(t, err)
	}
	r1Actor(ctx, "insurerAdmin", "insurer")
	active, err := c.ActivateOracleRoster(ctx, "roster-one")
	requireNoError(t, err)
	if active.RequiredConfirmations != 2 || len(active.Subjects) != 3 {
		t.Fatal("unexpected roster thresholds")
	}
}

func TestR1RosterRotationPreservesPinnedAssignmentsAndRevokesByKey(t *testing.T) {
	c, ctx := medicalTestContext()
	ctx.stub.channelID = medicalDevLiteChannel
	r1Roster(t, c, ctx)
	r1Actor(ctx, "auditor", "auditor1")
	reason := strings.Repeat("a", 64)
	requireNoError(t, c.RevokeOracleSubject(ctx, "oracle1", 1, reason))
	requireError(t, c.RevokeOracleSubject(ctx, "oracle1", 1, reason), "already exists")

	for _, candidate := range []struct {
		version  string
		subjects string
		revoked  bool
	}{
		{"roster-with-revoked-key", `[{"subjectId":"oracle1","keyVersion":1},{"subjectId":"oracle2","keyVersion":1},{"subjectId":"oracle4","keyVersion":1}]`, true},
		{"roster-two", `[{"subjectId":"oracle1","keyVersion":2},{"subjectId":"oracle2","keyVersion":1},{"subjectId":"oracle4","keyVersion":1}]`, false},
	} {
		r1Actor(ctx, "insurerAdmin", "insurer")
		_, err := c.ProposeOracleRoster(ctx, candidate.version, candidate.subjects)
		requireNoError(t, err)
		for _, actor := range [][2]string{{"insurerAdmin", "insurer"}, {"auditor", "auditor1"}, {"oracle", "oracle2"}} {
			r1Actor(ctx, actor[0], actor[1])
			_, err = c.ApproveOracleRoster(ctx, candidate.version)
			requireNoError(t, err)
		}
		r1Actor(ctx, "insurerAdmin", "insurer")
		_, err = c.ActivateOracleRoster(ctx, candidate.version)
		if candidate.revoked {
			requireError(t, err, "revoked Oracle")
			active, err := c.ReadActiveOracleRoster(ctx)
			requireNoError(t, err)
			if active.Version != "roster-one" {
				t.Fatalf("failed activation changed the active roster to %s", active.Version)
			}
			continue
		}
		requireNoError(t, err)
	}

	active, err := c.ReadActiveOracleRoster(ctx)
	requireNoError(t, err)
	if active.Version != "roster-two" {
		t.Fatalf("rotation selected %s", active.Version)
	}
	r1Actor(ctx, "oracle", "oracle3")
	requireNoError(t, requireOracleRosterSubject(ctx, "roster-one", "oracle3"))
	requireError(t, requireOracleRosterSubject(ctx, "roster-two", "oracle3"), "not assigned")
	r1Actor(ctx, "oracle", "oracle1")
	requireError(t, requireOracleRosterSubject(ctx, "roster-one", "oracle1"), "revoked")
	requireError(t, requireOracleRosterSubject(ctx, "roster-two", "oracle1"), "does not match")
	setIdentity(ctx, "oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1", "oracleKeyVersion": "2"})
	requireNoError(t, requireOracleRosterSubject(ctx, "roster-two", "oracle1"))
}

func TestR1BenchmarkSelectsVersionEffectiveOnServiceDate(t *testing.T) {
	c, ctx := medicalTestContext()
	ctx.stub.channelID = medicalDevLiteChannel
	digest := strings.Repeat("a", 64)
	_, err := c.CreatePartnerAgreement(ctx, "benchmark-partner", "HOSPITAL", "hospital", "Hospital", "Dhaka", "Preferred",
		"Synthetic benchmarks", "2026-01-01", "2027-01-01")
	requireNoError(t, err)
	_, err = c.RegisterMedicalOracleBenchmark(ctx, "hospital", "DIAGNOSTIC", 100, 1000, "ACTIVE", digest)
	requireNoError(t, err)
	_, err = c.RegisterMedicalOracleBenchmarkVersion(ctx, "hospital", "DIAGNOSTIC", 300, 3000, "SUSPENDED", digest, "2026-09-10")
	requireNoError(t, err)
	_, err = c.RegisterMedicalOracleBenchmarkVersion(ctx, "hospital", "DIAGNOSTIC", 200, 2000, "ACTIVE", digest, "2026-09-05")
	requireNoError(t, err)
	_, err = c.RegisterMedicalOracleBenchmarkVersion(ctx, "hospital", "DIAGNOSTIC", 400, 4000, "ACTIVE", digest, "2026-09-05")
	requireError(t, err, "version already exists")
	for _, test := range []struct {
		date, effective, license string
		minimum                  int64
	}{
		{"2026-09-04", "", "ACTIVE", 100},
		{"2026-09-05", "2026-09-05", "ACTIVE", 200},
		{"2026-09-09", "2026-09-05", "ACTIVE", 200},
		{"2026-09-10", "2026-09-10", "SUSPENDED", 300},
		{"2026-09-11", "2026-09-10", "SUSPENDED", 300},
	} {
		benchmark, err := medicalOracleBenchmarkAt(ctx, "hospital", "DIAGNOSTIC", test.date)
		requireNoError(t, err)
		if benchmark.EffectiveFrom != test.effective || benchmark.ExpectedMinMinor != test.minimum || benchmark.LicenseStatus != test.license {
			t.Fatalf("service date %s resolved to %+v", test.date, benchmark)
		}
	}
}

func TestR1GovernedReleaseRequiresAttestationAndDelay(t *testing.T) {
	c, ctx := medicalTestContext()
	ctx.stub.channelID = medicalDevLiteChannel
	r1Roster(t, c, ctx)
	hash := strings.Repeat("a", 64)
	release, err := c.RegisterMedicalModelRelease(ctx, "e2-release", medicalModelE2, hash, "schema-v1", "threshold-v1", "ROUTING")
	requireNoError(t, err)
	if release.Status != "REGISTERED" {
		t.Fatal("release must begin as registered")
	}
	_, err = c.ShadowMedicalModelRelease(ctx, release.ID, hash)
	requireNoError(t, err)
	for round := 0; round < 2; round++ {
		r1Actor(ctx, "oracle", "oracle1")
		_, err = c.ApproveMedicalModelRelease(ctx, release.ID, hash)
		requireError(t, err, "attestation")
		_, err = c.AttestMedicalModelRelease(ctx, release.ID, hash)
		requireNoError(t, err)
		_, err = c.AttestMedicalModelRelease(ctx, release.ID, hash)
		requireError(t, err, "already attested")
		r1Actor(ctx, "oracle", "oracle2")
		_, err = c.AttestMedicalModelRelease(ctx, release.ID, hash)
		requireNoError(t, err)
		for _, actor := range [][2]string{{"oracle", "oracle1"}, {"auditor", "auditor1"}, {"insurerAdmin", "insurer"}} {
			r1Actor(ctx, actor[0], actor[1])
			installed := ""
			if actor[0] == "oracle" {
				installed = hash
			}
			release, err = c.ApproveMedicalModelRelease(ctx, release.ID, installed)
			requireNoError(t, err)
		}
		if release.Status != "APPROVED" {
			t.Fatal("third approval must leave activation pending")
		}
		_, err = c.ActivateMedicalModelRelease(ctx, release.ID)
		requireError(t, err, "ten-minute delay")
		ctx.stub.timestamp = timestamppb.New(ctx.stub.timestamp.AsTime().Add(10 * time.Minute))
		release, err = c.ActivateMedicalModelRelease(ctx, release.ID)
		requireNoError(t, err)
		if release.Status != "ACTIVE" {
			t.Fatal("activation did not select E2")
		}
		if round == 0 {
			_, err = c.HoldMedicalModelRelease(ctx, release.ID, hash)
			requireNoError(t, err)
			release, err = c.RequestMedicalModelResume(ctx, release.ID, hash)
			requireNoError(t, err)
			if len(release.OracleAttesters) != 0 || len(release.ApprovedMSPs) != 0 || release.Status != "RESUME_PENDING" {
				t.Fatal("resume reused the prior approval round")
			}
		}
	}
}

func TestR1IssuerSignatureVersionAndRevocation(t *testing.T) {
	c, ctx := medicalTestContext()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	requireNoError(t, err)
	der, err := x509.MarshalPKIXPublicKey(public)
	requireNoError(t, err)
	key := base64.RawURLEncoding.EncodeToString(der)
	from, until := "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"
	issuer, err := c.ProposeSourceIssuer(ctx, "hospital-his", "HOSPITAL_HIS", key, 1, from, until, `["invoiceIssued"]`, "his-domain", "hospital-one")
	requireNoError(t, err)
	r1Actor(ctx, "hospitalOfficer", "hospital-two")
	_, err = c.ApproveSourceIssuer(ctx, issuer.IssuerID, 1)
	requireError(t, err, "not eligible")
	for _, actor := range [][2]string{{"hospitalOfficer", "hospital-one"}, {"auditor", "auditor1"}, {"insurerAdmin", "insurer"}} {
		r1Actor(ctx, actor[0], actor[1])
		issuer, err = c.ApproveSourceIssuer(ctx, issuer.IssuerID, 1)
		requireNoError(t, err)
	}
	if issuer.Status != "ACTIVE" {
		t.Fatal("Hospital approval did not activate source")
	}
	root, coverage := strings.Repeat("a", 64), strings.Repeat("b", 64)
	anchorHash, err := oracleV2Digest("oracle-v2:anchor", map[string]any{
		"issuerId": issuer.IssuerID, "keyVersion": 1, "feedVersion": 1, "root": root, "effectiveAt": from, "coverageHash": coverage,
	})
	requireNoError(t, err)
	raw, err := hex.DecodeString(anchorHash)
	requireNoError(t, err)
	signed := base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, raw))
	_, err = c.AnchorSourceFeed(ctx, issuer.IssuerID, 1, 1, coverage, from, coverage, signed)
	requireError(t, err, "signature")
	_, err = c.AnchorSourceFeed(ctx, issuer.IssuerID, 1, 1, root, from, coverage, signed)
	requireNoError(t, err)
	_, err = c.AnchorSourceFeed(ctx, issuer.IssuerID, 1, 1, root, from, coverage, signed)
	requireError(t, err, "duplicate")
	_, err = c.RevokeSourceIssuer(ctx, issuer.IssuerID, 1)
	requireNoError(t, err)
	_, err = c.AnchorSourceFeed(ctx, issuer.IssuerID, 1, 2, root, from, coverage, signed)
	requireError(t, err, "not eligible")
}

func TestR1OracleExactQuorumAndSubjectBoundCommitment(t *testing.T) {
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
	claim := &Claim{ID: vector.ClaimID, Version: vector.ClaimVersion, ClaimantID: "holder", EpisodeID: "episode", Status: "ORACLE_PENDING", CurrentOracleRequestID: "v2-request"}
	req := &OracleRequest{ID: claim.CurrentOracleRequestID, ClaimID: claim.ID, ClaimVersion: claim.Version, ProtocolVersion: "v2",
		Status: "PENDING", ManifestHash: vector.ManifestHash, PolicyVersion: oracleV2Policy, RosterVersion: "roster-one",
		RequiredConfirmations: 2, ExpectedResponses: 3, AssignedOracleIDs: []string{"oracle1", "oracle2", "oracle3"},
		CommitDeadline: "2026-09-05T12:01:00Z", RevealDeadline: "2026-09-05T12:03:00Z"}
	requireNoError(t, putState(ctx, "oracleRequest", req.ID, req))
	requireNoError(t, putState(ctx, "claim", claim.ID, claim))
	salt := strings.Repeat("b", 64)
	diagnostics := strings.Repeat("d", 64)
	digest := oracleV2FactVectorHash(envelope)
	first, err := oracleV2Commitment(medicalDevLiteChannel, req.ID, req.ClaimVersion, "oracle1", digest, "PANEL_REVIEW", salt)
	requireNoError(t, err)
	r1Actor(ctx, "oracle", "oracle1")
	_, err = c.SubmitOracleCommitmentV2(ctx, req.ID, first)
	requireNoError(t, err)
	r1Actor(ctx, "oracle", "oracle2")
	_, err = c.SubmitOracleCommitmentV2(ctx, req.ID, first)
	requireError(t, err, "already submitted")
	second, err := oracleV2Commitment(medicalDevLiteChannel, req.ID, req.ClaimVersion, "oracle2", digest, "PANEL_REVIEW", salt)
	requireNoError(t, err)
	_, err = c.SubmitOracleCommitmentV2(ctx, req.ID, second)
	requireNoError(t, err)
	_, err = c.RevealOracleResultV2(ctx, req.ID, envelope, "PANEL_REVIEW", salt, diagnostics)
	requireError(t, err, "phase is closed")
	ctx.stub.timestamp = timestamppb.New(ctx.stub.timestamp.AsTime().Add(61 * time.Second))
	_, err = c.RevealOracleResultV2(ctx, req.ID, envelope, "AUTO_APPROVE", salt, diagnostics)
	requireError(t, err, "does not match facts")
	_, err = c.RevealOracleResultV2(ctx, req.ID, envelope, "PANEL_REVIEW", salt, diagnostics)
	requireNoError(t, err)
	r1Actor(ctx, "oracle", "oracle1")
	_, err = c.RevealOracleResultV2(ctx, req.ID, envelope, "PANEL_REVIEW", salt, diagnostics)
	requireNoError(t, err)
	final, err := c.ReadOracleRequest(ctx, req.ID)
	requireNoError(t, err)
	if final.Status != "FAILED" || final.Decision != "PANEL_REVIEW" || final.FactVectorHash != digest {
		t.Fatal("wrong exact v2 finalization")
	}
	r1Actor(ctx, "policyholder", "holder")
	retry, err := c.FinalizeOracleTimeout(ctx, req.ID)
	requireNoError(t, err)
	if retry.ResultHash != final.ResultHash {
		t.Fatal("retry altered finalization")
	}
}

func TestR1HoldAfterAuthorizationBlocksNewDebitAndReconcilesExecutedDebit(t *testing.T) {
	for _, executed := range []bool{false, true} {
		f := newMedicalSettlementFixture(t)
		c, ctx := f.contract, f.context
		_, err := c.activeMedicalRoutingRelease(ctx)
		requireNoError(t, err)
		request, err := c.ReadOracleRequest(ctx, f.claim.CurrentOracleRequestID)
		requireNoError(t, err)
		request.ModelReleaseID = genesisMedicalModelID
		requireNoError(t, overwriteAsset(ctx, "oracleRequest", request.ID, request))
		_, err = f.authorize()
		requireNoError(t, err)
		reference := strings.Repeat("d", 64)
		if executed {
			r1Actor(ctx, "bankOfficer", "bank")
			_, err = c.ExecuteMedicalSettlementTransfer(ctx, "settlement", "payout", reference)
			requireNoError(t, err)
		}
		r1Actor(ctx, "insurerAdmin", "insurer")
		_, err = c.HoldMedicalModelRelease(ctx, genesisMedicalModelID, reference)
		requireNoError(t, err)
		if executed {
			head, err := medicalEpisodeHead(ctx, f.claim.EpisodeID)
			requireNoError(t, err)
			head.Revision++
			requireNoError(t, overwriteAsset(ctx, "medicalEpisode", head.ID, head))
		}
		settlement, err := f.confirm("payout")
		if !executed {
			requireError(t, err, "model held; settlement requires review")
		} else {
			requireNoError(t, err)
			account, err := c.ReadBankAccountReference(ctx, "reserve")
			requireNoError(t, err)
			if !settlement.PostPaymentAuditRequired || settlement.Status != "CONFIRMED" || account.BalanceMinor != 6000 {
				t.Fatal("executed payout was not recorded exactly once")
			}
		}
	}
}

func TestR1HeldPanelApprovalSupersedesOriginalAndCorrectionRetiresReplacement(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx, claim := f.contract, f.context, f.claim
	release, err := c.activeMedicalRoutingRelease(ctx)
	requireNoError(t, err)
	request, err := c.ReadOracleRequest(ctx, claim.CurrentOracleRequestID)
	requireNoError(t, err)
	request.ModelReleaseID = release.ID
	requireNoError(t, overwriteAsset(ctx, "oracleRequest", request.ID, request))
	authorized, err := f.authorize()
	requireNoError(t, err)
	claim, err = c.ReadClaim(ctx, claim.ID)
	requireNoError(t, err)
	original, err := c.ReadOriginalMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	requireNoError(t, err)

	_, err = c.HoldMedicalModelRelease(ctx, release.ID, strings.Repeat("d", 64))
	requireNoError(t, err)
	claim.MedicalHeldReleaseID = request.ModelReleaseID
	requireNoError(t, c.supersedeUnpaidMedicalSettlement(ctx, claim))
	retired, err := c.ReadSettlement(ctx, authorized.ID)
	requireNoError(t, err)
	liability, err := c.ReadLiability(ctx, "liability-claim-"+claim.ID)
	requireNoError(t, err)
	if retired.Status != "RETIRED" || liability.Status != "SUPERSEDED" {
		t.Fatalf("held settlement %s and liability %s remain payable", retired.Status, liability.Status)
	}

	claim.Status = "APPROVED"
	claim.CurrentReviewID, claim.AuditorDecisionID = "panel-review", "panel-decision"
	review := &ClaimReview{ID: claim.CurrentReviewID, ClaimID: claim.ID, MedicalVersion: claim.Version,
		Status: "APPROVED", Approvals: 3, ApprovalThreshold: 3, ClosedAt: "2026-09-05T12:00:00Z"}
	requireNoError(t, c.recordMedicalApproval(ctx, claim, request, review))
	effective, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	audit, err := c.ReadOriginalMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if effective.Path != "PANEL" || effective.Hash == original.Hash || effective.SupersededBy != "" ||
		audit.SupersededBy != effective.Hash {
		t.Fatal("panel approval did not replace the held certificate")
	}
	audit.SupersededBy = ""
	if *audit != *original {
		t.Fatal("supersession mutated the original certificate")
	}

	requireNoError(t, c.supersedeMedicalCertificateForCorrection(ctx, claim))
	requireNoError(t, c.supersedeMedicalCertificateForCorrection(ctx, claim))
	superseded, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if superseded.Hash != effective.Hash || superseded.SupersededBy != medicalRevisionKey(claim.ID, claim.Version+1) {
		t.Fatal("correction did not link the replacement to the next claim version")
	}
	_, err = c.verifyMedicalApproval(ctx, claim)
	requireError(t, err, "only an effective medical approval certificate")
}

func TestR1MedicalRequestPinsAuthorityAndScopesPrivateSources(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx, claim := f.contract, f.context, f.claim
	r1Roster(t, c, ctx)
	hash := strings.Repeat("a", 64)
	release := &MedicalModelRelease{ID: "routing-e2", ModelVersion: medicalModelE2, GovernanceVersion: 2,
		ArtifactHash: hash, IntendedTask: "ROUTING", Status: "ACTIVE"}
	requireNoError(t, putState(ctx, "medicalModelRelease", release.ID, release))
	requireNoError(t, overwriteAsset(ctx, "activeMedicalModelRelease", "ROUTING", release.ID))
	for _, kind := range []string{"HOSPITAL_HIS", "REGULATOR", "CLAIMANT_RECEIPT"} {
		issuer := &SourceIssuer{IssuerID: "source-" + kind, KeyVersion: 1, Kind: kind, Status: "ACTIVE",
			ValidFrom: "2026-09-01T00:00:00Z", ValidUntil: "2026-10-01T00:00:00Z", HospitalID: claim.HospitalID}
		requireNoError(t, putState(ctx, "sourceIssuer", sourceKey(issuer.IssuerID, 1), issuer))
		requireNoError(t, putState(ctx, "sourceAuthority", sourceScope(kind, claim.HospitalID), issuer))
		requireNoError(t, putState(ctx, "latestSourceFeed", issuer.IssuerID, &SourceFeed{SourceFeedPin: SourceFeedPin{
			IssuerID: issuer.IssuerID, KeyVersion: 1, FeedVersion: 1, Root: hash,
			EffectiveAt: "2026-09-04T11:00:00Z", AnchoredAt: "2026-09-04T12:00:00Z",
		}}))
	}
	episode := &MedicalEpisode{ID: claim.EpisodeID, Revision: 1, HospitalID: claim.HospitalID,
		PatientReferenceHash: hash, Service: "DIAGNOSTIC", BillMinor: 5000, DiagnosisCode: "TEST",
		ServiceDate: claim.IncidentDate, AdmissionDate: claim.IncidentDate, DischargeDate: claim.IncidentDate, InvoiceDate: claim.IncidentDate}
	requireNoError(t, putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(episode.ID, 1), episode))
	claim.MedicalAssociationKey = medicalAssociationKey(episode)
	requireNoError(t, putPrivateState(ctx, "medicalAssociation", claim.MedicalAssociationKey, &MedicalAssociation{
		BeneficiaryID: claim.ClaimantID, Version: 1, Verified: true,
	}))
	requireNoError(t, putState(ctx, "medicalAssociationVersion", claim.MedicalAssociationKey, struct{ Version int }{1}))
	claim.Status, claim.CurrentOracleRequestID = "SUBMITTED", ""
	claim.HospitalInvoiceID = medicalRevisionKey(episode.ID, 1)
	claim.EvidenceIDs = []string{"fixture-invoice"}
	requireNoError(t, putState(ctx, "evidenceReference", "fixture-invoice", &EvidenceReference{
		ID: "fixture-invoice", ClaimID: claim.ID, ClaimVersion: claim.Version, DocumentType: "INVOICE", SubmittedBy: claim.ClaimantID,
	}))
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	ctx.stub.transient["medicalOCRSummary"], _ = json.Marshal(MedicalOCRSummary{
		EvidenceID: "fixture-invoice", InvoiceNumber: "INV-1", AmountMinor: 5000,
		ServiceDate: claim.IncidentDate, HospitalID: claim.HospitalID, DerivedFrom: "invoice-row",
	})
	r1Actor(ctx, "policyholder", claim.ClaimantID)
	requireNoError(t, c.RecordMedicalOCRSummary(ctx, claim.ID))
	r1Actor(ctx, "insurerAdmin", "insurer")
	_, err := c.RequestOracleVerification(ctx, "legacy-request", claim.ID, "", "", "", "", 0, "", "")
	requireError(t, err, "require RequestOracleVerificationV2")
	req, err := c.RequestOracleVerificationV2(ctx, "diagnostic-r1", claim.ID)
	requireNoError(t, err)
	if len(req.Manifest.Pins) != 3 || !oracleV2Hash.MatchString(req.ManifestHash) ||
		req.CommitDeadline != "2026-09-05T12:01:00Z" || req.RevealDeadline != "2026-09-05T12:03:00Z" ||
		req.ModelReleaseID != release.ID || req.RosterVersion != "roster-one" {
		t.Fatal("request did not pin the governed routing inputs and ledger deadlines")
	}
	r1Actor(ctx, "oracle", "other-oracle")
	_, err = c.ReadMedicalOracleSourcesForRequest(ctx, req.ID)
	requireError(t, err, "unavailable for this subject")
	r1Actor(ctx, "oracle", "oracle1")
	sources, err := c.ReadMedicalOracleSourcesForRequest(ctx, req.ID)
	requireNoError(t, err)
	if sources.Receipt == nil || sources.Receipt.InvoiceNumber != "INV-1" || sources.Current.AssociationStatus != "VERIFIED" {
		t.Fatal("assigned worker did not receive the claim's scoped context")
	}
	r1Actor(ctx, "policyholder", claim.ClaimantID)
	_, err = c.FinalizeOracleTimeout(ctx, req.ID)
	requireError(t, err, "has not timed out")
	ctx.stub.timestamp = timestamppb.New(ctx.stub.timestamp.AsTime().Add(4 * time.Minute))
	_, err = c.FinalizeOracleTimeout(ctx, req.ID)
	requireNoError(t, err)
	r1Actor(ctx, "insurerAdmin", "insurer")
	review, err := c.PrepareMedicalReview(ctx, claim.ID, "r1-preparation", "2026-09-05T12:06:00Z")
	requireNoError(t, err)
	ctx.stub.timestamp = timestamppb.New(ctx.stub.timestamp.AsTime().Add(3 * time.Minute))
	r1Actor(ctx, "auditor", "auditor1")
	review, err = c.FinalizeExpiredReview(ctx, review.ID)
	requireNoError(t, err)
	if review.Status != "PROCEDURAL_FAILURE" {
		t.Fatal("the case must retain a recovery path after preparation expires")
	}
	r1Actor(ctx, "insurerAdmin", "insurer")
	_, err = c.RecoverMedicalReview(ctx, review.ID, "r1-recovery", "2026-09-05T12:09:00Z")
	requireNoError(t, err)
}
