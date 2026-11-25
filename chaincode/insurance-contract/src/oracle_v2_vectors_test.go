package insurance

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestOracleV2PortableVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/oracle-v2-protocol.json")
	requireNoError(t, err)
	var fixture struct {
		Portable        json.RawMessage
		Encoding        string
		Domain          string
		Digest          string
		Vector          OracleV2FactVector
		VectorHash      string
		Commitment      string
		CommitmentInput struct {
			ChannelID, RequestID, OracleSubject, FactVectorHash, Decision, Salt string
			ClaimVersion                                                        int
		}
		Threshold         [][]json.RawMessage
		Tariff            [][]json.RawMessage
		Decisions         []struct{ Field, Status, Integrity, Expected string }
		RejectedIntegrity []struct {
			Field, Status string
			Integrity     json.RawMessage
		}
	}
	requireNoError(t, json.Unmarshal(raw, &fixture))
	encoded, err := oracleV2Canonical(fixture.Portable)
	requireNoError(t, err)
	digest, err := oracleV2Digest(fixture.Domain, fixture.Portable)
	requireNoError(t, err)
	if encoded != fixture.Encoding || digest != fixture.Digest {
		t.Fatal("portable encoding or digest differs")
	}
	encoded, err = oracleV2Canonical(fixture.Vector)
	requireNoError(t, err)
	vector, err := parseOracleV2FactVector(encoded)
	requireNoError(t, err)
	if hash := oracleV2FactVectorHash(encoded); hash != fixture.VectorHash {
		t.Fatalf("wrong vector hash %s", hash)
	}
	in := fixture.CommitmentInput
	decision, err := oracleV2Decision(vector)
	requireNoError(t, err)
	got, err := oracleV2Commitment(in.ChannelID, in.RequestID, in.ClaimVersion, in.OracleSubject, in.FactVectorHash, in.Decision, in.Salt)
	requireNoError(t, err)
	if decision != in.Decision || got != fixture.Commitment {
		t.Fatal("wrong disposition or commitment")
	}
	other, err := oracleV2Commitment(in.ChannelID, in.RequestID, in.ClaimVersion, "oracle2", in.FactVectorHash, in.Decision, in.Salt)
	requireNoError(t, err)
	if other == got {
		t.Fatal("commitment did not bind subject")
	}
	for _, row := range fixture.Tariff {
		var bill, min, max int64
		var want string
		requireNoError(t, json.Unmarshal(row[0], &bill))
		requireNoError(t, json.Unmarshal(row[1], &min))
		requireNoError(t, json.Unmarshal(row[2], &max))
		requireNoError(t, json.Unmarshal(row[3], &want))
		if oracleV2TariffBand(bill, min, max) != want {
			t.Fatalf("tariff boundary %d", bill)
		}
	}
	for _, row := range fixture.Threshold {
		var score, threshold int64
		var want string
		requireNoError(t, json.Unmarshal(row[0], &score))
		requireNoError(t, json.Unmarshal(row[1], &threshold))
		requireNoError(t, json.Unmarshal(row[2], &want))
		if oracleV2ModelAdvice(score, threshold) != want {
			t.Fatalf("score boundary %d", score)
		}
	}
	for _, row := range fixture.Decisions {
		vector, err := parseOracleV2FactVector(encoded)
		requireNoError(t, err)
		vector.Facts[row.Field] = OracleV2Fact{Status: row.Status, Integrity: row.Integrity, Evidence: []string{}}
		raw, err := oracleV2Canonical(vector)
		requireNoError(t, err)
		vector, err = parseOracleV2FactVector(raw)
		requireNoError(t, err)
		decision, err := oracleV2Decision(vector)
		requireNoError(t, err)
		if decision != row.Expected {
			t.Fatalf("decision for %s = %s", row.Field, decision)
		}
	}
	for _, row := range fixture.RejectedIntegrity {
		var vector map[string]any
		requireNoError(t, json.Unmarshal([]byte(encoded), &vector))
		var integrity any
		requireNoError(t, json.Unmarshal(row.Integrity, &integrity))
		vector["facts"].(map[string]any)[row.Field] = map[string]any{
			"status": row.Status, "evidence": []string{"record-1"}, "integrity": integrity,
		}
		raw, err := json.Marshal(vector)
		requireNoError(t, err)
		if _, err := parseOracleV2FactVector(string(raw)); err == nil {
			t.Fatalf("accepted invalid integrity %s", row.Integrity)
		}
	}
	for _, bad := range []string{
		" " + encoded,
		strings.Replace(encoded, `"claimVersion":2`, `"claimVersion":2.0`, 1),
		strings.Replace(encoded, `"claimVersion":2`, `"claimVersion":null`, 1),
		strings.Replace(encoded, `"claimVersion":2`, `"claimVersion":true`, 1),
		strings.Replace(encoded, `"claimVersion":2`, `"claimVersion":2,"claimVersion":2`, 1),
		strings.Replace(encoded, `"claimVersion":2`, `"claimVersion":2,"unknown":2`, 1),
		strings.Replace(encoded, `"invoiceIssued":{`, `"invoiceIssued":{"integrity":"INVALID_SIGNATURE",`, 1),
		strings.Replace(encoded, `"synthetic-201"`, `"\udfff"`, 1),
	} {
		if _, err := parseOracleV2FactVector(bad); err == nil {
			t.Errorf("accepted noncanonical vector: %s", bad)
		}
	}
}
