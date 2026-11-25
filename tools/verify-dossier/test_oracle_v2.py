from copy import deepcopy
import json
from pathlib import Path
import subprocess

import pytest

import oracle_v2
from verify_dossier import verify_oracle


@pytest.fixture(scope="module")
def v2_dossier():
    vector_path = Path(__file__).resolve().parents[2] / "services/oracle-worker/test/vectors/v2/protocol.json"
    vector = json.loads(vector_path.read_text(encoding="utf-8"))["vector"]
    stamp = "2026-11-25T01:00:00Z"
    pins = [{"issuerId": f"source-{letter}", "keyVersion": 1, "feedVersion": 1, "root": "a" * 64,
             "effectiveAt": stamp, "anchoredAt": stamp} for letter in ("a", "b", "c")]
    feeds = [{**pin, "coverageHash": "b" * 64} for pin in pins]
    bodies = [{field: feed[field] for field in ("issuerId", "keyVersion", "feedVersion", "root", "effectiveAt", "coverageHash")}
              for feed in feeds]
    generator = """
const fs = require("node:fs");
const {generateKeyPairSync,sign} = require("node:crypto");
const digests = JSON.parse(fs.readFileSync(0,"utf8"));
process.stdout.write(JSON.stringify(digests.map(digest => {
  const {privateKey,publicKey} = generateKeyPairSync("ed25519");
  return [publicKey.export({format:"der",type:"spki"}).toString("base64url"),
    sign(null,Buffer.from(digest,"hex"),privateKey).toString("base64url")];
})));
"""
    rows = json.loads(subprocess.run(["node", "-e", generator], input=json.dumps([
        oracle_v2.digest("oracle-v2:anchor", body) for body in bodies
    ]), capture_output=True, text=True, check=True, timeout=10).stdout)
    issuers = []
    for feed, (key, sig), kind in zip(feeds, rows, ("HOSPITAL_HIS", "REGULATOR", "CLAIMANT_RECEIPT"), strict=True):
        feed["signature"] = sig
        issuers.append({"issuerId": feed["issuerId"], "keyVersion": 1, "kind": kind, "ed25519PublicKey": key,
                        "validFrom": "2026-11-01T00:00:00Z", "validUntil": "2027-01-01T00:00:00Z", "status": "ACTIVE"})
    manifest = {"schema": "oracle-v2-source-manifest-v1", "requestedAt": stamp, "pins": pins}
    vector["manifestHash"] = oracle_v2.digest("oracle-v2:manifest", manifest)
    vector_hash = oracle_v2.digest("oracle-v2:fact-vector", vector)
    encoded = oracle_v2.canonical(vector)
    channel, request_id = "insurance-dev-lite-190", "request-synthetic-201"
    code, release = f"V2:AUTO_APPROVE:{vector_hash}", "fabric-xgb-synthetic-e2"
    claim_id, version = vector["claimId"], vector["claimVersion"]
    request = {"id": request_id, "claimId": claim_id, "claimVersion": version, "expectedResponses": 3,
               "requiredConfirmations": 2, "assignedOracleIds": ["oracle1", "oracle2", "oracle3"],
               "protocolVersion": "v2", "rosterVersion": "roster-one", "policyVersion": vector["policyVersion"],
               "requestedAt": stamp, "modelVersion": release, "manifest": manifest, "manifestHash": vector["manifestHash"],
               "factVectorHash": vector_hash, "factVectorJSON": encoded, "decision": "AUTO_APPROVE",
               "status": "CONSENSUS", "finalizationCode": code, "resultHash": vector_hash,
               "commitmentCount": 2, "revealCount": 2}
    results, commitments, reveals = [], [], []
    for worker in ("oracle1", "oracle2"):
        common = {"id": f"{request_id}:{worker}", "requestId": request_id, "claimId": claim_id,
                  "claimVersion": version, "oracleIdentity": f"{worker}-fixture-identity", "oracleId": worker}
        salt = "c" * 64
        results.append({**common, "protocolVersion": "v2", "workerDiagnosticsHash": "d" * 64,
                        "factVectorJSON": encoded, "modelVersion": release, "decision": "AUTO_APPROVE", "verified": True,
                        "resultHash": vector_hash, "verificationCode": code})
        commitments.append({**common, "commitmentHash": oracle_v2.digest("oracle-v2:commit", [
            channel, request_id, version, worker, vector_hash, "AUTO_APPROVE", salt,
        ])})
        reveals.append({"resultId": common["id"], "requestId": request_id, "oracleId": worker, "salt": salt})
    return {"claim": {"id": claim_id, "version": version}, "channel": channel, "oracleRequests": [request],
            "oracleResults": results, "oracleCommitments": commitments, "oracleReveals": reveals,
            "oracleSourceIssuers": issuers, "oracleSourceFeeds": feeds}


def test_exact_v2_dossier(v2_dossier):
    requests, results = verify_oracle(v2_dossier, v2_dossier["claim"], True, [])
    assert len(requests) == 1
    assert len(results) == 2


@pytest.mark.parametrize("section,field,change", [
    ("oracleResults", "factVectorJSON", " {}"),
    ("oracleResults", "decision", "PANEL_REVIEW"),
    ("oracleResults", "workerDiagnosticsHash", "invalid"),
    ("oracleReveals", "salt", "e" * 64),
    ("oracleCommitments", "oracleIdentity", "other-identity"),
    ("oracleRequests", "manifestHash", "f" * 64),
    ("oracleRequests", "assignedOracleIds", ["oracle1", "oracle1", "oracle3"]),
    ("oracleSourceFeeds", "anchoredAt", "2026-11-26T01:00:00Z"),
    ("oracleSourceFeeds", "coverageHash", "f" * 64),
    ("oracleSourceIssuers", "validFrom", "2026-11-26T01:00:00Z"),
])
def test_mutated_v2_dossier_refused(v2_dossier, section, field, change):
    mutated = deepcopy(v2_dossier)
    mutated[section][0][field] = change
    with pytest.raises(ValueError):
        verify_oracle(mutated, mutated["claim"], True, [])
