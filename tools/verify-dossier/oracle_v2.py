"""Canonical Oracle v2 dossier verification."""

import base64
import hashlib
import json
import re
import subprocess
from datetime import datetime


ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
HASH = re.compile(r"[0-9a-f]{64}")
FACTS = {"invoiceIssued", "licenceActiveOnServiceDate", "serviceAccredited", "tariffBand", "receiptConsistent"}
STATES = {"PASS", "CONTRADICTED", "INSUFFICIENT", "UNVERIFIABLE"}
V2_CERTIFICATE_FIELDS = ("manifestHash", "factVectorHash", "decision", "policyVersion")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def canonical(value):
    if type(value) is str:
        value.encode("utf-8")
        return json.dumps(value, ensure_ascii=False).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    if type(value) is int and abs(value) < 2**53:
        return str(value)
    if type(value) is list:
        return "[" + ",".join(map(canonical, value)) + "]"
    if type(value) is dict:
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key]) for key in sorted(value, key=lambda key: key.encode("utf-8"))) + "}"
    raise ValueError("Canonical Oracle evidence needs a string, safe integer, array or record")


def digest(domain, value):
    return hashlib.sha256((domain + "\0" + canonical(value)).encode("utf-8")).hexdigest()


def object_pairs(items):
    value = {}
    for key, item in items:
        require(key not in value, "Duplicate Oracle fact vector key")
        value[key] = item
    return value


def matching(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def parse_vector(encoded):
    require(isinstance(encoded, str) and len(encoded) <= 65536, "Missing or oversized Oracle fact vector")
    vector = json.loads(encoded, object_pairs_hook=object_pairs)
    require(type(vector) is dict and set(vector) == {
        "schema", "claimId", "claimVersion", "manifestHash", "policyVersion", "facts", "tariffBand", "receiptCheck", "modelAdvice",
    } and canonical(vector) == encoded, "Noncanonical Oracle fact vector")
    require(vector["schema"] == "fact-vector-v1" and matching(ID, vector["claimId"]) and
            type(vector["claimVersion"]) is int and vector["claimVersion"] > 0 and matching(HASH, vector["manifestHash"]) and
            vector["policyVersion"] == "diagnostic-v1", "Invalid Oracle fact vector identity")
    require(vector["tariffBand"] in ("BELOW", "IN", "ABOVE", "FAR_ABOVE") and
            vector["receiptCheck"] in ("MATCH", "MISMATCH", "ABSENT") and vector["modelAdvice"] in ("AUTO", "REVIEW"),
            "Invalid Oracle fact classification")
    facts = vector["facts"]
    require(type(facts) is dict and set(facts) <= FACTS | {"paymentOccurred"}, "Unexpected Oracle fact")
    for name, fact in facts.items():
        require(type(fact) is dict and {"status", "evidence"} <= set(fact) <= {"status", "evidence", "integrity"} and
                isinstance(fact["status"], str) and fact["status"] in STATES and type(fact["evidence"]) is list and
                all(matching(ID, value) for value in fact["evidence"]) and fact["evidence"] == sorted(set(fact["evidence"])) and
                (fact["status"] != "PASS" or fact["evidence"]), "Invalid Oracle fact evidence")
        if "integrity" in fact:
            reason, status = fact["integrity"], fact["status"]
            require((reason == "INVALID_SIGNATURE" and status == "UNVERIFIABLE") or
                    (reason == "INACTIVE_LICENCE" and status == "CONTRADICTED" and name == "licenceActiveOnServiceDate") or
                    (reason == "UNACCREDITED_SERVICE" and status == "CONTRADICTED" and name == "serviceAccredited"),
                    "Invalid Oracle fact integrity")
    return vector


def decision(vector):
    facts = vector["facts"]
    if any("integrity" in fact for fact in facts.values()):
        return "INTEGRITY_FAIL"
    if all(facts.get(name, {}).get("status") == "PASS" for name in FACTS) and vector["tariffBand"] in ("BELOW", "IN") and \
            vector["receiptCheck"] == "MATCH" and vector["modelAdvice"] == "AUTO":
        return "AUTO_APPROVE"
    return "PANEL_REVIEW"


def instant(value):
    require(isinstance(value, str) and value.endswith("Z"), "Invalid Oracle checkpoint timestamp")
    return datetime.fromisoformat(value[:-1] + "+00:00")


def signature_bytes(value, length=None):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]+", value) and len(value) <= 256,
            "Invalid Ed25519 input encoding")
    decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    require(base64.urlsafe_b64encode(decoded).decode().rstrip("=") == value and (length is None or len(decoded) == length),
            "Noncanonical Ed25519 input encoding")
    return decoded


def verify_signatures(signatures):
    # Use Node's bundled Ed25519 implementation, with payload on stdin.
    program = """
const fs = require('node:fs');
const {createPublicKey,verify} = require('node:crypto');
const rows = JSON.parse(fs.readFileSync(0,'utf8'));
const binds = ([key,digest,sig]) => {
  const publicKey = createPublicKey({key:Buffer.from(key,'base64url'),format:'der',type:'spki'});
  return publicKey.asymmetricKeyType === 'ed25519' && verify(null,Buffer.from(digest,'hex'),publicKey,Buffer.from(sig,'base64url'));
};
try { process.exitCode = rows.every(binds) ? 0 : 1; } catch { process.exitCode = 1; }
"""
    try:
        result = subprocess.run(["node", "-e", program], input=json.dumps(signatures), encoding="utf-8",
                                capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("Node with Ed25519 support is required to verify Oracle v2 anchors") from error
    require(result.returncode == 0, "Invalid Oracle source anchor signature")


def verify_manifest(dossier, request):
    manifest = request.get("manifest")
    require(type(manifest) is dict and set(manifest) == {"schema", "requestedAt", "pins"} and
            manifest["schema"] == "oracle-v2-source-manifest-v1" and manifest["requestedAt"] == request.get("requestedAt") and
            digest("oracle-v2:manifest", manifest) == request.get("manifestHash") and request.get("policyVersion") == "diagnostic-v1",
            "Oracle request manifest pinning differs")
    pinned = manifest["pins"]
    require(type(pinned) is list and len(pinned) == 3, "Oracle diagnostic manifest requires three sources")
    feeds = dossier.get("oracleSourceFeeds", [])
    issuers = dossier.get("oracleSourceIssuers", [])
    ids, kinds, signatures = [], [], []
    requested = instant(manifest["requestedAt"])
    for pin in pinned:
        require(type(pin) is dict and set(pin) == {"issuerId", "keyVersion", "feedVersion", "root", "effectiveAt", "anchoredAt"} and
                matching(ID, pin["issuerId"]) and all(type(pin[field]) is int and pin[field] > 0 for field in ("keyVersion", "feedVersion")) and
                matching(HASH, pin["root"]) and instant(pin["effectiveAt"]) <= instant(pin["anchoredAt"]) <= requested,
                "Invalid Oracle source checkpoint")
        ids.append(pin["issuerId"])
        keys = [row for row in issuers if row.get("issuerId") == pin["issuerId"] and row.get("keyVersion") == pin["keyVersion"]]
        anchors = [row for row in feeds if row.get("issuerId") == pin["issuerId"] and row.get("feedVersion") == pin["feedVersion"]]
        require(len(keys) == len(anchors) == 1, "Oracle checkpoint requires one issuer and anchor")
        issuer, anchor = keys[0], anchors[0]
        require(all(anchor.get(field) == value for field, value in pin.items()), "Oracle checkpoint differs from anchored feed")
        require(instant(issuer["validFrom"]) <= requested < instant(issuer["validUntil"]) and
                (issuer["status"] == "ACTIVE" or issuer["status"] == "REVOKED" and requested < instant(issuer["revokedAt"])),
                "Oracle issuer was not eligible at request time")
        kinds.append(issuer["kind"])
        body = {field: anchor[field] for field in ("issuerId", "keyVersion", "feedVersion", "root", "effectiveAt", "coverageHash")}
        require(matching(HASH, body["coverageHash"]), "Invalid Oracle coverage hash")
        signature_bytes(issuer["ed25519PublicKey"])
        signature_bytes(anchor["signature"], 64)
        signatures.append([issuer["ed25519PublicKey"], digest("oracle-v2:anchor", body), anchor["signature"]])
    require(ids == sorted(set(ids)) and sorted(kinds) == ["CLAIMANT_RECEIPT", "HOSPITAL_HIS", "REGULATOR"], "Oracle sources are not the diagnostic policy's three authorities")
    verify_signatures(signatures)


def verify_result(dossier, request, result, reveal, commitment):
    require(result.get("protocolVersion") == "v2" and result.get("modelVersion") == request.get("modelVersion") and
            matching(HASH, result.get("workerDiagnosticsHash")), "Invalid Oracle v2 result metadata")
    vector = parse_vector(result.get("factVectorJSON"))
    for field in ("claimId", "claimVersion", "manifestHash", "policyVersion"):
        require(vector[field] == request.get(field), "Oracle fact vector pins differ")
    derived = decision(vector)
    fact_hash = digest("oracle-v2:fact-vector", vector)
    require(derived == result.get("decision") and fact_hash == result.get("resultHash") and
            result.get("verificationCode") == f"V2:{derived}:{fact_hash}" and result.get("verified") is (derived == "AUTO_APPROVE"),
            "Oracle v2 decision or fact vector digest differs")
    require(reveal and reveal.get("requestId") == request["id"] and reveal.get("oracleId") == result["oracleId"] and
            matching(HASH, reveal.get("salt")), "Missing or invalid Oracle v2 reveal input")
    require(isinstance(dossier.get("channel"), str), "Missing v2 commitment channel")
    hash_value = digest("oracle-v2:commit", [
        dossier["channel"], request["id"], request["claimVersion"], result["oracleId"], fact_hash, derived, reveal["salt"],
    ])
    require(commitment.get("commitmentHash") == hash_value, "Oracle v2 subject-bound commitment differs")


def verify_finalization(request, observed, submitted):
    code = request.get("finalizationCode", "")
    require(len(request.get("assignedOracleIds", [])) == request.get("expectedResponses") == 3 and
            request.get("requiredConfirmations") == 2 and matching(ID, request.get("rosterVersion")) and
            len({row["commitmentHash"] for row in submitted.values()}) == len(submitted), "Invalid Oracle v2 roster or duplicate commitment")
    if not code.startswith("V2:"):
        require(request.get("status") != "CONSENSUS" and request.get("decision", "") == "" and
                code in ("", "CONFLICT", "TIMEOUT", "ESCALATED_TIMEOUT", "MODEL_HELD"), "Unknown Oracle v2 finalization")
        return
    final = parse_vector(request.get("factVectorJSON"))
    verdict = decision(final)
    fact_hash = digest("oracle-v2:fact-vector", final)
    require(code == f"V2:{verdict}:{fact_hash}" and request.get("decision") == verdict and
            request.get("resultHash") == request.get("factVectorHash") == fact_hash and
            request.get("status") == ("CONSENSUS" if verdict == "AUTO_APPROVE" else "FAILED"),
            "Oracle v2 finalization digest or route differs")
    require(sum(row["factVectorJSON"] == request["factVectorJSON"] and row["decision"] == verdict
                for row in observed.values()) >= 2, "Oracle v2 exact quorum requires two distinct worker reveals")
