package insurance

import (
	"encoding/json"
	"testing"
)

func TestHospitalModelFactsIsolationAndImmutability(t *testing.T) {
	c, ctx, invoice := invoiceFlowFixture(t)
	facts := HospitalModelFacts{InvoiceID: invoice.ID, TreatmentType: "SURGERY", DiagnosisCode: "D1", InvoiceDate: "2026-06-20", ExpectedMinMinor: 10000, ExpectedMaxMinor: 80000, LicenseStatus: "ACTIVE"}
	payload, _ := json.Marshal(facts)
	ctx.stub.transient["hospitalModelFacts"] = payload
	setIdentity(ctx, "other-hospital", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital2"})
	_, err := c.RecordHospitalModelFacts(ctx, invoice.ID)
	requireError(t, err, "another Hospital")
	setIdentity(ctx, "hospital-cert", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital1"})
	_, err = c.RecordHospitalModelFacts(ctx, invoice.ID)
	requireNoError(t, err)
	_, err = c.RecordHospitalModelFacts(ctx, invoice.ID)
	requireError(t, err, "already exists")
	setIdentity(ctx, "other-hospital", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital2"})
	_, err = c.ReadHospitalModelFacts(ctx, invoice.ID)
	requireError(t, err, "another Hospital")
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", nil)
	_, err = c.ReadHospitalModelFacts(ctx, invoice.ID)
	requireError(t, err, "access denied")
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	stored, err := c.ReadHospitalModelFacts(ctx, invoice.ID)
	requireNoError(t, err)
	if stored.DiagnosisCode != "D1" {
		t.Fatal("private model facts were not retained")
	}
}
