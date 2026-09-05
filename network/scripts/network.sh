#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
channel_name="insurance-channel"
compose_ca="${network_root}/compose/compose-ca.yaml"
compose_network="${network_root}/compose/compose-network.yaml"
organizations="${network_root}/organizations"
artifacts="${network_root}/channel-artifacts"

export PATH="${samples_root}/bin:${PATH}"

require_tool() { command -v "$1" >/dev/null || { echo "Missing required tool: $1" >&2; exit 1; }; }
docker_command=""

select_docker() {
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    docker_command="docker"
  elif command -v docker.exe >/dev/null && docker.exe info >/dev/null 2>&1; then
    docker_command="docker.exe"
  else
    echo "Docker Desktop is not reachable from this shell." >&2
    exit 1
  fi
}

docker_cli() { "${docker_command}" "$@"; }
compose() {
  if [ "${docker_command}" = "docker.exe" ]; then
    docker_cli compose -f "$(wslpath -w "${compose_ca}")" -f "$(wslpath -w "${compose_network}")" "$@"
  else
    docker_cli compose -f "${compose_ca}" -f "${compose_network}" "$@"
  fi
}

wait_for_running() {
  local container="$1" attempts=30
  until [ "$(docker_cli inspect -f '{{.State.Running}}' "${container}" 2>/dev/null || true)" = "true" ]; do
    attempts=$((attempts - 1))
    if [ "${attempts}" -eq 0 ]; then
      echo "${container} did not start. Inspect it with: docker logs ${container}" >&2
      exit 1
    fi
    sleep 2
  done
}

set_peer_context() {
  local org="$1" msp="$2" port="$3"
  local domain="${org}.blockinsure.test"
  export FABRIC_CFG_PATH="${samples_root}/config"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
}

join_orderer() {
  osnadmin channel join --channelID "${channel_name}" --config-block "${artifacts}/${channel_name}.block" \
    -o localhost:7053 \
    --ca-file "${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt" \
    --client-cert "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.crt" \
    --client-key "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.key"
}

join_peer() {
  local org="$1" msp="$2" port="$3"
  set_peer_context "${org}" "${msp}" "${port}"
  peer channel join -b "${artifacts}/${channel_name}.block"
}

set_anchor_peer() {
  local org="$1" msp="$2" port="$3" org_name="$4"
  local update="${artifacts}/${org}-anchors.tx"
  FABRIC_CFG_PATH="${network_root}/config" configtxgen -profile InsuranceChannel -outputAnchorPeersUpdate "${update}" -channelID "${channel_name}" -asOrg "${org_name}"
  set_peer_context "${org}" "${msp}" "${port}"
  peer channel update -o localhost:7050 --ordererTLSHostnameOverride orderer.blockinsure.test --tls \
    --cafile "${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt" \
    -c "${channel_name}" -f "${update}"
}

up() {
  require_tool fabric-ca-client
  require_tool configtxgen
  require_tool osnadmin
  require_tool peer
  compose up -d ca-insurer
  compose up -d ca-hospital
  compose up -d ca-auditor
  compose up -d ca-bank
  compose up -d ca-orderer
  wait_for_running ca.insurer.blockinsure.test
  wait_for_running ca.hospital.blockinsure.test
  wait_for_running ca.auditor.blockinsure.test
  wait_for_running ca.bank.blockinsure.test
  wait_for_running ca.orderer.blockinsure.test
  bash "${network_root}/scripts/enroll-identities.sh"
  mkdir -p "${artifacts}"
  FABRIC_CFG_PATH="${network_root}/config" configtxgen -profile InsuranceChannel -outputBlock "${artifacts}/${channel_name}.block" -channelID "${channel_name}"
  compose up -d orderer
  compose up -d couchdb-insurer couchdb-hospital couchdb-auditor couchdb-bank
  compose up -d peer-insurer
  compose up -d peer-hospital
  compose up -d peer-auditor
  compose up -d peer-bank
  wait_for_running orderer.blockinsure.test
  wait_for_running peer0.insurer.blockinsure.test
  wait_for_running peer0.hospital.blockinsure.test
  wait_for_running peer0.auditor.blockinsure.test
  wait_for_running peer0.bank.blockinsure.test
  join_orderer
  join_peer insurer InsurerMSP 7051
  join_peer hospital HospitalMSP 8051
  join_peer auditor AuditorMSP 9051
  join_peer bank BankMSP 12051
  status
}

down() { compose down --remove-orphans; }

reset() {
  local reset_mount="${network_root}"
  compose down --volumes --remove-orphans
  if [ "${docker_command}" = "docker.exe" ]; then
    reset_mount="$(wslpath -w "${network_root}")"
  fi
  docker_cli run --rm -v "${reset_mount}:/work" hyperledger/fabric-ca:1.5.17 \
    sh -c 'rm -rf /work/organizations /work/channel-artifacts'
}

status() {
  compose ps
  set_peer_context insurer InsurerMSP 7051
  peer channel list
  set_peer_context hospital HospitalMSP 8051
  peer channel list
  set_peer_context auditor AuditorMSP 9051
  peer channel list
  set_peer_context bank BankMSP 12051
  peer channel list
}

select_docker

case "${1:-}" in
  up) up ;;
  down) down ;;
  reset) reset ;;
  status) status ;;
  *) echo "Usage: $0 {up|down|reset|status}" >&2; exit 1 ;;
esac
