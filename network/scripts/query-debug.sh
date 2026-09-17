#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
organizations="${network_root}/organizations"
export PATH="${samples_root}/bin:${PATH}"
export FABRIC_CFG_PATH="${samples_root}/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=InsurerMSP
export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/insurer.blockinsure.test/peers/peer0.insurer.blockinsure.test/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/insurer.blockinsure.test/users/insurerAdmin@insurer.blockinsure.test/msp"
export CORE_PEER_ADDRESS=localhost:7051
peer chaincode query -C insurance-channel -n insurance-contract -c '{"function":"ReadPolicyPackage","Args":["showcase-health-v1"]}'
