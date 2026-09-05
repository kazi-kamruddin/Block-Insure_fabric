#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
project_root="$(cd -- "${network_root}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
organizations="${network_root}/organizations"
artifacts="${network_root}/channel-artifacts"
chaincode_root="${project_root}/chaincode/insurance-contract"

channel_name="${CHANNEL_NAME:-insurance-channel}"
chaincode_name="${CHAINCODE_NAME:-insurance-contract}"
chaincode_version="${CHAINCODE_VERSION:-0.3.0}"
chaincode_sequence="${CHAINCODE_SEQUENCE:-}"
chaincode_label="${chaincode_name}_${chaincode_version}"
package_file="${artifacts}/${chaincode_label}.tar.gz"
orderer_ca="${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt"

export PATH="${samples_root}/bin:${PATH}"
export FABRIC_CFG_PATH="${samples_root}/config"

package_chaincode() {
  if command -v go >/dev/null 2>&1; then
    peer lifecycle chaincode package "${package_file}" \
      --path "${chaincode_root}" --lang golang --label "${chaincode_label}"
    return
  fi

  local docker_command="" chaincode_mount="${chaincode_root}" artifacts_mount="${artifacts}"
  local bin_mount="${samples_root}/bin" config_mount="${samples_root}/config"
  local attempt
  for attempt in {1..10}; do
    if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
      docker_command="docker"
      break
    elif command -v docker.exe >/dev/null && docker.exe info >/dev/null 2>&1; then
      docker_command="docker.exe"
      chaincode_mount="$(wslpath -w "${chaincode_root}")"
      artifacts_mount="$(wslpath -w "${artifacts}")"
      bin_mount="$(wslpath -w "${samples_root}/bin")"
      config_mount="$(wslpath -w "${samples_root}/config")"
      break
    fi
    if [ "${attempt}" -lt 10 ]; then
      echo "Docker is not ready (attempt ${attempt}/10); retrying in 2 seconds..." >&2
      sleep 2
    fi
  done
  if [ -z "${docker_command}" ]; then
    echo "Go is unavailable and Docker Desktop cannot provide the isolated Go packager after 10 attempts." >&2
    exit 1
  fi

  "${docker_command}" run --rm \
    -v "${chaincode_mount}:/chaincode:ro" \
    -v "${artifacts_mount}:/artifacts" \
    -v "${bin_mount}:/fabric-bin:ro" \
    -v "${config_mount}:/fabric-config:ro" \
    -e FABRIC_CFG_PATH=/fabric-config \
    golang:1.25 /fabric-bin/peer lifecycle chaincode package "/artifacts/${chaincode_label}.tar.gz" \
      --path /chaincode --lang golang --label "${chaincode_label}"
  "${docker_command}" run --rm -v "${artifacts_mount}:/artifacts" \
    golang:1.25 chmod 0644 "/artifacts/${chaincode_label}.tar.gz"
}

set_peer_context() {
  local org="$1" msp="$2" port="$3"
  local domain="${org}.blockinsure.test"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
}

approve_for_org() {
  local org="$1" msp="$2" port="$3"
  set_peer_context "${org}" "${msp}" "${port}"
  peer lifecycle chaincode approveformyorg \
    -o localhost:7050 --ordererTLSHostnameOverride orderer.blockinsure.test \
    --channelID "${channel_name}" --name "${chaincode_name}" \
    --version "${chaincode_version}" --package-id "${package_id}" \
    --sequence "${chaincode_sequence}" --tls --cafile "${orderer_ca}"
}

resolve_chaincode_sequence() {
  if [[ -n "${chaincode_sequence}" ]]; then
    return
  fi

  set_peer_context insurer InsurerMSP 7051
  local committed definition_version definition_sequence
  committed="$(peer lifecycle chaincode querycommitted \
    --channelID "${channel_name}" --name "${chaincode_name}" 2>/dev/null || true)"
  definition_version="$(sed -n 's/^Version: \([^,]*\), Sequence: \([0-9][0-9]*\).*/\1/p' <<<"${committed}")"
  definition_sequence="$(sed -n 's/^Version: \([^,]*\), Sequence: \([0-9][0-9]*\).*/\2/p' <<<"${committed}")"

  if [[ -z "${definition_sequence}" ]]; then
    chaincode_sequence=1
    return
  fi
  if [[ "${definition_version}" == "${chaincode_version}" ]]; then
    echo "${chaincode_name} ${chaincode_version} is already committed at sequence ${definition_sequence}."
    echo "Set CHAINCODE_VERSION to a new version when the source changes."
    exit 0
  fi
  chaincode_sequence="$((definition_sequence + 1))"
}

resolve_chaincode_sequence
mkdir -p "${artifacts}"
package_chaincode
package_id="$(peer lifecycle chaincode calculatepackageid "${package_file}")"

while read -r org msp port; do
  set_peer_context "${org}" "${msp}" "${port}"
  peer lifecycle chaincode install "${package_file}"
done <<'EOF'
insurer InsurerMSP 7051
hospital HospitalMSP 8051
auditor AuditorMSP 9051
bank BankMSP 12051
EOF

approve_for_org insurer InsurerMSP 7051
approve_for_org hospital HospitalMSP 8051
approve_for_org auditor AuditorMSP 9051
approve_for_org bank BankMSP 12051

set_peer_context insurer InsurerMSP 7051
peer lifecycle chaincode checkcommitreadiness \
  --channelID "${channel_name}" --name "${chaincode_name}" \
  --version "${chaincode_version}" --sequence "${chaincode_sequence}" --output json

peer lifecycle chaincode commit \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.blockinsure.test \
  --channelID "${channel_name}" --name "${chaincode_name}" \
  --version "${chaincode_version}" --sequence "${chaincode_sequence}" \
  --tls --cafile "${orderer_ca}" \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "${organizations}/peerOrganizations/insurer.blockinsure.test/peers/peer0.insurer.blockinsure.test/tls/ca.crt" \
  --peerAddresses localhost:8051 \
  --tlsRootCertFiles "${organizations}/peerOrganizations/hospital.blockinsure.test/peers/peer0.hospital.blockinsure.test/tls/ca.crt" \
  --peerAddresses localhost:9051 \
  --tlsRootCertFiles "${organizations}/peerOrganizations/auditor.blockinsure.test/peers/peer0.auditor.blockinsure.test/tls/ca.crt" \
  --peerAddresses localhost:12051 \
  --tlsRootCertFiles "${organizations}/peerOrganizations/bank.blockinsure.test/peers/peer0.bank.blockinsure.test/tls/ca.crt"

while read -r org msp port; do
  set_peer_context "${org}" "${msp}" "${port}"
  peer lifecycle chaincode querycommitted --channelID "${channel_name}" --name "${chaincode_name}"
done <<'EOF'
insurer InsurerMSP 7051
hospital HospitalMSP 8051
auditor AuditorMSP 9051
bank BankMSP 12051
EOF

echo "Committed ${chaincode_name} ${chaincode_version} (sequence ${chaincode_sequence}) to ${channel_name}."
