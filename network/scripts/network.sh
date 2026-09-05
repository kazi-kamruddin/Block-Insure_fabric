#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
channel_name="insurance-channel"
chaincode_name="${CHAINCODE_NAME:-insurance-contract}"
expected_chaincode_version="${EXPECTED_CHAINCODE_VERSION:-0.3.0}"
expected_schema_version="${EXPECTED_SCHEMA_VERSION:-2}"
compose_ca="${network_root}/compose/compose-ca.yaml"
compose_network="${network_root}/compose/compose-network.yaml"
organizations="${network_root}/organizations"
artifacts="${network_root}/channel-artifacts"

export PATH="${samples_root}/bin:${PATH}"

require_tool() { command -v "$1" >/dev/null || { echo "Missing required tool: $1" >&2; exit 1; }; }
docker_command=""

select_docker() {
  local attempt
  for attempt in {1..10}; do
    if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
      docker_command="docker"
      return
    elif command -v docker.exe >/dev/null && docker.exe info >/dev/null 2>&1; then
      docker_command="docker.exe"
      return
    fi
    if [ "${attempt}" -lt 10 ]; then
      echo "Docker is not ready (attempt ${attempt}/10); retrying in 2 seconds..." >&2
      sleep 2
    fi
  done
  echo "Docker Desktop is not reachable after 10 attempts." >&2
  exit 1
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

start_runtime() {
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
}

up() {
  require_tool fabric-ca-client
  require_tool configtxgen
  require_tool osnadmin
  require_tool peer
  if [ -f "${artifacts}/${channel_name}.block" ] && \
     [ -d "${organizations}/ordererOrganizations/blockinsure.test" ] && \
     [ -d "${organizations}/peerOrganizations/bank.blockinsure.test" ]; then
    compose up -d ca-insurer
    compose up -d ca-hospital
    compose up -d ca-auditor
    compose up -d ca-bank
    compose up -d ca-orderer
    start_runtime
    verify
    return
  fi
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
  start_runtime
  join_orderer
  join_peer insurer InsurerMSP 7051
  join_peer hospital HospitalMSP 8051
  join_peer auditor AuditorMSP 9051
  join_peer bank BankMSP 12051
  verify
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

verify() {
  local containers=(
    ca.insurer.blockinsure.test ca.hospital.blockinsure.test
    ca.auditor.blockinsure.test ca.bank.blockinsure.test
    ca.orderer.blockinsure.test orderer.blockinsure.test
    couchdb.insurer.blockinsure.test couchdb.hospital.blockinsure.test
    couchdb.auditor.blockinsure.test couchdb.bank.blockinsure.test
    peer0.insurer.blockinsure.test peer0.hospital.blockinsure.test
    peer0.auditor.blockinsure.test peer0.bank.blockinsure.test
  )
  local container port org ca_name definition schema chaincode_verified=false
  require_tool curl
  require_tool fabric-ca-client
  require_tool osnadmin
  require_tool peer

  for container in "${containers[@]}"; do
    if [ "$(docker_cli inspect -f '{{.State.Running}}' "${container}" 2>/dev/null || true)" != "true" ]; then
      echo "Verification failed: ${container} is not running." >&2
      exit 1
    fi
  done

  while read -r org port ca_name; do
    FABRIC_CA_CLIENT_HOME="${organizations}/verification/${org}" \
      fabric-ca-client getcainfo -u "https://localhost:${port}" --caname "${ca_name}" \
      --tls.certfiles "${organizations}/fabric-ca/${org}/ca-cert.pem" >/dev/null
  done <<'EOF'
insurer 7054 ca-insurer
hospital 8054 ca-hospital
auditor 9054 ca-auditor
bank 12054 ca-bank
orderer 11054 ca-orderer
EOF

  for port in 5984 6984 7984 8984; do
    curl --fail --silent --show-error --user admin:adminpw "http://localhost:${port}/_up" | grep -q '"status":"ok"'
  done

  osnadmin channel list -o localhost:7053 \
    --ca-file "${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt" \
    --client-cert "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.crt" \
    --client-key "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.key" \
    | grep -q "${channel_name}"

  while read -r org msp port; do
    set_peer_context "${org}" "${msp}" "${port}"
    peer channel getinfo -c "${channel_name}" >/dev/null
  done <<'EOF'
insurer InsurerMSP 7051
hospital HospitalMSP 8051
auditor AuditorMSP 9051
bank BankMSP 12051
EOF

  set_peer_context insurer InsurerMSP 7051
  definition="$(peer lifecycle chaincode querycommitted \
    --channelID "${channel_name}" --name "${chaincode_name}" 2>/dev/null || true)"
  if [[ -n "${definition}" ]]; then
    while read -r org msp port; do
      set_peer_context "${org}" "${msp}" "${port}"
      definition="$(peer lifecycle chaincode querycommitted \
        --channelID "${channel_name}" --name "${chaincode_name}")"
      if ! grep -q "Version: ${expected_chaincode_version}," <<<"${definition}"; then
        echo "Verification failed: ${org} peer does not report ${chaincode_name} ${expected_chaincode_version}." >&2
        exit 1
      fi
    done <<'EOF'
insurer InsurerMSP 7051
hospital HospitalMSP 8051
auditor AuditorMSP 9051
bank BankMSP 12051
EOF

    set_peer_context insurer InsurerMSP 7051
    schema="$(peer chaincode query -C "${channel_name}" -n "${chaincode_name}" \
      -c '{"function":"GetSchemaVersion","Args":[]}')"
    if [[ "${schema}" != "${expected_schema_version}" ]]; then
      echo "Verification failed: expected chaincode schema ${expected_schema_version}, received ${schema}." >&2
      exit 1
    fi
    chaincode_verified=true
  fi

  if [[ "${chaincode_verified}" == true ]]; then
    echo "Verified: 14 services healthy, 5 CAs reachable, 4 CouchDBs ready, all 4 peers joined ${channel_name}, and ${chaincode_name} ${expected_chaincode_version} exposes schema ${expected_schema_version}."
  else
    echo "Verified: 14 services healthy, 5 CAs reachable, 4 CouchDBs ready, and all 4 peers joined ${channel_name}; no committed ${chaincode_name} was found."
  fi
}

select_docker

case "${1:-}" in
  up) up ;;
  down) down ;;
  reset) reset ;;
  status) status ;;
  verify) verify ;;
  *) echo "Usage: $0 {up|down|reset|status|verify}" >&2; exit 1 ;;
esac
