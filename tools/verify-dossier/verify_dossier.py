#!/usr/bin/env python3
"""Verify the approval certificate and settlement links in an exported dossier."""

import argparse
import hashlib
import hmac
import json
import re
import sys
from pathlib import Path


FIELDS = (
    "id", "activationTransactionId", "claimId", "claimVersion", "episodeRevision",
    "episodeRevisionHash", "associationVersion", "statementHash", "amountMinor",
    "currency", "path", "oracleRequestId", "oracleResultHash", "oracleOutcome",
    "registrySnapshotId", "registryRootHash", "modelHash", "reviewId", "decisionId",
    "escalatedAt", "duplicateReview", "approvedAt",
)
TERMS = ("packageId", "rulesVersion", "termsHash", "breakdownHash")
INT_FIELDS = {"claimVersion", "episodeRevision", "associationVersion", "amountMinor", "rulesVersion", "duplicateRuleVersion"}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def canonical_digest(domain, values):
    payload = bytearray(domain.encode("ascii"))
    for value in values:
        encoded = value.encode("utf-8")
        payload.extend(f"|{len(encoded)}:".encode("ascii"))
        payload.extend(encoded)
    return hashlib.sha256(payload).hexdigest()


def encoded_field(record, name):
    value = record.get(name)
    if name in INT_FIELDS:
        require(type(value) is int and 0 < value < 2**63, f"Invalid certificate {name}")
        return str(value)
    if name == "duplicateReview":
        require(type(value) is bool, "Invalid certificate duplicateReview")
        return "true" if value else "false"
    require(type(value) is str, f"Missing or invalid certificate {name}")
    return value


def verify(dossier, expected_hash=None):
    require(isinstance(dossier, dict), "Expected a dossier object")
    claim, certificate, settlement = (dossier.get(key) for key in ("claim", "approvalCertificate", "settlement"))
    require(all(isinstance(part, dict) for part in (claim, certificate, settlement)), "Dossier requires claim, approval certificate, and settlement")
    fields = FIELDS + TERMS if any(field in certificate for field in TERMS) else FIELDS
    version = 2 if fields[-1] == "breakdownHash" else 1
    canonical = [encoded_field(certificate, field) for field in fields]
    if version == 2:
        require(bool(certificate["packageId"]), "Missing certificate package ID")
        for field in ("termsHash", "breakdownHash"):
            require(re.fullmatch(r"[0-9a-f]{64}", certificate[field]), f"Invalid certificate {field}")
    observed = certificate.get("hash")
    require(isinstance(observed, str) and re.fullmatch(r"[0-9a-f]{64}", observed), "Invalid certificate hash")
    domain = f"fabric-medical-approval-v{version}"
    if "duplicateRuleVersion" in certificate:
        domain += ":duplicate-rule"
        canonical.append(encoded_field(certificate, "duplicateRuleVersion"))
        require(certificate["duplicateRuleVersion"] in (1, 2), "Unknown duplicate rule version")
    derived = canonical_digest(domain, canonical)
    require(hmac.compare_digest(derived, observed), "Certificate hash mismatch")
    if expected_hash is not None:
        require(hmac.compare_digest(derived, expected_hash), "Certificate does not match the supplied ledger hash")

    claim_id, claim_version = certificate["claimId"], certificate["claimVersion"]
    require(bool(claim_id) and claim.get("id") == settlement.get("claimId") == claim_id, "Claim ID differs across records")
    require(type(claim.get("version")) is int and claim["version"] == claim_version, "Certificate is stale for the claim version")
    record_id = canonical_digest("fabric-medical-episode-revision-v1", (claim_id, str(claim_version)))
    require(certificate["id"] == record_id, "Certificate ID does not match the claim version")
    require(claim.get("episodeRevision") == certificate["episodeRevision"], "Episode revision differs")
    require(claim.get("descriptionHash") == certificate["statementHash"], "Accepted statement hash differs")
    require(type(claim.get("amountMinor")) is int and type(settlement.get("amountMinor")) is int and
            claim["amountMinor"] == certificate["amountMinor"] == settlement["amountMinor"], "Amounts differ across records")
    require(certificate["currency"] == settlement.get("currency") == "BDT", "Currency differs across records")
    require(bool(settlement.get("id")) and claim.get("medicalSettlementId") == settlement["id"], "Current settlement ID differs")
    require(settlement.get("approvalCertificateHash") == derived, "Settlement certificate link differs")
    require(certificate["path"] in {"PANEL", "ORACLE_AUTO"}, "Unknown approval path")
    require(claim.get("status") == "SETTLED" and settlement.get("status") == "CONFIRMED" and bool(settlement.get("transferId")),
            "Dossier does not describe a confirmed payout")
    return {"claimId": claim_id, "claimVersion": claim_version, "settlementId": settlement["id"],
            "certificateHash": derived, "certificateVersion": version,
            "anchor": "caller-supplied hash" if expected_hash else "dossier consistency only"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dossier", type=Path, help="JSON exported from the Claim dossier view")
    parser.add_argument("--expected-certificate-hash", help="Certificate digest obtained independently from the ledger")
    args = parser.parse_args()
    try:
        if args.expected_certificate_hash is not None and not re.fullmatch(r"[0-9a-f]{64}", args.expected_certificate_hash):
            raise ValueError("Expected certificate hash must contain 64 lowercase hexadecimal digits")
        result = verify(json.loads(args.dossier.read_text(encoding="utf-8-sig")), args.expected_certificate_hash)
    except (OSError, ValueError) as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
