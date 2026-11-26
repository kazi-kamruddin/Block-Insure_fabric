#!/usr/bin/env bash
# Read-only: print the committed insurance-contract definition on each of the
# five LevelDB dev-lite peers, one line per organization.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
channel="${1:-insurance-dev-lite-190}"
chaincode="${2:-insurance-contract}"
package_id="${3:-}"
sequence="${4:-}"
version="${5:-}"
if [[ -n "$package_id" ]]; then
  [[ "$channel" = insurance-dev-lite-190 && "$chaincode" = insurance-contract && "$sequence" =~ ^[0-9]+$ ]]
fi
export PATH="$root/network/.fabric/fabric-samples/bin:$PATH"
export FABRIC_CFG_PATH="$root/network/.fabric/fabric-samples/config" CORE_PEER_TLS_ENABLED=true
orgs=(insurer hospital auditor bank oracle)
for i in "${!orgs[@]}"; do
  org=${orgs[$i]}
  domain="$org.blockinsure.test"
  base="$root/data/dev-lite/organizations/peerOrganizations/$domain"
  export CORE_PEER_ADDRESS="localhost:$((31051 + i * 100))" CORE_PEER_LOCALMSPID="${org^}MSP"
  export CORE_PEER_TLS_ROOTCERT_FILE="$base/peers/peer0.$domain/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="$base/users/Admin@$domain/msp"
  export CORE_PEER_BCCSP_SW_FILEKEYSTORE_KEYSTORE="$CORE_PEER_MSPCONFIGPATH/keystore"
  definition="$(peer lifecycle chaincode querycommitted -C "$channel" -n "$chaincode" 2>&1 | grep -o 'Version: [^,]*, Sequence: [0-9]*' || echo 'unreadable')"
  echo "$org $definition"
  if [[ -n "$package_id" ]]; then
    [[ "$definition" = "Version: $version, Sequence: $sequence" ]] || exit 1
    approval="$(peer lifecycle chaincode queryapproved -C "$channel" -n "$chaincode" --sequence "$sequence" --output json 2>/dev/null)"
    installed="$(peer lifecycle chaincode queryinstalled --output json 2>/dev/null)"
    grep -Fq -- "$package_id" <<< "$approval" || exit 1
    grep -Fq -- "$package_id" <<< "$installed" || exit 1
  fi
done
