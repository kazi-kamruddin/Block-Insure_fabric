package insurance

import (
	"strings"
	"testing"
)

func TestDevLiteVersionedDuplicateRules(t *testing.T) {
	for _, version := range []int{1, 2} {
		c, ctx := medicalTestContext()
		ctx.stub.channelID = medicalDevLiteChannel
		ctx.stub.transient["duplicateIndexKey"] = []byte(strings.Repeat("x", 32))
		_, err := c.ActivateMedicalApprovalCertificates(ctx)
		requireNoError(t, err)
		if version == 1 {
			requireNoError(t, c.SetDevLiteDuplicateRule(ctx, version))
		}
		episode := MedicalEpisode{ID: "original", HospitalID: "hospital", Service: "SURGERY", ServiceDate: "2026-11-01",
			AdmissionDate: "2026-11-01", DischargeDate: "2026-11-08", BillMinor: 10_000}
		check := func(episode MedicalEpisode, want bool) {
			t.Helper()
			claim := &Claim{ClaimantID: "holder"}
			requireNoError(t, c.screenMedicalDuplicate(ctx, claim, &episode))
			if claim.MedicalDuplicateReview != want || claim.MedicalDuplicateRuleVersion != version {
				t.Fatalf("rule %d recorded unexpected result for %s", version, episode.ID)
			}
		}
		check(episode, false)
		correction := episode
		correction.BillMinor = 19_000
		check(correction, false)
		successor := episode
		successor.ID, successor.ServiceDate, successor.BillMinor = "overlap", "2026-11-08", 45_000
		check(successor, version == 2)
		readmission := episode
		readmission.ID, readmission.ServiceDate, readmission.AdmissionDate, readmission.DischargeDate = "readmission", "2026-11-09", "2026-11-09", "2026-11-10"
		check(readmission, false)
	}
}
