#!/bin/sh
# Read-only verification and optional warming of the existing isolated candidate.
set -eu
export FABRIC_LOGGING_SPEC=error
channel='insurance-workflow-alignment-20261108'
expected='insurance-contract_1.6.3-xgb-alignment:bc2a30f5b434c73649f765a31232892941ced4f617c7f5518cf399af8457c44a'
for org in insurer hospital auditor bank oracle; do
  case "$org" in
    insurer) msp=InsurerMSP; port=7051;; hospital) msp=HospitalMSP; port=8051;;
    auditor) msp=AuditorMSP; port=9051;; bank) msp=BankMSP; port=12051;; oracle) msp=OracleMSP; port=13051;;
  esac
  domain="$org.blockinsure.test"
  export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID="$msp"
  export CORE_PEER_TLS_ROOTCERT_FILE="/organizations/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="/organizations/peerOrganizations/$domain/users/Admin@$domain/msp"
  export CORE_PEER_ADDRESS="host.docker.internal:$port" CORE_PEER_TLS_SERVERHOSTOVERRIDE="peer0.$domain"
  installed=$(peer lifecycle chaincode queryinstalled)
  approval=$(peer lifecycle chaincode queryapproved --channelID "$channel" --name insurance-contract --sequence 4)
  definition=$(peer lifecycle chaincode querycommitted --channelID "$channel" --name insurance-contract)
  case "$installed" in *"$expected"*) ;; *) echo "$org installed package mismatch" >&2; exit 1;; esac
  case "$approval" in *"$expected"*) ;; *) echo "$org approved package mismatch" >&2; exit 1;; esac
  case "$definition" in *"Version: 1.6.3-xgb-alignment, Sequence: 4"*) ;; *) echo "$org definition mismatch" >&2; exit 1;; esac
  echo "PASSED $org installed/approved/committed exact isolated candidate"
done
if [ "${1:-}" = '--warm' ]; then
  for org in insurer hospital auditor bank oracle; do
    case "$org" in
      insurer) msp=InsurerMSP; port=7051;; hospital) msp=HospitalMSP; port=8051;;
      auditor) msp=AuditorMSP; port=9051;; bank) msp=BankMSP; port=12051;; oracle) msp=OracleMSP; port=13051;;
    esac
    domain="$org.blockinsure.test"
    export CORE_PEER_LOCALMSPID="$msp" CORE_PEER_ADDRESS="host.docker.internal:$port" CORE_PEER_TLS_SERVERHOSTOVERRIDE="peer0.$domain"
    export CORE_PEER_TLS_ROOTCERT_FILE="/organizations/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt"
    export CORE_PEER_MSPCONFIGPATH="/organizations/peerOrganizations/$domain/users/Admin@$domain/msp"
    schema=$(peer chaincode query -C "$channel" -n insurance-contract -c '{"Args":["GetSchemaVersion"]}')
    [ "$schema" = '15' ] || { echo "$org schema mismatch" >&2; exit 1; }
    echo "PASSED $org schema15 query"
  done
fi
