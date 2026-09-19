package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const (
	oracleProofCollection  = "oracleProofPrivateData"
	privacyProtocolVersion = "block-insure-selective-disclosure-v1"
	privacyLeafEncoding    = "block-insure-credential-leaf-v1"
)

var invoiceDisclosureNames = []string{"admissionDate", "amountMinor", "dischargeDate", "hospitalId", "invoiceId", "invoiceReferenceHash", "status"}
var policyDisclosureNames = []string{"coverageLimitMinor", "endDate", "policyId", "policyholderId", "startDate", "status"}

func privacyLeafHash(credentialID string, credentialVersion int, field PrivacyCredentialField) string {
	return canonicalProtocolHash(privacyLeafEncoding, credentialID, strconv.Itoa(credentialVersion), field.Name, field.Value, strings.ToLower(field.Salt))
}

func privacyParentHash(left, right string) string {
	return canonicalProtocolHash(privacyProtocolVersion+":node", strings.ToLower(left), strings.ToLower(right))
}

func privacyMerkleLevels(credentialID string, credentialVersion int, fields []PrivacyCredentialField) [][]string {
	leaves := make([]string, len(fields))
	for index, field := range fields {
		leaves[index] = privacyLeafHash(credentialID, credentialVersion, field)
	}
	levels := [][]string{leaves}
	for len(levels[len(levels)-1]) > 1 {
		current := levels[len(levels)-1]
		next := make([]string, 0, (len(current)+1)/2)
		for index := 0; index < len(current); index += 2 {
			right := current[index]
			if index+1 < len(current) {
				right = current[index+1]
			}
			next = append(next, privacyParentHash(current[index], right))
		}
		levels = append(levels, next)
	}
	return levels
}

func privacyMerkleRoot(credentialID string, credentialVersion int, fields []PrivacyCredentialField) string {
	levels := privacyMerkleLevels(credentialID, credentialVersion, fields)
	return levels[len(levels)-1][0]
}

func privacyMerkleProof(levels [][]string, leafIndex int) []PrivacyProofStep {
	proof := make([]PrivacyProofStep, 0, len(levels)-1)
	index := leafIndex
	for levelIndex := 0; levelIndex < len(levels)-1; levelIndex++ {
		level := levels[levelIndex]
		sibling := index ^ 1
		if sibling >= len(level) {
			sibling = index
		}
		position := "RIGHT"
		if sibling < index {
			position = "LEFT"
		}
		proof = append(proof, PrivacyProofStep{Hash: level[sibling], Position: position})
		index /= 2
	}
	return proof
}

func verifyPrivacyDisclosure(disclosure PrivacyDisclosure, root string) bool {
	computed := privacyLeafHash(disclosure.CredentialID, disclosure.CredentialVersion, PrivacyCredentialField{
		Name: disclosure.Name, Value: disclosure.Value, Salt: disclosure.Salt,
	})
	for _, step := range disclosure.Proof {
		if validateHash("proof hash", step.Hash) != nil {
			return false
		}
		switch step.Position {
		case "LEFT":
			computed = privacyParentHash(step.Hash, computed)
		case "RIGHT":
			computed = privacyParentHash(computed, step.Hash)
		default:
			return false
		}
	}
	return computed == strings.ToLower(root)
}

func privateStateKey(ctx contractapi.TransactionContextInterface, assetType, id string) (string, error) {
	return stateKey(ctx, assetType, id)
}

func putPrivateState(ctx contractapi.TransactionContextInterface, assetType, id string, value any) error {
	key, err := privateStateKey(ctx, assetType, id)
	if err != nil {
		return err
	}
	existing, err := ctx.GetStub().GetPrivateData(oracleProofCollection, key)
	if err != nil {
		return fmt.Errorf("check private %s %s: %w", assetType, id, err)
	}
	if existing != nil {
		return fmt.Errorf("private %s %s already exists", assetType, id)
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode private %s: %w", assetType, err)
	}
	if err := ctx.GetStub().PutPrivateData(oracleProofCollection, key, payload); err != nil {
		return fmt.Errorf("write private %s %s: %w", assetType, id, err)
	}
	return nil
}

func getPrivateState[T any](ctx contractapi.TransactionContextInterface, assetType, id string) (*T, error) {
	key, err := privateStateKey(ctx, assetType, id)
	if err != nil {
		return nil, err
	}
	payload, err := ctx.GetStub().GetPrivateData(oracleProofCollection, key)
	if err != nil {
		return nil, fmt.Errorf("read private %s %s: %w", assetType, id, err)
	}
	if payload == nil {
		return nil, fmt.Errorf("private %s %s does not exist on this authorized peer", assetType, id)
	}
	var value T
	if err := json.Unmarshal(payload, &value); err != nil {
		return nil, fmt.Errorf("decode private %s %s: %w", assetType, id, err)
	}
	return &value, nil
}

func credentialSalts(ctx contractapi.TransactionContextInterface, names []string) (map[string]string, error) {
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, fmt.Errorf("read credential salts: %w", err)
	}
	payload := transient["credentialSalts"]
	if len(payload) == 0 {
		return nil, fmt.Errorf("transient credentialSalts is required")
	}
	var salts map[string]string
	if err := json.Unmarshal(payload, &salts); err != nil {
		return nil, fmt.Errorf("credentialSalts must be a JSON object: %w", err)
	}
	for _, name := range names {
		salt := strings.ToLower(strings.TrimSpace(salts[name]))
		if err := validateHash("salt for "+name, salt); err != nil {
			return nil, err
		}
		salts[name] = salt
	}
	return salts, nil
}

func buildCredentialFields(values map[string]string, salts map[string]string) []PrivacyCredentialField {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	slices.Sort(names)
	fields := make([]PrivacyCredentialField, 0, len(names))
	for _, name := range names {
		fields = append(fields, PrivacyCredentialField{Name: name, Value: values[name], Salt: salts[name]})
	}
	return fields
}

func validateCredentialExpiry(ctx contractapi.TransactionContextInterface, expiresAt string) (string, error) {
	expires, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return "", fmt.Errorf("expiresAt must use RFC3339")
	}
	tx, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", fmt.Errorf("read transaction timestamp: %w", err)
	}
	if !expires.After(tx.AsTime()) {
		return "", fmt.Errorf("expiresAt must be after the transaction time")
	}
	return expires.UTC().Format(time.RFC3339), nil
}

func (c *Contract) issuePrivacyCredential(ctx contractapi.TransactionContextInterface, id, credentialType, sourceID, subjectHash, issuerMSP, issuerIdentity, expiresAt string, values map[string]string) (*PrivacyCredential, error) {
	if err := validateHash("subjectHash", subjectHash); err != nil {
		return nil, err
	}
	expiresAt, err := validateCredentialExpiry(ctx, expiresAt)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	salts, err := credentialSalts(ctx, names)
	if err != nil {
		return nil, err
	}
	fields := buildCredentialFields(values, salts)
	root := privacyMerkleRoot(id, 1, fields)
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	credential := &PrivacyCredential{
		AssetType: "privacyCredential", SchemaVersion: SchemaVersion, ID: id,
		CredentialType: credentialType, SourceID: sourceID, SubjectHash: strings.ToLower(subjectHash),
		IssuerMSP: issuerMSP, IssuerIdentity: issuerIdentity, CredentialVersion: 1,
		RootHash: root, FieldCount: len(fields), HashAlgorithm: "SHA-256", LeafEncoding: privacyLeafEncoding,
		Status: "ACTIVE", IssuedAt: now, ExpiresAt: expiresAt,
	}
	private := &PrivacyCredentialPrivate{CredentialID: id, CredentialType: credentialType, CredentialVersion: 1, Fields: fields}
	if err := putPrivateState(ctx, "privacyCredentialPrivate", id, private); err != nil {
		return nil, err
	}
	if err := putState(ctx, "privacyCredential", id, credential); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PrivacyCredentialIssued", credential); err != nil {
		return nil, err
	}
	return credential, nil
}

func (c *Contract) IssueInvoicePrivacyCredential(ctx contractapi.TransactionContextInterface, id, invoiceID, expiresAt string) (*PrivacyCredential, error) {
	issuer, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer")
	if err != nil {
		return nil, err
	}
	hospitalID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	invoice, err := c.ReadHospitalInvoice(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	if invoice.HospitalID != hospitalID || invoice.Status != "FINALIZED" {
		return nil, fmt.Errorf("invoice %s is not a finalized invoice owned by this hospital", invoiceID)
	}
	values := map[string]string{
		"admissionDate": invoice.AdmissionDate, "amountMinor": strconv.FormatInt(invoice.AmountMinor, 10),
		"dischargeDate": invoice.DischargeDate, "hospitalId": invoice.HospitalID, "invoiceId": invoice.ID,
		"invoiceReferenceHash": strings.ToLower(invoice.InvoiceReferenceHash), "patientReferenceHash": strings.ToLower(invoice.PatientReferenceHash),
		"status": invoice.Status, "treatmentHash": strings.ToLower(invoice.TreatmentHash),
	}
	return c.issuePrivacyCredential(ctx, id, "HOSPITAL_INVOICE", invoice.ID, invoice.PatientReferenceHash, "HospitalMSP", issuer, expiresAt, values)
}

func (c *Contract) IssuePolicyPrivacyCredential(ctx contractapi.TransactionContextInterface, id, policyID, expiresAt string) (*PrivacyCredential, error) {
	issuer, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin")
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if policy.Status != "ACTIVE" {
		return nil, fmt.Errorf("policy %s is not active", policyID)
	}
	subjectHash := canonicalProtocolHash(privacyProtocolVersion+":subject", policy.PolicyholderID)
	values := map[string]string{
		"coverageLimitMinor": strconv.FormatInt(policy.CoverageLimitMinor, 10), "endDate": policy.EndDate,
		"packageId": policy.PackageID, "policyId": policy.ID, "policyholderId": policy.PolicyholderID,
		"premiumMinor": strconv.FormatInt(policy.PremiumMinor, 10), "startDate": policy.StartDate,
		"status": policy.Status, "termsHash": strings.ToLower(policy.TermsHash),
	}
	return c.issuePrivacyCredential(ctx, id, "INSURANCE_POLICY", policy.ID, subjectHash, "InsurerMSP", issuer, expiresAt, values)
}

func (c *Contract) ReadPrivacyCredential(ctx contractapi.TransactionContextInterface, id string) (*PrivacyCredential, error) {
	return getState[PrivacyCredential](ctx, "privacyCredential", id)
}

func (c *Contract) ListPrivacyCredentials(ctx contractapi.TransactionContextInterface) ([]PrivacyCredential, error) {
	return listState[PrivacyCredential](ctx, "privacyCredential")
}

func (c *Contract) RevokePrivacyCredential(ctx contractapi.TransactionContextInterface, id string) (*PrivacyCredential, error) {
	credential, err := c.ReadPrivacyCredential(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := requireIdentity(ctx, credential.IssuerMSP, map[string]string{"HospitalMSP": "hospitalOfficer", "InsurerMSP": "insurerAdmin"}[credential.IssuerMSP]); err != nil {
		return nil, err
	}
	if credential.Status != "ACTIVE" {
		return nil, fmt.Errorf("credential %s is not active", id)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	credential.Status = "REVOKED"
	credential.RevokedAt = now
	if err := overwriteAsset(ctx, "privacyCredential", id, credential); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PrivacyCredentialRevoked", credential); err != nil {
		return nil, err
	}
	return credential, nil
}

func credentialDisclosures(private *PrivacyCredentialPrivate, root string, required []string) ([]PrivacyDisclosure, error) {
	levels := privacyMerkleLevels(private.CredentialID, private.CredentialVersion, private.Fields)
	if levels[len(levels)-1][0] != root {
		return nil, fmt.Errorf("private credential %s does not match its public root", private.CredentialID)
	}
	requiredSet := make(map[string]bool, len(required))
	for _, name := range required {
		requiredSet[name] = true
	}
	disclosures := make([]PrivacyDisclosure, 0, len(required))
	for index, field := range private.Fields {
		if requiredSet[field.Name] {
			disclosures = append(disclosures, PrivacyDisclosure{
				CredentialID: private.CredentialID, CredentialVersion: private.CredentialVersion,
				Name: field.Name, Value: field.Value, Salt: field.Salt, LeafIndex: index,
				Proof: privacyMerkleProof(levels, index),
			})
			delete(requiredSet, field.Name)
		}
	}
	if len(requiredSet) != 0 {
		return nil, fmt.Errorf("credential %s is missing required disclosure fields", private.CredentialID)
	}
	return disclosures, nil
}

func disclosureValues(disclosures []PrivacyDisclosure, credentialID string) (map[string]string, error) {
	values := make(map[string]string)
	for _, disclosure := range disclosures {
		if disclosure.CredentialID != credentialID {
			continue
		}
		if _, exists := values[disclosure.Name]; exists {
			return nil, fmt.Errorf("duplicate disclosure %s", disclosure.Name)
		}
		values[disclosure.Name] = disclosure.Value
	}
	return values, nil
}

func parseMinorDisclosure(values map[string]string, name string) (int64, error) {
	value, err := strconv.ParseInt(values[name], 10, 64)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("disclosure %s is not a non-negative integer", name)
	}
	return value, nil
}

func validatePresentationSemantics(claim *Claim, invoiceValues, policyValues map[string]string) error {
	amount, err := parseMinorDisclosure(invoiceValues, "amountMinor")
	if err != nil {
		return err
	}
	limit, err := parseMinorDisclosure(policyValues, "coverageLimitMinor")
	if err != nil {
		return err
	}
	if invoiceValues["invoiceId"] != claim.HospitalInvoiceID || invoiceValues["hospitalId"] != claim.HospitalID || amount != claim.AmountMinor || invoiceValues["status"] != "FINALIZED" {
		return fmt.Errorf("invoice disclosures do not match claim %s", claim.ID)
	}
	if policyValues["policyId"] != claim.PolicyID || policyValues["policyholderId"] != claim.ClaimantID || policyValues["status"] != "ACTIVE" || amount > limit {
		return fmt.Errorf("policy disclosures do not authorize claim %s", claim.ID)
	}
	incident, err := validateDate("incidentDate", claim.IncidentDate)
	if err != nil {
		return err
	}
	for _, pair := range []struct {
		fromName, throughName string
		values                map[string]string
	}{
		{"admissionDate", "dischargeDate", invoiceValues}, {"startDate", "endDate", policyValues},
	} {
		from, fromErr := validateDate(pair.fromName, pair.values[pair.fromName])
		through, throughErr := validateDate(pair.throughName, pair.values[pair.throughName])
		if fromErr != nil || throughErr != nil || incident.Before(from) || incident.After(through) {
			return fmt.Errorf("incident date is outside the disclosed %s/%s range", pair.fromName, pair.throughName)
		}
	}
	return nil
}

func (c *Contract) RegisterClaimPrivacyPresentation(ctx contractapi.TransactionContextInterface, id, claimID, invoiceCredentialID, policyCredentialID, challenge, expiresAt string) (*SelectiveDisclosurePresentation, error) {
	registeredBy, err := requireIdentity(ctx, "InsurerMSP", "policyholder")
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.ClaimantID != subject || (claim.Status != "HOSPITAL_VERIFIED" && claim.Status != "APPEAL_SUBMITTED") {
		return nil, fmt.Errorf("claim %s is not eligible for a presentation by this policyholder", claimID)
	}
	if !idPattern.MatchString(strings.TrimSpace(challenge)) {
		return nil, fmt.Errorf("challenge is invalid")
	}
	expiresAt, err = validateCredentialExpiry(ctx, expiresAt)
	if err != nil {
		return nil, err
	}
	invoiceCredential, err := c.ReadPrivacyCredential(ctx, invoiceCredentialID)
	if err != nil {
		return nil, err
	}
	policyCredential, err := c.ReadPrivacyCredential(ctx, policyCredentialID)
	if err != nil {
		return nil, err
	}
	if invoiceCredential.CredentialType != "HOSPITAL_INVOICE" || invoiceCredential.SourceID != claim.HospitalInvoiceID || invoiceCredential.Status != "ACTIVE" {
		return nil, fmt.Errorf("invoice credential %s is not active for claim %s", invoiceCredentialID, claimID)
	}
	if policyCredential.CredentialType != "INSURANCE_POLICY" || policyCredential.SourceID != claim.PolicyID || policyCredential.Status != "ACTIVE" {
		return nil, fmt.Errorf("policy credential %s is not active for claim %s", policyCredentialID, claimID)
	}
	tx, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, err
	}
	for _, credential := range []*PrivacyCredential{invoiceCredential, policyCredential} {
		expiry, _ := time.Parse(time.RFC3339, credential.ExpiresAt)
		if !expiry.After(tx.AsTime()) {
			return nil, fmt.Errorf("credential %s is expired", credential.ID)
		}
	}
	invoicePrivate, err := getPrivateState[PrivacyCredentialPrivate](ctx, "privacyCredentialPrivate", invoiceCredentialID)
	if err != nil {
		return nil, err
	}
	policyPrivate, err := getPrivateState[PrivacyCredentialPrivate](ctx, "privacyCredentialPrivate", policyCredentialID)
	if err != nil {
		return nil, err
	}
	invoiceDisclosures, err := credentialDisclosures(invoicePrivate, invoiceCredential.RootHash, invoiceDisclosureNames)
	if err != nil {
		return nil, err
	}
	policyDisclosures, err := credentialDisclosures(policyPrivate, policyCredential.RootHash, policyDisclosureNames)
	if err != nil {
		return nil, err
	}
	disclosures := append(invoiceDisclosures, policyDisclosures...)
	for _, disclosure := range disclosures {
		root := invoiceCredential.RootHash
		if disclosure.CredentialID == policyCredential.ID {
			root = policyCredential.RootHash
		}
		if !verifyPrivacyDisclosure(disclosure, root) {
			return nil, fmt.Errorf("invalid Merkle proof for %s.%s", disclosure.CredentialID, disclosure.Name)
		}
	}
	invoiceValues, err := disclosureValues(disclosures, invoiceCredential.ID)
	if err != nil {
		return nil, err
	}
	policyValues, err := disclosureValues(disclosures, policyCredential.ID)
	if err != nil {
		return nil, err
	}
	if err := validatePresentationSemantics(claim, invoiceValues, policyValues); err != nil {
		return nil, err
	}
	private := &SelectiveDisclosurePresentationPrivate{
		ProtocolVersion: privacyProtocolVersion, PresentationID: id, ClaimID: claim.ID,
		ClaimVersion: claim.Version, Challenge: strings.TrimSpace(challenge), ExpiresAt: expiresAt, Disclosures: disclosures,
	}
	payload, err := json.Marshal(private)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	fieldNames := make([]string, 0, len(disclosures))
	for _, disclosure := range disclosures {
		fieldNames = append(fieldNames, disclosure.CredentialID+"."+disclosure.Name)
	}
	presentation := &SelectiveDisclosurePresentation{
		AssetType: "selectiveDisclosurePresentation", SchemaVersion: SchemaVersion, ID: id,
		ProtocolVersion: privacyProtocolVersion, ClaimID: claim.ID, ClaimVersion: claim.Version,
		InvoiceCredentialID: invoiceCredential.ID, PolicyCredentialID: policyCredential.ID,
		InvoiceRootHash: invoiceCredential.RootHash, PolicyRootHash: policyCredential.RootHash,
		ChallengeHash:    canonicalProtocolHash(privacyProtocolVersion+":challenge", claim.ID, strconv.Itoa(claim.Version), challenge),
		PresentationHash: hex.EncodeToString(digest[:]), DisclosedFields: fieldNames, Status: "VERIFIED",
		RegisteredBy: registeredBy, CreatedAt: now, ExpiresAt: expiresAt,
	}
	if err := putPrivateState(ctx, "selectiveDisclosurePresentationPrivate", id, private); err != nil {
		return nil, err
	}
	if err := putState(ctx, "selectiveDisclosurePresentation", id, presentation); err != nil {
		return nil, err
	}
	claim.PrivacyPresentationID = id
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "SelectiveDisclosurePresentationRegistered", presentation); err != nil {
		return nil, err
	}
	return presentation, nil
}

func (c *Contract) ReadSelectiveDisclosurePresentation(ctx contractapi.TransactionContextInterface, id string) (*SelectiveDisclosurePresentation, error) {
	return getState[SelectiveDisclosurePresentation](ctx, "selectiveDisclosurePresentation", id)
}

func (c *Contract) ListSelectiveDisclosurePresentations(ctx contractapi.TransactionContextInterface) ([]SelectiveDisclosurePresentation, error) {
	return listState[SelectiveDisclosurePresentation](ctx, "selectiveDisclosurePresentation")
}

func (c *Contract) ReadSelectiveDisclosurePresentationPrivate(ctx contractapi.TransactionContextInterface, id string) (*SelectiveDisclosurePresentationPrivate, error) {
	_, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	allowed := (mspID == "OracleMSP" && role == "oracle") || (mspID == "InsurerMSP" && (role == "insurerAdmin" || role == "policyholder"))
	if !allowed {
		return nil, fmt.Errorf("access denied: verified InsurerMSP or OracleMSP identity is required")
	}
	return getPrivateState[SelectiveDisclosurePresentationPrivate](ctx, "selectiveDisclosurePresentationPrivate", id)
}
