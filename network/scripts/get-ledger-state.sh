#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
organizations="${network_root}/organizations"
domain="insurer.blockinsure.test"
export PATH="${network_root}/.fabric/fabric-samples/bin:${PATH}"
export FABRIC_CFG_PATH="${network_root}/.fabric/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=InsurerMSP
export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/Admin@${domain}/msp"
export CORE_PEER_ADDRESS=localhost:7051

if [[ "$#" -eq 0 ]]; then
  echo "Provide at least one channel name" >&2
  exit 2
fi
for channel_name in "$@"; do
  if [[ ! "${channel_name}" =~ ^insurance-[a-z0-9-]+$ ]]; then
    echo "Invalid channel name: ${channel_name}" >&2
    exit 2
  fi
  printf '%s ' "${channel_name}"
  peer channel getinfo -c "${channel_name}"
done
