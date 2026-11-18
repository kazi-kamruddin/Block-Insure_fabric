package insurance

import (
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// MedicalRules defines the separately opted-in medical reimbursement product.
// A published package's rules cannot be edited; issue a new package for changes.
type MedicalRules struct {
	PackageID            string `json:"packageId"`
	Version              int    `json:"version"`
	Service              string `json:"service"`
	ServiceSublimitMinor int64  `json:"serviceSublimitMinor"`
	DeductibleBps        int64  `json:"deductibleBps"`
	DeductibleCapMinor   int64  `json:"deductibleCapMinor"`
	InsurerShareBps      int64  `json:"insurerShareBps"`
	WaitingDays          int    `json:"waitingDays"`
	FilingDays           int    `json:"filingDays"`
	EvidenceRequired     bool   `json:"evidenceRequired"`
	TermsHash            string `json:"termsHash"`
}

func (c *Contract) ConfigureMedicalRules(ctx contractapi.TransactionContextInterface, packageID, service string, sublimit, deductibleBps, deductibleCap, shareBps int64, waitingDays, filingDays int, evidenceRequired bool) (*MedicalRules, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("medical rules require the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	pkg, err := c.ReadPolicyPackage(ctx, packageID)
	if err != nil {
		return nil, err
	}
	if pkg.Status != "DRAFT" || pkg.MedicalRulesVersion != 0 {
		return nil, fmt.Errorf("medical rules can only be configured once on a draft package")
	}
	if !validMedicalService(service) || sublimit <= 0 || sublimit > 9007199254740991 ||
		deductibleBps < 0 || deductibleBps > 10000 || deductibleCap < 0 || deductibleCap > sublimit ||
		shareBps <= 0 || shareBps > 10000 || waitingDays < 0 || waitingDays > 365 || filingDays < 1 || filingDays > 365 {
		return nil, fmt.Errorf("invalid medical service, reimbursement rules or deadlines")
	}
	rules := &MedicalRules{PackageID: packageID, Version: 1, Service: service, ServiceSublimitMinor: sublimit,
		DeductibleBps: deductibleBps, DeductibleCapMinor: deductibleCap, InsurerShareBps: shareBps,
		WaitingDays: waitingDays, FilingDays: filingDays, EvidenceRequired: evidenceRequired}
	rules.TermsHash = canonicalProtocolHash("fabric-medical-terms-v1", pkg.TermsHash, packageID, service,
		strconv.FormatInt(pkg.PremiumMinor, 10), strconv.FormatInt(pkg.CoverageLimitMinor, 10),
		strconv.FormatInt(sublimit, 10), strconv.FormatInt(deductibleBps, 10), strconv.FormatInt(deductibleCap, 10),
		strconv.FormatInt(shareBps, 10), strconv.Itoa(waitingDays), strconv.Itoa(filingDays), strconv.FormatBool(evidenceRequired),
		"Asia/Dhaka", "floor-minor-unit", strconv.Itoa(defaultPremiumIntervalDays), strconv.Itoa(defaultGracePeriodDays))
	pkg.TermsHash, pkg.MedicalRulesVersion = rules.TermsHash, rules.Version
	if err := putState(ctx, "medicalRules", packageID, rules); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "policyPackage", packageID, pkg); err != nil {
		return nil, err
	}
	return rules, emit(ctx, "MedicalRulesConfigured", rules)
}

func (c *Contract) ReadMedicalRules(ctx contractapi.TransactionContextInterface, packageID string) (*MedicalRules, error) {
	return getState[MedicalRules](ctx, "medicalRules", packageID)
}

func validMedicalService(service string) bool {
	switch service {
	case "SURGERY", "CONSULTATION", "DIAGNOSTIC", "INPATIENT", "OTHER":
		return true
	default:
		return false
	}
}
