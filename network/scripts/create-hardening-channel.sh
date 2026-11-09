#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
organizations="${network_root}/organizations"
artifacts="${network_root}/channel-artifacts"
channel_name="insurance-phase2-hardening-20260927"
block="${artifacts}/${channel_name}.block"
orderer_ca="${organizations}/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt"

export PATH="${samples_root}/bin:${PATH}"

if [[ ! -f "${artifacts}/insurance-channel.block" ]]; then
  echo "Preserved development network is missing; start it with network.sh up first." >&2
  exit 1
fi

if [[ ! -f "${block}" ]]; then
  FABRIC_CFG_PATH="${network_root}/config" configtxgen \
    -profile InsuranceChannel -outputBlock "${block}" -channelID "${channel_name}"
fi

if ! osnadmin channel list -o localhost:7053 \
  --ca-file "${orderer_ca}" \
  --client-cert "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.crt" \
  --client-key "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.key" \
  | grep -q "${channel_name}"; then
  osnadmin channel join --channelID "${channel_name}" --config-block "${block}" \
    -o localhost:7053 --ca-file "${orderer_ca}" \
    --client-cert "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.crt" \
    --client-key "${organizations}/ordererOrganizations/blockinsure.test/users/Admin@blockinsure.test/tls/client.key"
fi

export FABRIC_CFG_PATH="${samples_root}/config"
for entry in "insurer InsurerMSP 7051" "hospital HospitalMSP 8051" "auditor AuditorMSP 9051" "bank BankMSP 12051" "oracle OracleMSP 13051"; do
  read -r org msp port <<<"${entry}"
  domain="${org}.blockinsure.test"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
  if ! peer channel list | grep -q "^${channel_name}$"; then
    peer channel join -b "${block}"
  fi
done

CHANNEL_NAME="${channel_name}" CHAINCODE_VERSION="1.4.1-hardening" bash "${script_dir}/deploy-chaincode.sh"
CHANNEL_NAME="${channel_name}" bash "${script_dir}/seed-showcase.sh"
echo "Hardening verification channel is ready: ${channel_name}. Preserved insurance-channel was not modified."
