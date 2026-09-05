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

suffix="$(date +%s)"
package_id="smoke-package-${suffix}"
policy_id="smoke-policy-${suffix}"
claim_id="smoke-claim-${suffix}"
evidence_id="smoke-evidence-${suffix}"
verification_id="smoke-verification-${suffix}"
decision_id="smoke-decision-${suffix}"
settlement_id="smoke-settlement-${suffix}"
hash_a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
hash_b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
hash_c="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
hash_d="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke CreatePolicyPackage "${package_id}" "Smoke Health Plan" "Live Fabric workflow verification" 10000 1000000 "${hash_a}"
invoke PublishPolicyPackage "${package_id}"
invoke IssuePolicy "${policy_id}" "${package_id}" policyholder1 2026-01-01 2026-12-31

set_client_context insurer InsurerMSP 7051 policyholder1
invoke SubmitClaim "${claim_id}" "${policy_id}" 250000 2026-06-15 "${hash_b}"
invoke AddEvidenceReference "${claim_id}" "${evidence_id}" DISCHARGE_SUMMARY "${hash_c}" "${hash_d}"

set_client_context hospital HospitalMSP 8051 hospitalOfficer
invoke VerifyClaim "${claim_id}" "${verification_id}" VERIFIED "${hash_a}"

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke StartClaimReview "${claim_id}"

set_client_context auditor AuditorMSP 9051 auditor
invoke RecordAuditorDecision "${claim_id}" "${decision_id}" APPROVE "${hash_b}"

set_client_context insurer InsurerMSP 7051 insurerAdmin
invoke AuthorizeSettlement "${settlement_id}" "${claim_id}"

set_client_context bank BankMSP 12051 bankOfficer
invoke ConfirmSettlement "${settlement_id}" "${hash_c}"

claim_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadClaim "${claim_id}")")"
settlement_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadSettlement "${settlement_id}")")"

test "$(jq -r '.status' <<<"${claim_json}")" = "SETTLED"
test "$(jq -r '.status' <<<"${settlement_json}")" = "CONFIRMED"
test "$(jq -r '.amountMinor' <<<"${settlement_json}")" = "250000"

echo "Verified live workflow ${claim_id}: claim SETTLED and settlement CONFIRMED."
