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
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=InsurerMSP
export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/insurer.blockinsure.test/peers/peer0.insurer.blockinsure.test/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/insurer.blockinsure.test/users/insurerAdmin@insurer.blockinsure.test/msp"
export CORE_PEER_ADDRESS=localhost:7051

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

if ! exists ReadPolicyPackage "${package_id}"; then
  invoke CreatePolicyPackage "${package_id}" "Supervisor Health Cover" "Demonstration inpatient coverage with certificate-bound Oracle adjudication" 10000 500000 "${hash_a}"
  invoke CreateBenefitPlan "${benefit_plan_id}" "${package_id}" 300000 100000 200000 "${hash_b}"
  invoke PublishBenefitPlan "${benefit_plan_id}"
  invoke PublishPolicyPackage "${package_id}"
fi

if ! exists ReadOracleRegistrySnapshot "${registry_id}"; then
  invoke PublishOracleRegistrySnapshot "${registry_id}" 1 "${registry_root}" rules-v1 "${hash_a}" 3
fi

echo "Showcase seed is ready: package ${package_id}, benefit plan ${benefit_plan_id}, and Oracle registry ${registry_id}."
echo "The clean seed creates no policies, claims, reviews, settlements, or Oracle requests."
