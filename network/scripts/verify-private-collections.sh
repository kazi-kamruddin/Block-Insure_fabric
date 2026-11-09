#!/usr/bin/env bash
set -euo pipefail

channel_name="${FABRIC_CHANNEL_NAME:-}"
presentation_id="${1:-}"
if [[ ! "${channel_name}" =~ ^insurance-(phase2|workflow)-[a-z0-9-]+$ || ! "${presentation_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$ ]]; then
  echo "Usage: FABRIC_CHANNEL_NAME=insurance-{phase2,workflow}-* $0 <registered-presentation-id>" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="${script_dir}/.."
organizations="${network_root}/organizations"
export PATH="${network_root}/.fabric/fabric-samples/bin:${PATH}"
export FABRIC_CFG_PATH="${network_root}/.fabric/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=InsurerMSP
export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/insurer.blockinsure.test/users/insurerAdmin@insurer.blockinsure.test/msp"

query_on_peer() {
  local org="$1" port="$2" function="$3" id="$4"
  local domain="${org}.blockinsure.test"
  CORE_PEER_ADDRESS="localhost:${port}" \
  CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt" \
    peer chaincode query -C "${channel_name}" -n insurance-contract \
      -c "{\"Args\":[\"${function}\",\"${id}\"]}"
}

bank_id=showcase-customer-account
authorized_bank="$(query_on_peer insurer 7051 ReadBankAccountReference "${bank_id}")"
jq -e '(.accountTokenHash | type == "string" and length == 64) and (.balanceMinor | type == "number")' >/dev/null <<<"${authorized_bank}"
authorized_proof="$(query_on_peer insurer 7051 ReadSelectiveDisclosurePresentationPrivate "${presentation_id}")"
jq -e '(.disclosures | length) > 0' >/dev/null <<<"${authorized_proof}"

error_file="$(mktemp)"
trap 'rm -f -- "${error_file}"' EXIT
if query_on_peer auditor 9051 ReadBankAccountReference "${bank_id}" >"${error_file}" 2>&1; then
  echo "Auditor peer returned Bank collection values" >&2
  exit 1
fi
if grep -q 'accountTokenHash' "${error_file}"; then
  echo "Auditor peer error output leaked Bank account values" >&2
  exit 1
fi
if query_on_peer bank 12051 ReadSelectiveDisclosurePresentationPrivate "${presentation_id}" >"${error_file}" 2>&1; then
  echo "Bank peer returned Oracle proof collection values" >&2
  exit 1
fi
if grep -q 'disclosures' "${error_file}"; then
  echo "Bank peer error output leaked Oracle proof values" >&2
  exit 1
fi
echo "Authorized reads succeeded; excluded peers could not retrieve either private collection value."
