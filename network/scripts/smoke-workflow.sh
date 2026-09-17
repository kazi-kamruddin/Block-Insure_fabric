#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
organizations="${network_root}/organizations"
channel_name="${CHANNEL_NAME:-insurance-channel}"
chaincode_name="${CHAINCODE_NAME:-insurance-contract}"
orderer_ca="${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt"

export PATH="${samples_root}/bin:${PATH}"
export FABRIC_CFG_PATH="${samples_root}/config"

set_client_context() {
  local org="$1" msp="$2" port="$3" user="$4"
  local domain="${org}.blockinsure.test"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/${user}@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
}

payload() {
  local function="$1"
  shift
  printf '%s\n' "$@" | jq -R . | jq -s --arg function "${function}" '{function: $function, Args: .}'
}

invoke() {
  local function="$1"
  shift
  peer chaincode invoke \
    -o localhost:7050 --ordererTLSHostnameOverride orderer.blockinsure.test \
    --tls --cafile "${orderer_ca}" -C "${channel_name}" -n "${chaincode_name}" \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles "${organizations}/peerOrganizations/insurer.blockinsure.test/peers/peer0.insurer.blockinsure.test/tls/ca.crt" \
    --peerAddresses localhost:8051 \
    --tlsRootCertFiles "${organizations}/peerOrganizations/hospital.blockinsure.test/peers/peer0.hospital.blockinsure.test/tls/ca.crt" \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles "${organizations}/peerOrganizations/auditor.blockinsure.test/peers/peer0.auditor.blockinsure.test/tls/ca.crt" \
    --peerAddresses localhost:12051 \
    --tlsRootCertFiles "${organizations}/peerOrganizations/bank.blockinsure.test/peers/peer0.bank.blockinsure.test/tls/ca.crt" \
    --waitForEvent --waitForEventTimeout 90s -c "$(payload "${function}" "$@")" >/dev/null
}

exists() {
  peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload "$1" "$2")" >/dev/null 2>&1
}

suffix="$(date +%s)"
package_id="smoke-package-${suffix}"
policy_id="smoke-policy-${suffix}"
claim_id="smoke-claim-${suffix}"
evidence_id="smoke-evidence-${suffix}"
evidence_grant_id="smoke-evidence-grant-${suffix}"
evidence_access_id="smoke-evidence-access-${suffix}"
verification_id="smoke-verification-${suffix}"
invoice_id="smoke-invoice-${suffix}"
decision_id="smoke-decision-${suffix}"
review_id="smoke-review-${suffix}"
fraud_id="smoke-fraud-${suffix}"
settlement_id="smoke-settlement-${suffix}"
account_id="smoke-account-${suffix}"
mandate_id="smoke-mandate-${suffix}"
acquired_policy_id="smoke-acquired-policy-${suffix}"
payment_id="smoke-payment-${suffix}"
collection_id="smoke-collection-${suffix}"
collection_payment_id="smoke-collection-payment-${suffix}"
benefit_plan_id="smoke-benefit-plan-${suffix}"
benefit_request_id="smoke-benefit-request-${suffix}"
hash_a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
hash_b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
hash_c="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
hash_d="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
premium_receipt_hash="$(printf '%s' "premium-${suffix}" | sha256sum | cut -d' ' -f1)"
collection_receipt_hash="$(printf '%s' "collection-${suffix}" | sha256sum | cut -d' ' -f1)"
review_deadline="$(date -u -d '+3 days' '+%Y-%m-%dT%H:%M:%SZ')"
grant_deadline="$(date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%SZ')"

set_client_context insurer InsurerMSP 7051 insurerAdmin
if ! exists ReadPartnerAgreement agreement-hospital-demo; then
  invoke CreatePartnerAgreement agreement-hospital-demo HOSPITAL hospital-demo "Dhaka Central Medical Hospital" Dhaka Preferred "Read-only invoice verification fields" 2026-01-01 2028-12-31
  invoke CreatePartnerAgreement agreement-bank-demo BANK bank-demo "Bangladesh Demo Commercial Bank" Dhaka Collection "Premium collection and settlement confirmation" 2026-01-01 2028-12-31
fi
invoke CreatePolicyPackage "${package_id}" "Smoke Health Plan" "Live Fabric workflow verification" 10000 1000000 "${hash_a}"
invoke ConfigurePolicyPackagePartners "${package_id}" '["hospital-demo"]' '["bank-demo"]'
invoke CreateBenefitPlan "${benefit_plan_id}" "${package_id}" 500000 100000 250000 "${hash_d}"
invoke PublishBenefitPlan "${benefit_plan_id}"
invoke PublishPolicyPackage "${package_id}"
invoke IssuePolicy "${policy_id}" "${package_id}" policyholder1 2026-01-01 2026-12-31

set_client_context bank BankMSP 12051 bankOfficer
invoke RegisterBankAccountReference "${account_id}" policyholder1 "${hash_a}"

set_client_context insurer InsurerMSP 7051 policyholder1
invoke AcquirePolicy "${acquired_policy_id}" "${package_id}" 2026-01-01 2026-12-31
invoke SetBeneficiaries "${acquired_policy_id}" '[{"beneficiaryId":"beneficiary-primary","shareBps":7000},{"beneficiaryId":"beneficiary-secondary","shareBps":3000}]'
invoke RequestBankMandate "${mandate_id}" "${acquired_policy_id}" "${account_id}" 2026-12-31

set_client_context bank BankMSP 12051 bankOfficer
invoke ReviewBankMandate "${mandate_id}" APPROVE "${hash_b}"
invoke RecordPremiumPayment "${payment_id}" "${acquired_policy_id}" "${mandate_id}" 2026-01-01 2026-01-30 10000 "${premium_receipt_hash}" OTP

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke QueuePremiumCollection "${collection_id}" "${mandate_id}" 2026-01-31

set_client_context bank BankMSP 12051 bankOfficer
invoke CompletePremiumCollection "${collection_id}" "${collection_payment_id}" 2026-03-01 "${collection_receipt_hash}"

set_client_context insurer InsurerMSP 7051 policyholder1
invoke SubmitBenefitRequest "${benefit_request_id}" "${acquired_policy_id}" DEATH 2026-06-15 "${hash_a}"

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke DecideBenefitRequest "${benefit_request_id}" APPROVE "${hash_b}"
invoke MarkBenefitPaymentReady "${benefit_request_id}" "${hash_c}"

set_client_context bank BankMSP 12051 bankOfficer
invoke ConfirmBenefitPayment "${benefit_request_id}" "${hash_d}"

set_client_context hospital HospitalMSP 8051 hospital1
invoke CreateHospitalInvoice "${invoice_id}" "${hash_a}" "${hash_a}" "${hash_c}" 250000 2026-06-10 2026-06-20 FINALIZED

set_client_context insurer InsurerMSP 7051 policyholder1
invoke SubmitInvoiceClaim "${claim_id}" "${policy_id}" hospital-demo "${invoice_id}" 250000 2026-06-15 "${hash_b}"
invoke AddEvidenceReference "${claim_id}" "${evidence_id}" DISCHARGE_SUMMARY "${hash_c}" "${hash_d}"
invoke GrantEvidenceAccess "${evidence_grant_id}" "${evidence_id}" AuditorMSP auditor auditor1 AUDIT "${grant_deadline}" 2

set_client_context auditor AuditorMSP 9051 auditor1
invoke RecordGrantedEvidenceAccess "${evidence_access_id}" "${evidence_id}" "${evidence_grant_id}" AUDIT

set_client_context insurer InsurerMSP 7051 policyholder1
invoke RevokeEvidenceAccess "${evidence_grant_id}"

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke CrossCheckClaimInvoice "${claim_id}" "${verification_id}"
invoke RecordFraudAssessment "${fraud_id}" "${claim_id}" transparent-claim-triage 1.0.0 "${hash_a}" "${hash_b}" 4300 MEDIUM '["COVERAGE_RATIO_40_PLUS","SINGLE_EVIDENCE_REFERENCE"]'
invoke OpenClaimReview "${claim_id}" "${review_id}" '["auditor1","auditor2","auditor3","auditor4"]' 3 2 "${review_deadline}"

for index in 1 2 3; do
  set_client_context auditor AuditorMSP 9051 "auditor${index}"
  invoke RecordAuditorDecision "${review_id}" "${decision_id}-${index}" APPROVE "${hash_b}"
done

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke AuthorizeSettlement "${settlement_id}" "${claim_id}"

set_client_context bank BankMSP 12051 bankOfficer
invoke ConfirmSettlement "${settlement_id}" "${hash_c}"

claim_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadClaim "${claim_id}")")"
settlement_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadSettlement "${settlement_id}")")"
policy_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadPolicy "${acquired_policy_id}")")"
collection_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadPremiumCollection "${collection_id}")")"
benefit_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadBenefitRequest "${benefit_request_id}")")"
liability_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadLiability "liability-benefit-${benefit_request_id}")")"
review_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadClaimReview "${review_id}")")"
fraud_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadFraudAssessment "${fraud_id}")")"
grant_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadEvidenceAccessGrant "${evidence_grant_id}")")"

test "$(jq -r '.status' <<<"${claim_json}")" = "SETTLED"
test "$(jq -r '.status' <<<"${settlement_json}")" = "CONFIRMED"
test "$(jq -r '.amountMinor' <<<"${settlement_json}")" = "250000"
test "$(jq -r '.status' <<<"${policy_json}")" = "ACTIVE"
test "$(jq -r '.nextPremiumDueDate' <<<"${policy_json}")" = "2026-03-02"
test "$(jq -r '.status' <<<"${collection_json}")" = "COMPLETED"
test "$(jq -r '.status' <<<"${benefit_json}")" = "PAID"
test "$(jq -r '.status' <<<"${liability_json}")" = "PAID"
test "$(jq -r '.status' <<<"${review_json}")" = "APPROVED"
test "$(jq -r '.votesCast' <<<"${review_json}")" = "3"
test "$(jq -r '.advisory' <<<"${fraud_json}")" = "true"
test "$(jq -r '.status' <<<"${grant_json}")" = "REVOKED"
test "$(jq -r '.accessCount' <<<"${grant_json}")" = "1"

echo "Verified live workflows: governed evidence grant used and revoked; claim ${claim_id} SETTLED by 3-of-4 review quorum; fraud triage remained advisory; policy ${acquired_policy_id} ACTIVE; collection COMPLETED; benefit PAID."
