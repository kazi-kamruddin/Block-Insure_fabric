package insurance

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type SourceIssuer struct {
	IssuerID        string   `json:"issuerId"`
	Kind            string   `json:"kind"`
	PublicKey       string   `json:"ed25519PublicKey"`
	KeyVersion      int      `json:"keyVersion"`
	ValidFrom       string   `json:"validFrom"`
	ValidUntil      string   `json:"validUntil"`
	Status          string   `json:"status"`
	AuthorizedFacts []string `json:"authorizedFacts"`
	ControlDomain   string   `json:"controlDomain"`
	HospitalID      string   `json:"hospitalId"`
	ApprovedMSPs    []string `json:"approvedMsps"`
	RevokedAt       string   `json:"revokedAt"`
}

type SourceFeedPin struct {
	IssuerID    string `json:"issuerId"`
	KeyVersion  int    `json:"keyVersion"`
	FeedVersion int    `json:"feedVersion"`
	Root        string `json:"root"`
	EffectiveAt string `json:"effectiveAt"`
	AnchoredAt  string `json:"anchoredAt"`
}

type SourceFeed struct {
	SourceFeedPin
	CoverageHash string `json:"coverageHash"`
	Signature    string `json:"signature"`
	Submitter    string `json:"submitter"`
}

type OracleV2Manifest struct {
	Schema      string          `json:"schema"`
	RequestedAt string          `json:"requestedAt"`
	Pins        []SourceFeedPin `json:"pins"`
}

var sourceFactsByKind = map[string][]string{
	"HOSPITAL_HIS":     {"invoiceIssued"},
	"REGULATOR":        {"licenceActiveOnServiceDate", "serviceAccredited", "tariffBand"},
	"CLAIMANT_RECEIPT": {"receiptConsistent"},
	"PAYMENT":          {"paymentOccurred"},
}

func sourceKey(id string, version int) string {
	return id + ":" + strconv.Itoa(version)
}

func sourceScope(kind, hospital string) string {
	if kind == "HOSPITAL_HIS" {
		return kind + ":" + hospital
	}
	return kind
}

func sourceEd25519Key(encoded string) (ed25519.PublicKey, error) {
	der, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.RawURLEncoding.EncodeToString(der) != encoded {
		return nil, fmt.Errorf("invalid source issuer public key encoding")
	}
	key, err := x509.ParsePKIXPublicKey(der)
	public, ok := key.(ed25519.PublicKey)
	if err != nil || !ok {
		return nil, fmt.Errorf("source issuer key must be Ed25519")
	}
	return public, nil
}

func (c *Contract) ProposeSourceIssuer(ctx contractapi.TransactionContextInterface, id, kind, publicKey string, keyVersion int, validFrom, validUntil, factsJSON, controlDomain, hospitalID string) (*SourceIssuer, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if !idPattern.MatchString(id) || len(id) > 115 || keyVersion < 1 || keyVersion > 999999999 || !oracleV2Identifier.MatchString(controlDomain) ||
		((kind == "HOSPITAL_HIS") != (hospitalID != "")) || (hospitalID != "" && !idPattern.MatchString(hospitalID)) {
		return nil, fmt.Errorf("invalid source issuer scope")
	}
	if _, err := sourceEd25519Key(publicKey); err != nil {
		return nil, err
	}
	from, errFrom := time.Parse(time.RFC3339Nano, validFrom)
	until, errUntil := time.Parse(time.RFC3339Nano, validUntil)
	var facts []string
	if errFrom != nil || errUntil != nil || !from.Before(until) ||
		json.Unmarshal([]byte(factsJSON), &facts) != nil || len(facts) == 0 {
		return nil, fmt.Errorf("invalid issuer validity or facts")
	}
	slices.Sort(facts)
	required := slices.Clone(sourceFactsByKind[kind])
	slices.Sort(required)
	if !slices.Equal(facts, required) {
		return nil, fmt.Errorf("source issuer lacks authorized scope for these facts")
	}
	issuer := &SourceIssuer{IssuerID: id, Kind: kind, PublicKey: publicKey, KeyVersion: keyVersion, ValidFrom: validFrom, ValidUntil: validUntil,
		Status: "PROPOSED", AuthorizedFacts: facts, ControlDomain: controlDomain, HospitalID: hospitalID, ApprovedMSPs: []string{}}
	if err := putState(ctx, "sourceIssuer", sourceKey(id, keyVersion), issuer); err != nil {
		return nil, err
	}
	return issuer, emit(ctx, "SourceIssuerUpdated", issuer)
}

func (c *Contract) ReadSourceIssuer(ctx contractapi.TransactionContextInterface, id string, version int) (*SourceIssuer, error) {
	return getState[SourceIssuer](ctx, "sourceIssuer", sourceKey(id, version))
}

func (c *Contract) ListSourceIssuers(ctx contractapi.TransactionContextInterface) ([]SourceIssuer, error) {
	return listState[SourceIssuer](ctx, "sourceIssuer")
}

func (c *Contract) ApproveSourceIssuer(ctx contractapi.TransactionContextInterface, id string, version int) (*SourceIssuer, error) {
	issuer, err := c.ReadSourceIssuer(ctx, id, version)
	if err != nil {
		return nil, err
	}
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	allowed := msp == "InsurerMSP" && role == "insurerAdmin" || msp == "AuditorMSP" && role == "auditor"
	if msp == "HospitalMSP" && role == "hospitalOfficer" && issuer.HospitalID != "" {
		subject, err := callerSubject(ctx)
		if err != nil {
			return nil, err
		}
		allowed = subject == issuer.HospitalID
	}
	if !allowed || issuer.Status != "PROPOSED" || slices.Contains(issuer.ApprovedMSPs, msp) {
		return nil, fmt.Errorf("issuer approval is not eligible")
	}
	issuer.ApprovedMSPs = append(issuer.ApprovedMSPs, msp)
	slices.Sort(issuer.ApprovedMSPs)
	required := 2
	if issuer.HospitalID != "" {
		required++
	}
	if len(issuer.ApprovedMSPs) == required {
		scope := sourceScope(issuer.Kind, issuer.HospitalID)
		key, err := stateKey(ctx, "sourceAuthority", scope)
		if err != nil {
			return nil, err
		}
		raw, err := ctx.GetStub().GetState(key)
		if err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			active, err := getState[SourceIssuer](ctx, "sourceAuthority", scope)
			if err != nil {
				return nil, err
			}
			if active.IssuerID != issuer.IssuerID || active.KeyVersion >= issuer.KeyVersion {
				return nil, fmt.Errorf("issuer authority already assigned or key version rolls back")
			}
		}
		issuer.Status = "ACTIVE"
		if err := overwriteAsset(ctx, "sourceAuthority", scope, issuer); err != nil {
			return nil, err
		}
	}
	if err := overwriteAsset(ctx, "sourceIssuer", sourceKey(id, version), issuer); err != nil {
		return nil, err
	}
	return issuer, emit(ctx, "SourceIssuerUpdated", issuer)
}

func (c *Contract) RevokeSourceIssuer(ctx contractapi.TransactionContextInterface, id string, version int) (*SourceIssuer, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if !(msp == "InsurerMSP" && role == "insurerAdmin" || msp == "AuditorMSP" && role == "auditor") {
		return nil, fmt.Errorf("issuer revocation requires Insurer or Auditor authority")
	}
	issuer, err := c.ReadSourceIssuer(ctx, id, version)
	if err != nil {
		return nil, err
	}
	if issuer.Status != "ACTIVE" {
		return nil, fmt.Errorf("issuer key is not active")
	}
	issuer.RevokedAt, err = ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	issuer.Status = "REVOKED"
	if err := overwriteAsset(ctx, "sourceIssuer", sourceKey(id, version), issuer); err != nil {
		return nil, err
	}
	return issuer, emit(ctx, "SourceIssuerUpdated", issuer)
}

func activeSourceIssuer(issuer *SourceIssuer, now time.Time) bool {
	from, e1 := time.Parse(time.RFC3339Nano, issuer.ValidFrom)
	until, e2 := time.Parse(time.RFC3339Nano, issuer.ValidUntil)
	return e1 == nil && e2 == nil && issuer.Status == "ACTIVE" && !now.Before(from) && now.Before(until)
}

func (c *Contract) AnchorSourceFeed(ctx contractapi.TransactionContextInterface, id string, keyVersion, feedVersion int, root, effectiveAt, coverageHash, signature string) (*SourceFeed, error) {
	issuer, err := c.ReadSourceIssuer(ctx, id, keyVersion)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	when, whenErr := time.Parse(time.RFC3339Nano, effectiveAt)
	if !activeSourceIssuer(issuer, now) || whenErr != nil || when.After(now) || feedVersion < 1 || feedVersion > 999999999 ||
		!oracleV2Hash.MatchString(root) || !oracleV2Hash.MatchString(coverageHash) {
		return nil, fmt.Errorf("source feed or key is not eligible")
	}
	active, err := getState[SourceIssuer](ctx, "sourceAuthority", sourceScope(issuer.Kind, issuer.HospitalID))
	if err != nil || active.IssuerID != id || active.KeyVersion != keyVersion {
		return nil, fmt.Errorf("source feed key is not the current authority")
	}
	key, err := stateKey(ctx, "latestSourceFeed", id)
	if err != nil {
		return nil, err
	}
	stored, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if len(stored) > 0 {
		var previous SourceFeed
		if err := json.Unmarshal(stored, &previous); err != nil {
			return nil, err
		}
		priorTime, err := time.Parse(time.RFC3339Nano, previous.EffectiveAt)
		if err != nil || feedVersion <= previous.FeedVersion || when.Before(priorTime) || keyVersion < previous.KeyVersion {
			return nil, fmt.Errorf("duplicate source feed or version rollback")
		}
	}
	digest, err := oracleV2Digest("oracle-v2:anchor", map[string]any{"issuerId": id, "keyVersion": keyVersion, "feedVersion": feedVersion,
		"root": root, "effectiveAt": effectiveAt, "coverageHash": coverageHash})
	if err != nil {
		return nil, err
	}
	bytes, _ := hex.DecodeString(digest)
	sig, sigErr := base64.RawURLEncoding.Strict().DecodeString(signature)
	public, keyErr := sourceEd25519Key(issuer.PublicKey)
	if sigErr != nil || keyErr != nil || base64.RawURLEncoding.EncodeToString(sig) != signature || !ed25519.Verify(public, bytes, sig) {
		return nil, fmt.Errorf("invalid source feed signature")
	}
	submitter, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return nil, err
	}
	feed := &SourceFeed{SourceFeedPin: SourceFeedPin{IssuerID: id, KeyVersion: keyVersion, FeedVersion: feedVersion, Root: root,
		EffectiveAt: effectiveAt, AnchoredAt: now.Format(time.RFC3339Nano)}, CoverageHash: coverageHash, Signature: signature, Submitter: submitter}
	if err := putState(ctx, "sourceFeed", sourceKey(id, feedVersion), feed); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "latestSourceFeed", id, feed); err != nil {
		return nil, err
	}
	return feed, emit(ctx, "SourceFeedAnchored", feed)
}

func (c *Contract) ReadSourceFeed(ctx contractapi.TransactionContextInterface, id string, feedVersion int) (*SourceFeed, error) {
	return getState[SourceFeed](ctx, "sourceFeed", sourceKey(id, feedVersion))
}

func (c *Contract) ListSourceFeeds(ctx contractapi.TransactionContextInterface) ([]SourceFeed, error) {
	return listState[SourceFeed](ctx, "sourceFeed")
}

func buildOracleV2Manifest(ctx contractapi.TransactionContextInterface, hospital string, now time.Time) (*OracleV2Manifest, string, error) {
	manifest := &OracleV2Manifest{Schema: "oracle-v2-source-manifest-v1", RequestedAt: now.Format(time.RFC3339Nano), Pins: []SourceFeedPin{}}
	contract := new(Contract)
	for _, kind := range []string{"HOSPITAL_HIS", "REGULATOR", "CLAIMANT_RECEIPT"} {
		pointer, err := getState[SourceIssuer](ctx, "sourceAuthority", sourceScope(kind, hospital))
		if err != nil {
			return nil, "", fmt.Errorf("required source authority unavailable for %s: %w", kind, err)
		}
		issuer, err := contract.ReadSourceIssuer(ctx, pointer.IssuerID, pointer.KeyVersion)
		if err != nil || !activeSourceIssuer(issuer, now) {
			return nil, "", fmt.Errorf("required source key is inactive for %s", kind)
		}
		feed, err := getState[SourceFeed](ctx, "latestSourceFeed", issuer.IssuerID)
		if err != nil {
			return nil, "", fmt.Errorf("required anchored feed unavailable for %s: %w", kind, err)
		}
		anchored, err := time.Parse(time.RFC3339Nano, feed.AnchoredAt)
		if err != nil || anchored.After(now) || feed.KeyVersion != issuer.KeyVersion {
			return nil, "", fmt.Errorf("required anchored feed is not eligible for %s", kind)
		}
		manifest.Pins = append(manifest.Pins, feed.SourceFeedPin)
	}
	slices.SortFunc(manifest.Pins, func(a, b SourceFeedPin) int { return strings.Compare(a.IssuerID, b.IssuerID) })
	hash, err := oracleV2Digest("oracle-v2:manifest", manifest)
	return manifest, hash, err
}
