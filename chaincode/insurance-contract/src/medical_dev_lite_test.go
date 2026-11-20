package insurance

import (
	"strings"
	"testing"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type medicalResponseStub struct {
	*memoryStub
	function string
}

func (s medicalResponseStub) GetCreator() ([]byte, error) { return nil, nil }
func (s medicalResponseStub) GetFunctionAndParameters() (string, []string) {
	return s.function, []string{"record"}
}

func TestDevLiteResponseSchemaKeepsAbsentFieldsOptional(t *testing.T) {
	c, ctx := medicalTestContext()
	cc, err := contractapi.NewChaincode(c)
	requireNoError(t, err)
	requireNoError(t, putState(ctx, "claim", "record", &Claim{ID: "record", Status: "SUBMITTED", EvidenceIDs: []string{}}))
	requireNoError(t, putState(ctx, "settlement", "record", &Settlement{ID: "record", Status: "CONFIRMED"}))
	requireNoError(t, putState(ctx, "oracleRegistrySnapshot", "record", &OracleRegistrySnapshot{ID: "record"}))
	for _, fn := range []string{"ReadClaim", "ReadSettlement", "ReadOracleRegistrySnapshot"} {
		result := cc.Invoke(medicalResponseStub{memoryStub: ctx.stub, function: fn})
		if result.Status != 200 {
			t.Fatalf("%s returned %d: %s", fn, result.Status, result.Message)
		}
	}
}

func TestDevLiteApprovalAttestationAndEscalation(t *testing.T) {
	c, ctx := medicalTestContext()
	ctx.stub.channelID = "insurance-dev-lite-190"
	if !isMedicalCandidate(ctx) {
		t.Fatal("dev-lite must accept medical contracts")
	}
	hash := strings.Repeat("b", 64)
	ctx.stub.transient["duplicateIndexKey"] = []byte(strings.Repeat("k", 32))
	_, err := c.ActivateMedicalApprovalCertificates(ctx)
	requireNoError(t, err)
	_, err = c.ActivateMedicalApprovalCertificates(ctx)
	requireError(t, err, "already exists")
	_, err = c.PublishOracleRegistrySnapshot(ctx, "unscoped", 1, hash, "hospital-invoice-rules-v2", hash, 1)
	requireError(t, err, "hospital scope")
	_, err = c.ProposeMedicalRegistrySnapshot(ctx, "proposed", "hospital-demo", 1, hash, "hospital-invoice-rules-v2", hash, 1)
	requireNoError(t, err)
	setIdentity(ctx, "other", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital-other"})
	_, err = c.AttestMedicalRegistrySnapshot(ctx, "proposed", hash)
	requireError(t, err, "assigned hospital")
	setIdentity(ctx, "hospital", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital-demo"})
	_, err = c.AttestMedicalRegistrySnapshot(ctx, "proposed", strings.Repeat("a", 64))
	requireError(t, err, "root")
	snapshot, err := c.AttestMedicalRegistrySnapshot(ctx, "proposed", hash)
	requireNoError(t, err)
	if snapshot.Status != "ACTIVE" {
		t.Fatalf("attestation did not activate: %+v", snapshot)
	}

	claim := &Claim{ID: "dev-claim", EpisodeID: hash, EpisodeRevision: 1, MedicalAssociationKey: "verified", MedicalAssociationVersion: 1, HospitalID: "hospital-demo",
		ClaimantID: "holder", DescriptionHash: hash, AmountMinor: 4000, Version: 1, Status: "SUBMITTED", CreatedAt: "2026-09-05T12:00:00Z", UpdatedAt: "2026-09-05T12:00:00Z"}
	requireNoError(t, putState(ctx, "claim", claim.ID, claim))
	requireNoError(t, putState(ctx, "medicalEpisode", hash, &MedicalEpisodeHead{ID: hash, HospitalID: claim.HospitalID, Revision: 1, RevisionHash: hash}))
	requireNoError(t, putState(ctx, "medicalAssociationVersion", "verified", struct{ Version int }{1}))
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "holder"})
	ctx.stub.timestamp = timestamppb.New(time.Date(2026, 9, 6, 11, 59, 0, 0, time.UTC))
	_, err = c.EscalateStalledMedicalClaim(ctx, claim.ID)
	requireError(t, err, "deadline")
	ctx.stub.timestamp = timestamppb.New(time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC))
	review, err := c.EscalateStalledMedicalClaim(ctx, claim.ID)
	requireNoError(t, err)
	setIdentity(ctx, "auditor1", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor1"})
	_, err = c.OpenMedicalVoting(ctx, review.ID, "2026-09-07T12:00:00Z")
	requireNoError(t, err)
	for _, id := range review.AssignedAuditorIDs[:3] {
		setIdentity(ctx, id, "AuditorMSP", "auditor", map[string]string{"subjectId": id})
		_, err = c.RecordMedicalAuditorDecision(ctx, review.ID, id+"-approval", "APPROVE", "TERMS_AND_EVIDENCE_SUPPORT", hash)
		requireNoError(t, err)
	}
	approved, err := c.ReadClaim(ctx, claim.ID)
	requireNoError(t, err)
	certificate, err := c.verifyMedicalApproval(ctx, approved)
	requireNoError(t, err)
	if certificate.Path != "PANEL" || certificate.ReviewID != review.ID || certificate.EscalatedAt == "" {
		t.Fatalf("unexpected approval evidence: %+v", certificate)
	}
	approved.Version++
	_, err = c.verifyMedicalApproval(ctx, approved)
	requireError(t, err, "certificate")
}

func TestDevLitePrivateDuplicateSignals(t *testing.T) {
	_, ctx := medicalTestContext()
	first := &MedicalEpisode{ID: "first", Service: "SURGERY", ServiceDate: "2026-09-30", AdmissionDate: "2026-09-29", DischargeDate: "2026-10-01", BillMinor: 10000}
	edited := &MedicalEpisode{ID: "second", Service: "SURGERY", ServiceDate: "2026-10-01", AdmissionDate: "2026-09-30", DischargeDate: "2026-10-02", BillMinor: 10200}
	repeat := &MedicalEpisode{ID: "third", Service: "SURGERY", ServiceDate: "2026-10-12", AdmissionDate: "2026-10-12", DischargeDate: "2026-10-12", BillMinor: 10000}
	key := []byte(strings.Repeat("k", 32))
	for _, pair := range []struct {
		episode  *MedicalEpisode
		referral bool
	}{{first, false}, {edited, true}, {repeat, false}} {
		found, err := indexMedicalDuplicate(ctx, key, "holder", pair.episode)
		requireNoError(t, err)
		if found != pair.referral {
			t.Fatalf("wrong referral for %s", pair.episode.ID)
		}
	}
}
