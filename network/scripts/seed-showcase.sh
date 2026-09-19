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
    --peerAddresses localhost:13051 \
    --tlsRootCertFiles "${organizations}/peerOrganizations/oracle.blockinsure.test/peers/peer0.oracle.blockinsure.test/tls/ca.crt" \
    --waitForEvent --waitForEventTimeout 90s -c "$(payload "${function}" "$@")" >/dev/null
}

exists() {
  peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload "$1" "$2")" >/dev/null 2>&1
}

hash_a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
hash_b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
registry_root="c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd"
package_id="showcase-health-v1"
benefit_plan_id="showcase-benefits-v1"
registry_id="registry-demo-v1"

set_client_context insurer InsurerMSP 7051 insurerAdmin
ensure_agreement() {
  local id="$1"
  shift
  if ! exists ReadPartnerAgreement "${id}"; then
    invoke CreatePartnerAgreement "${id}" "$@"
  fi
}

ensure_agreement agreement-hospital-demo HOSPITAL hospital-demo "Dhaka Central Medical Hospital" Dhaka Preferred "Read-only invoice verification fields" 2026-01-01 2028-12-31
ensure_agreement agreement-hospital-2 HOSPITAL hospital-2 "Chattogram Metropolitan Hospital" Chattogram Standard "Read-only invoice verification fields" 2026-01-01 2028-12-31
ensure_agreement agreement-hospital-3 HOSPITAL hospital-3 "Rajshahi Community Hospital" Rajshahi Standard "Read-only invoice verification fields" 2026-01-01 2028-12-31
ensure_agreement agreement-hospital-4 HOSPITAL hospital-4 "Khulna Riverside Hospital" Khulna Standard "Read-only invoice verification fields" 2026-01-01 2028-12-31
ensure_agreement agreement-hospital-5 HOSPITAL hospital-5 "Sylhet Valley Hospital" Sylhet Standard "Read-only invoice verification fields" 2026-01-01 2028-12-31
ensure_agreement agreement-bank-demo BANK bank-demo "Bangladesh Demo Commercial Bank" Dhaka Collection "Premium collection and settlement confirmation" 2026-01-01 2028-12-31

set_client_context bank BankMSP 12051 bankOfficer
if ! exists ReadBankAccountReference showcase-customer-account; then
  invoke OpenBankAccount showcase-customer-account bank-demo policyholder1 CUSTOMER "Policyholder primary" "**** **** 4821" "${hash_a}" 100000
fi
if ! exists ReadBankAccountReference bank-insurer-premium; then
  invoke OpenBankAccount bank-insurer-premium bank-demo insurer INSURER "Block-Insure settlement" "**** **** 9001" "${hash_b}" 500000
fi

set_client_context insurer InsurerMSP 7051 insurerAdmin
if ! exists ReadPolicyPackage "${package_id}"; then
  invoke CreatePolicyPackage "${package_id}" "Supervisor Health Cover" "Demonstration inpatient coverage with certificate-bound Oracle adjudication" 10000 500000 "${hash_a}"
  invoke ConfigurePolicyPackagePartners "${package_id}" '["hospital-demo","hospital-2","hospital-3","hospital-4","hospital-5"]' '["bank-demo"]'
  invoke CreateBenefitPlan "${benefit_plan_id}" "${package_id}" 300000 100000 200000 "${hash_b}"
  invoke PublishBenefitPlan "${benefit_plan_id}"
  invoke PublishPolicyPackage "${package_id}"
fi
package_json="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" -c "$(payload ReadPolicyPackage "${package_id}")")"
if ! jq -e '(.hospitalIds | length) > 0 and (.bankIds | length) > 0' >/dev/null <<<"${package_json}"; then
  invoke ConfigurePolicyPackagePartners "${package_id}" '["hospital-demo","hospital-2","hospital-3","hospital-4","hospital-5"]' '["bank-demo"]'
fi

for index in 1 2 3 4 5; do
  case "${index}" in
    1) subject="hospital-demo" ;;
    *) subject="hospital-${index}" ;;
  esac
  invoice_id="showcase-invoice-${subject}"
  set_client_context hospital HospitalMSP 8051 "hospital${index}"
  if ! exists ReadHospitalInvoice "${invoice_id}"; then
    invoke CreateHospitalInvoice "${invoice_id}" "${hash_a}" "${hash_b}" "${registry_root}" "$((200000 + index * 10000))" 2026-06-10 2026-06-20 FINALIZED
  fi
done

set_client_context insurer InsurerMSP 7051 insurerAdmin
if ! exists ReadOracleRegistrySnapshot "${registry_id}"; then
  invoke PublishOracleRegistrySnapshot "${registry_id}" 1 "${registry_root}" rules-v1 "${hash_a}" 3
fi

echo "Showcase seed is ready: six partner agreements, two balance-bearing Bank accounts, five Hospital invoices, package ${package_id}, benefit plan ${benefit_plan_id}, and Oracle registry ${registry_id}."
echo "The clean seed creates no policies, claims, reviews, settlements, or Oracle requests."
