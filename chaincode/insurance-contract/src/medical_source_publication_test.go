package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestMedicalSourcePublicationUsesScopedPrivateInputs(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx, claim := f.contract, f.context, f.claim
	claim.Status = "SUBMITTED"
	claim.EvidenceIDs = []string{"receipt-one"}
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	requireNoError(t, putState(ctx, "evidenceReference", "receipt-one", &EvidenceReference{
		ID: "receipt-one", ClaimID: claim.ID, ClaimVersion: claim.Version, DocumentType: "RECEIPT",
	}))
	requireNoError(t, putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(claim.EpisodeID, 1), &MedicalEpisode{
		ID: claim.EpisodeID, HospitalID: claim.HospitalID, Revision: 1, Service: "DIAGNOSTIC", BillMinor: 5000,
		ServiceDate: claim.IncidentDate, InvoiceDate: claim.IncidentDate, AdmissionDate: claim.IncidentDate, DischargeDate: claim.IncidentDate,
	}))
	invoice := "INV-1158"
	reference := sha256.Sum256([]byte(invoice))
	referenceHash := hex.EncodeToString(reference[:])
	requireError(t, rememberMedicalInvoiceNumber(ctx, claim.EpisodeID, referenceHash, "OTHER-INVOICE"), "must match")
	requireNoError(t, rememberMedicalInvoiceNumber(ctx, claim.EpisodeID, referenceHash, invoice))
	requireNoError(t, rememberMedicalInvoiceNumber(ctx, claim.EpisodeID, referenceHash, invoice))

	_, err := c.ReadHospitalClaimSource(ctx, claim.ID, claim.Version)
	requireError(t, err, "caller MSP")
	absent, err := c.ReadMedicalClaimReceiptSource(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if absent.Receipt != nil {
		t.Fatal("source publication invented a receipt")
	}
	setIdentity(ctx, "other-hospital", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "other-hospital"})
	_, err = c.ReadHospitalClaimSource(ctx, claim.ID, claim.Version)
	requireError(t, err, "hospital of record")
	setIdentity(ctx, "hospital", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": claim.HospitalID})
	_, err = c.ReadHospitalClaimSource(ctx, claim.ID, claim.Version+1)
	requireError(t, err, "claim version")
	source, err := c.ReadHospitalClaimSource(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if source.InvoiceNumber != invoice || source.BillMinor != 5000 || source.InvoiceHash == "" {
		t.Fatal("Hospital source did not return its committed invoice")
	}
	_, err = c.ReadMedicalClaimReceiptSource(ctx, claim.ID, claim.Version)
	requireError(t, err, "caller MSP")

	setIdentity(ctx, claim.ClaimantID, "InsurerMSP", "policyholder", map[string]string{"subjectId": claim.ClaimantID})
	ctx.stub.transient["medicalOCRSummary"], err = json.Marshal(MedicalOCRSummary{
		EvidenceID: "receipt-one", InvoiceNumber: "OTHER-INVOICE", AmountMinor: 6000, ServiceDate: claim.IncidentDate, HospitalID: claim.HospitalID,
	})
	requireNoError(t, err)
	requireNoError(t, c.RecordMedicalOCRSummary(ctx, claim.ID))
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	receipt, err := c.ReadMedicalClaimReceiptSource(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if receipt.Receipt == nil || receipt.Receipt.InvoiceNumber != "OTHER-INVOICE" || receipt.Receipt.AmountMinor != 6000 ||
		receipt.Receipt.DerivedFrom != medicalHospitalFeedRecordID(claim.ID, claim.Version) {
		t.Fatal("receipt did not preserve the claimant's separately recorded facts and deterministic lineage")
	}
}
