#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/../.." && pwd -P)"
network_root="${project_root}/network"
organizations="${network_root}/organizations"
domain="insurer.blockinsure.test"
channel_name="${FABRIC_CHANNEL_NAME:-}"
if [[ ! "${channel_name}" =~ ^insurance-phase2-[a-z0-9-]+$ ]]; then
  echo "Set FABRIC_CHANNEL_NAME to an isolated insurance-phase2-* channel" >&2
  exit 2
fi
export PATH="${network_root}/.fabric/fabric-samples/bin:${PATH}"
export FABRIC_CFG_PATH="${network_root}/.fabric/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=InsurerMSP
export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/insurerAdmin@${domain}/msp"
export CORE_PEER_ADDRESS=localhost:7051

issue_policy() {
  local policy_id="$1"
  if peer chaincode query -C "${channel_name}" -n insurance-contract -c "{\"Args\":[\"ReadPolicy\",\"${policy_id}\"]}" >/dev/null 2>&1; then
    return
  fi
  peer chaincode invoke \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.blockinsure.test \
  --tls --cafile "${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt" \
  -C "${channel_name}" -n insurance-contract \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt" \
  --peerAddresses localhost:8051 \
  --tlsRootCertFiles "${organizations}/peerOrganizations/hospital.blockinsure.test/peers/peer0.hospital.blockinsure.test/tls/ca.crt" \
  --waitForEvent --waitForEventTimeout 90s \
  -c "{\"Args\":[\"IssuePolicy\",\"${policy_id}\",\"showcase-health-v1\",\"policyholder1\",\"2026-01-01\",\"2026-12-31\"]}"
}

issue_policy phase2-load-policy
for index in 1 2 3 4 5; do
  issue_policy "phase2-load-policy-${index}"
done
echo "Six synthetic active load policies are ready for policyholder1; the robustness profile rotates five showcase Hospital invoices."
