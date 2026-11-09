#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd -- "${script_dir}/../.." && pwd -P)"
network_root="${root}/network"
domain="insurer.blockinsure.test"
export PATH="${network_root}/.fabric/fabric-samples/bin:${PATH}"
export FABRIC_CFG_PATH="${network_root}/.fabric/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=InsurerMSP
export CORE_PEER_TLS_ROOTCERT_FILE="${network_root}/organizations/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="${network_root}/organizations/peerOrganizations/${domain}/users/Admin@${domain}/msp"
export CORE_PEER_ADDRESS=localhost:7051
export FABRIC_CHANNEL_NAME=insurance-phase2-20260926

python3 - <<'PY'
import json
import os
import subprocess

def query(function):
    payload = json.dumps({"Args": [function]})
    output = subprocess.check_output([
        "peer", "chaincode", "query", "-C", os.environ["FABRIC_CHANNEL_NAME"],
        "-n", "insurance-contract", "-c", payload,
    ], stderr=subprocess.DEVNULL)
    return json.loads(output)

claims = [item for item in query("ListClaims") if item["id"].startswith("oracle-claim-")]
claim_ids = {item["id"] for item in claims}
requests = [item for item in query("ListOracleRequests") if item["claimId"] in claim_ids]
reviews = [item for item in query("ListClaimReviews") if item["claimId"] in claim_ids]
def select(items, fields):
    return [{field: item.get(field) for field in fields} for item in items]
report = {
    "schemaVersion": 1,
    "channel": os.environ["FABRIC_CHANNEL_NAME"],
    "method": "Read-only filtered ledger queries; synthetic Phase 2 browser claim IDs",
    "claims": select(claims, ["id", "status", "oracleOutcome", "createdAt", "updatedAt", "version"]),
    "requests": select(requests, ["id", "claimId", "status", "finalizationCode", "verifiedResult", "requestedAt", "finalizedAt", "commitmentCount", "revealCount"]),
    "reviews": select(reviews, ["id", "claimId", "status", "openedAt", "closedAt", "votesCast", "approvals", "rejections"]),
}
print(json.dumps(report, indent=2))
PY
