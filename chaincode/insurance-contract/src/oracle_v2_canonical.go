package insurance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

const oracleV2SafeInteger = int64(9007199254740991)
const oracleV2Policy = "diagnostic-v1"

var oracleV2Identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
var oracleV2Hash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var oracleV2RequiredFacts = []string{"invoiceIssued", "licenceActiveOnServiceDate", "serviceAccredited", "tariffBand", "receiptConsistent"}

func oracleV2Node(decoder *json.Decoder, depth int) (any, error) {
	if depth > 32 {
		return nil, fmt.Errorf("canonical JSON nesting limit")
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch token := token.(type) {
	case string:
		return token, nil
	case json.Number:
		value, err := strconv.ParseInt(string(token), 10, 64)
		if err != nil || value < -oracleV2SafeInteger || value > oracleV2SafeInteger {
			return nil, fmt.Errorf("canonical JSON requires safe integers")
		}
		return value, nil
	case json.Delim:
		switch token {
		case '{':
			object := map[string]any{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				name, ok := key.(string)
				if _, duplicate := object[name]; !ok || duplicate {
					return nil, fmt.Errorf("invalid or duplicate canonical JSON key")
				}
				object[name], err = oracleV2Node(decoder, depth+1)
				if err != nil {
					return nil, err
				}
			}
			_, err := decoder.Token()
			return object, err
		case '[':
			array := []any{}
			for decoder.More() {
				value, err := oracleV2Node(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				array = append(array, value)
			}
			_, err := decoder.Token()
			return array, err
		}
	}
	return nil, fmt.Errorf("unsupported canonical JSON value")
}

func oracleV2ParseJSON(raw []byte) (any, error) {
	if !utf8.Valid(raw) {
		return nil, fmt.Errorf("canonical JSON requires valid UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := oracleV2Node(decoder, 0)
	if err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, fmt.Errorf("canonical JSON contains trailing values")
	}
	return value, nil
}

func appendOracleV2Canonical(out *bytes.Buffer, value any) {
	switch value := value.(type) {
	case string:
		var quoted bytes.Buffer
		encoder := json.NewEncoder(&quoted)
		encoder.SetEscapeHTML(false)
		_ = encoder.Encode(value)
		out.Write(bytes.TrimSuffix(quoted.Bytes(), []byte{'\n'}))
	case int64:
		out.WriteString(strconv.FormatInt(value, 10))
	case []any:
		out.WriteByte('[')
		for i, item := range value {
			if i != 0 {
				out.WriteByte(',')
			}
			appendOracleV2Canonical(out, item)
		}
		out.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		out.WriteByte('{')
		for i, key := range keys {
			if i != 0 {
				out.WriteByte(',')
			}
			appendOracleV2Canonical(out, key)
			out.WriteByte(':')
			appendOracleV2Canonical(out, value[key])
		}
		out.WriteByte('}')
	}
}

func oracleV2Canonical(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	parsed, err := oracleV2ParseJSON(raw)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	appendOracleV2Canonical(&out, parsed)
	return out.String(), nil
}

func oracleV2HashCanonical(domain, encoded string) string {
	sum := sha256.Sum256([]byte(domain + "\x00" + encoded))
	return hex.EncodeToString(sum[:])
}

func oracleV2Digest(domain string, value any) (string, error) {
	if domain == "" || strings.ContainsRune(domain, 0) {
		return "", fmt.Errorf("invalid canonical domain")
	}
	encoded, err := oracleV2Canonical(value)
	if err != nil {
		return "", err
	}
	return oracleV2HashCanonical(domain, encoded), nil
}

type OracleV2Fact struct {
	Status    string   `json:"status"`
	Evidence  []string `json:"evidence"`
	Integrity string   `json:"integrity,omitempty" metadata:",optional"`
}

type OracleV2FactVector struct {
	Schema        string                  `json:"schema"`
	ClaimID       string                  `json:"claimId"`
	ClaimVersion  int                     `json:"claimVersion"`
	ManifestHash  string                  `json:"manifestHash"`
	PolicyVersion string                  `json:"policyVersion"`
	Facts         map[string]OracleV2Fact `json:"facts"`
	TariffBand    string                  `json:"tariffBand"`
	ReceiptCheck  string                  `json:"receiptCheck"`
	ModelAdvice   string                  `json:"modelAdvice"`
}

func parseOracleV2FactVector(encoded string) (*OracleV2FactVector, error) {
	if len(encoded) > 64*1024 {
		return nil, fmt.Errorf("fact vector too large")
	}
	if _, err := oracleV2ParseJSON([]byte(encoded)); err != nil {
		return nil, fmt.Errorf("noncanonical fact vector: %w", err)
	}
	var vector OracleV2FactVector
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&vector); err != nil {
		return nil, fmt.Errorf("noncanonical fact vector: %w", err)
	}
	normalized, err := oracleV2Canonical(vector)
	if err != nil || encoded != normalized || vector.Facts == nil || vector.Schema != "fact-vector-v1" ||
		!oracleV2Identifier.MatchString(vector.ClaimID) || vector.ClaimVersion < 1 ||
		!oracleV2Identifier.MatchString(vector.PolicyVersion) || !oracleV2Hash.MatchString(vector.ManifestHash) ||
		!slices.Contains([]string{"BELOW", "IN", "ABOVE", "FAR_ABOVE"}, vector.TariffBand) ||
		!slices.Contains([]string{"MATCH", "MISMATCH", "ABSENT"}, vector.ReceiptCheck) ||
		(vector.ModelAdvice != "AUTO" && vector.ModelAdvice != "REVIEW") {
		return nil, fmt.Errorf("noncanonical fact vector")
	}
	for name, fact := range vector.Facts {
		if name != "paymentOccurred" && !slices.Contains(oracleV2RequiredFacts, name) ||
			!slices.Contains([]string{"PASS", "CONTRADICTED", "INSUFFICIENT", "UNVERIFIABLE"}, fact.Status) ||
			fact.Evidence == nil || (fact.Status == "PASS" && len(fact.Evidence) == 0) {
			return nil, fmt.Errorf("invalid fact evidence")
		}
		for i, reference := range fact.Evidence {
			if !oracleV2Identifier.MatchString(reference) || (i > 0 && reference <= fact.Evidence[i-1]) {
				return nil, fmt.Errorf("noncanonical fact evidence")
			}
		}
		switch fact.Integrity {
		case "":
		case "INVALID_SIGNATURE":
			if fact.Status == "UNVERIFIABLE" {
				continue
			}
			return nil, fmt.Errorf("invalid fact integrity reason")
		case "INACTIVE_LICENCE":
			if name == "licenceActiveOnServiceDate" && fact.Status == "CONTRADICTED" {
				continue
			}
			return nil, fmt.Errorf("invalid fact integrity reason")
		case "UNACCREDITED_SERVICE":
			if name == "serviceAccredited" && fact.Status == "CONTRADICTED" {
				continue
			}
			return nil, fmt.Errorf("invalid fact integrity reason")
		default:
			return nil, fmt.Errorf("invalid fact integrity reason")
		}
	}
	return &vector, nil
}

func oracleV2Decision(vector *OracleV2FactVector) (string, error) {
	if vector.PolicyVersion != oracleV2Policy {
		return "", fmt.Errorf("unsupported Oracle v2 policy")
	}
	for _, fact := range vector.Facts {
		if fact.Integrity != "" {
			return "INTEGRITY_FAIL", nil
		}
	}
	for _, fact := range oracleV2RequiredFacts {
		if vector.Facts[fact].Status != "PASS" {
			return "PANEL_REVIEW", nil
		}
	}
	if vector.ReceiptCheck == "MATCH" && vector.ModelAdvice == "AUTO" &&
		(vector.TariffBand == "BELOW" || vector.TariffBand == "IN") {
		return "AUTO_APPROVE", nil
	}
	return "PANEL_REVIEW", nil
}

func oracleV2FactVectorHash(encoded string) string {
	return oracleV2HashCanonical("oracle-v2:fact-vector", encoded)
}

func oracleV2Commitment(channel, requestID string, claimVersion int, subject, factVectorHash, decision, salt string) (string, error) {
	if !oracleV2Identifier.MatchString(channel) || !oracleV2Identifier.MatchString(requestID) ||
		claimVersion < 1 || !oracleV2Identifier.MatchString(subject) || !oracleV2Hash.MatchString(factVectorHash) ||
		!oracleV2Hash.MatchString(salt) || !slices.Contains([]string{"AUTO_APPROVE", "PANEL_REVIEW", "INTEGRITY_FAIL"}, decision) {
		return "", fmt.Errorf("invalid Oracle v2 commitment inputs")
	}
	return oracleV2Digest("oracle-v2:commit", []any{channel, requestID, claimVersion, subject, factVectorHash, decision, salt})
}

func oracleV2TariffBand(bill, minimum, maximum int64) string {
	switch {
	case bill < minimum:
		return "BELOW"
	case bill <= maximum:
		return "IN"
	case bill*100 <= maximum*115:
		return "ABOVE"
	default:
		return "FAR_ABOVE"
	}
}

func oracleV2ModelAdvice(score, threshold int64) string {
	if score >= threshold {
		return "REVIEW"
	}
	return "AUTO"
}
