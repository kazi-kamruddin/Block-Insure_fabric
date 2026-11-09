package insurance

import (
	"strings"
	"testing"
)

func TestEvidenceRegistrationPinsPreparedClaimVersion(t *testing.T) {
	c := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "holder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	claim := &Claim{ID: "claim-evidence-version", Version: 2, ClaimantID: "policyholder1", Status: "SUBMITTED"}
	requireNoError(t, putState(ctx, "claim", claim.ID, claim))
	_, err := c.AddEvidenceReferenceForVersion(ctx, claim.ID, "evidence-version", "INVOICE", strings.Repeat("a", 64), strings.Repeat("b", 64), 1)
	requireError(t, err, "version changed")
	evidence, err := c.AddEvidenceReferenceForVersion(ctx, claim.ID, "evidence-version", "INVOICE", strings.Repeat("a", 64), strings.Repeat("b", 64), 2)
	requireNoError(t, err)
	if evidence.ClaimVersion != 2 {
		t.Fatal("evidence attached to the wrong claim version")
	}
}
