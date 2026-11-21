#!/usr/bin/env bash
# Read a medical claim and its approval certificate hash directly from a
# dev-lite peer, independent of the web Gateway. Read-only: evaluates only.
# Usage: bash network/scripts/read-dev-lite-certificate.sh [--couchdb] CLAIM_ID [VERSION]
set -euo pipefail

state_dir=dev-lite
if [[ "${1:-}" == "--couchdb" ]]; then state_dir=dev-lite-couchdb; shift; fi
claim_id="${1:-}"
[[ "$claim_id" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "Usage: $0 [--couchdb] CLAIM_ID [VERSION]" >&2; exit 2; }

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
export PATH="$root/network/.fabric/fabric-samples/bin:$PATH"
export FABRIC_CFG_PATH="$root/network/.fabric/fabric-samples/config"
domain=insurer.blockinsure.test
org_root="$root/data/$state_dir/organizations/peerOrganizations/$domain"
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=InsurerMSP CORE_PEER_ADDRESS=localhost:31051
export CORE_PEER_TLS_ROOTCERT_FILE="$org_root/peers/peer0.$domain/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$org_root/users/insurerAdmin@$domain/msp"
export CORE_PEER_BCCSP_SW_FILEKEYSTORE_KEYSTORE="$CORE_PEER_MSPCONFIGPATH/keystore"
[[ -d "$CORE_PEER_MSPCONFIGPATH" ]] || { echo "Missing enrolled Insurer identity under data/$state_dir" >&2; exit 1; }

query() { peer chaincode query -C insurance-dev-lite-190 -n insurance-contract -c "$1"; }
claim="$(query "{\"Args\":[\"ReadClaim\",\"$claim_id\"]}")"
version="${2:-$(jq -r '.version' <<<"$claim")}"
[[ "$version" =~ ^[1-9][0-9]{0,8}$ ]] || { echo "Invalid claim version" >&2; exit 2; }
certificate="$(query "{\"Args\":[\"ReadMedicalApprovalCertificate\",\"$claim_id\",\"$version\"]}")"
jq -n --argjson claim "$claim" --argjson certificate "$certificate" '{
  source: "Insurer peer localhost:31051 (direct evaluate, not the web Gateway)",
  claimId: $claim.id, status: $claim.status, version: $claim.version,
  certificateVersion: $certificate.claimVersion, certificateHash: $certificate.hash }'
