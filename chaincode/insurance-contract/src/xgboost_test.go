package insurance

import (
	"strings"
	"testing"
)

func TestXGBoostRoutingCodeVersionIsolation(t *testing.T) {
	for _, item := range []struct {
		version  string
		code     string
		verified bool
		valid    bool
	}{
		{"model-v1", "VERIFIED", true, true},
		{"model-v1", "VERIFIED", false, false},
		{"model-v1", "XGB_AUTO:" + strings.Repeat("A", 64), true, false},
		{"fabric-xgb-synthetic-v1", "XGB_AUTO:" + strings.Repeat("A", 64), true, true},
		{"fabric-xgb-synthetic-v1", "XGB_REVIEW:" + strings.Repeat("B", 64), false, true},
		{"fabric-xgb-synthetic-v1", "XGB_AUTO:" + strings.Repeat("A", 64), false, false},
		{"fabric-xgb-synthetic-v1", "XGB_AUTO:bad", true, false},
		{"fabric-xgb-synthetic-v1", "XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE", false, true},
		{"fabric-xgb-synthetic-v1", "VERIFIED", true, false},
		{"fabric-xgb-synthetic-v1", "PATIENT_MISMATCH", false, true},
	} {
		if err := validateOracleRoutingCode(item.version, item.code, item.verified); (err == nil) != item.valid {
			t.Errorf("%s / %s / %v: error %v", item.version, item.code, item.verified, err)
		}
	}
}
