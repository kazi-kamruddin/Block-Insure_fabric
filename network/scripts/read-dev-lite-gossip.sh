#!/usr/bin/env bash
# Confirm private-data participants see each other through Fabric discovery.
set -euo pipefail
shopt -s nullglob
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
channel="${1:-insurance-dev-lite-190}"
[[ "$channel" = insurance-dev-lite-190 ]] || exit 2
if (( $# )); then shift; fi
discover="$root/network/.fabric/fabric-samples/bin/discover"

orgs=("$@")
if (( ${#orgs[@]} == 0 )); then orgs=(insurer hospital oracle); fi
(( ${#orgs[@]} >= 2 )) || exit 2
for org in "${orgs[@]}"; do
  case "$org" in
    insurer) port=31051 ;;
    hospital) port=31151 ;;
    auditor) port=31251 ;;
    bank) port=31351 ;;
    oracle) port=31451 ;;
    *) exit 2 ;;
  esac
  domain="$org.blockinsure.test"
  home="$root/data/dev-lite/organizations/peerOrganizations/$domain"
  msp="$home/users/Admin@$domain/msp"
  keys=("$msp/keystore/"*)
  certs=("$msp/signcerts/"*)
  [[ ${#keys[@]} = 1 && ${#certs[@]} = 1 ]] || exit 2
  if ! report="$(timeout 6s "$discover" peers --channel "$channel" --server "localhost:$port" \
    --MSP "${org^}MSP" --peerTLSCA "$home/peers/peer0.$domain/tls/ca.crt" \
    --userKey "${keys[0]}" --userCert "${certs[0]}" 2>/dev/null)"; then
    exit 1
  fi

  # Discovery includes signing certificates. Only emit a sanitized readiness signal.
  printf '%s' "$report" | python3 -c '
import json, sys
try:
    members = {(peer["MSPID"], peer["Endpoint"]) for peer in json.load(sys.stdin)}
except (ValueError, TypeError, KeyError):
    sys.exit(1)
for org in sys.argv[2:]:
    if org != sys.argv[1] and (org.capitalize()+"MSP", f"peer0.{org}.blockinsure.test:7051") not in members:
        sys.exit(1)
' "$org" "${orgs[@]}"
done
printf 'Private-data participants mutually visible by discovery: %s\n' "${orgs[*]}"
