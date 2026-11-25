#!/usr/bin/env python3
"""Verify a Fabric v1 claim dossier and compare it with a separate peer readback."""

import argparse
import hashlib
import hmac
import json
import math
import re
import sys
from decimal import Decimal
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
HEX_256 = re.compile(r"[0-9a-f]{64}")
ORACLE = "block-insure-oracle-v1"
EVIDENCE = "block-insure-evidence-leaf-v1"
READBACK_SECTIONS = (
    "claim", "history", "evidence", "evidenceMerkle", "evidenceAccess", "evidenceGrants",
    "hospitalVerification", "hospitalVerifications", "oracleRequests", "oracleCommitments", "oracleResults",
    "oracleRegistrySnapshots", "oracleReveals", "auditorDecisions", "reviewRounds", "appeals",
    "fraudAssessments", "settlement", "approvalCertificate", "certificateWrite", "auditSampling", "payoutBreakdown",
)


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


def valid_hash(value):
    return isinstance(value, str) and HEX_256.fullmatch(value) is not None


def records(dossier, name):
    values = dossier.get(name, [])
    require(isinstance(values, list) and all(isinstance(value, dict) for value in values), f"Invalid {name}")
    return values


def unique(rows, key, name):
    indexed = {}
    for row in rows:
        identity = row.get(key)
        require(isinstance(identity, str) and identity, f"Missing {name} {key}")
        require(identity not in indexed, f"Duplicate {name} {key}: {identity}")
        indexed[identity] = row
    return indexed


def oracle_result_digest(request, result):
    fields = ("id", "claimId", "queryHash", "claimVersion", "hospitalVerificationId", "appealId", "appealCommitmentHash",
              "registrySnapshotId", "registryVersion", "registryRootHash", "rulesVersion", "rulesHash", "modelVersion",
              "modelHash", "privacyPresentationId", "privacyPresentationHash", "privacyProtocolVersion")
    values = [str(request.get(field, "")) for field in fields]
    values[6] = values[6].lower()
    values.extend(("true" if result["verified"] else "false", result["verificationCode"], result["recordHash"].lower()))
    if request.get("modelReleaseId"):
        values.append(request["modelReleaseId"])
    return canonical_digest(ORACLE + ":result", values)


def oracle_commitment_digest(request, result, salt):
    return canonical_digest(ORACLE + ":commitment", (
        request["id"], str(request["claimVersion"]), str(request["registryVersion"]),
        "true" if result["verified"] else "false", result["resultHash"].lower(), request["modelVersion"],
        request["modelHash"], salt.lower(),
    ))


def verify_oracle(dossier, claim, strict, missing):
    requests = unique(records(dossier, "oracleRequests"), "id", "Oracle request")
    results = unique(records(dossier, "oracleResults"), "id", "Oracle result")
    commitments = unique(records(dossier, "oracleCommitments"), "id", "Oracle commitment")
    reveals = unique(records(dossier, "oracleReveals"), "resultId", "Oracle reveal")
    require(all(result_id in results for result_id in reveals), "Oracle reveal has no result")
    groups = {name: {} for name in requests}
    commitment_groups = {name: {} for name in requests}

    for rows, target, name in ((commitments, commitment_groups, "commitment"), (results, groups, "result")):
        for row in rows.values():
            request = requests.get(row.get("requestId"))
            subject = row.get("oracleId")
            require(request is not None, f"Oracle {name} has no request")
            require(row.get("claimId") == claim["id"] == request.get("claimId") and
                    row.get("claimVersion") == request.get("claimVersion"), f"Oracle {name} claim version differs")
            require(isinstance(subject, str) and subject in request.get("assignedOracleIds", []),
                    f"Oracle {name} is from an unassigned subject")
            require(row["id"] == f"{request['id']}:{subject}", f"Oracle {name} ID differs from its subject")
            group = target[request["id"]]
            require(subject not in group, f"Duplicate Oracle {name} subject")
            group[subject] = row

    for result_id, result in results.items():
        request = requests[result["requestId"]]
        subject = result["oracleId"]
        require(type(result.get("verified")) is bool and isinstance(result.get("verificationCode"), str) and
                valid_hash(result.get("recordHash")) and valid_hash(result.get("resultHash")), "Invalid Oracle result")
        require(result.get("registryVersion") == request.get("registryVersion") and
                result.get("modelVersion") == request.get("modelVersion") and
                result.get("privacyPresentationId", "") == request.get("privacyPresentationId", "") and
                result.get("privacyPresentationHash", "") == request.get("privacyPresentationHash", ""),
                "Oracle result pinned inputs differ")
        require(oracle_result_digest(request, result) == result["resultHash"], "Oracle result digest mismatch")
        commitment = commitment_groups[request["id"]].get(subject)
        require(commitment is not None, "Missing commitment for revealed Oracle result")
        require(commitment.get("oracleIdentity") == result.get("oracleIdentity"), "Oracle commitment identity differs")
        reveal = reveals.get(result_id)
        if reveal:
            require(reveal.get("requestId") == request["id"] and reveal.get("oracleId") == subject and
                    valid_hash(reveal.get("salt")), "Invalid Oracle reveal input")
            require(oracle_commitment_digest(request, result, reveal["salt"]) == commitment.get("commitmentHash"),
                    "Oracle commitment digest mismatch")
        else:
            require(not strict, "Missing committed reveal input for Oracle result")
            missing.append(f"Oracle reveal input:{result_id}")

    for request in requests.values():
        assigned = request.get("assignedOracleIds", [])
        require(request.get("claimId") == claim["id"] and type(request.get("claimVersion")) is int and
                0 < request["claimVersion"] <= claim["version"], "Oracle request claim version differs")
        require(isinstance(assigned, list) and all(isinstance(subject, str) and subject for subject in assigned) and
                len(assigned) == len(set(assigned)), "Invalid Oracle assignments")
        if strict:
            require(len(assigned) == request.get("expectedResponses") == 3 and request.get("requiredConfirmations") == 2,
                    "Medical Oracle roster or threshold differs")
        observed = groups[request["id"]]
        submitted = commitment_groups[request["id"]]
        require(all(valid_hash(row.get("commitmentHash")) for row in submitted.values()), "Invalid Oracle commitment hash")
        require(len(submitted) == request.get("commitmentCount") and len(observed) == request.get("revealCount"),
                "Oracle request record counts differ")
        for subject in submitted.keys() - observed.keys():
            missing.append(f"Oracle commitment unopened:{request['id']}:{subject}")
        finalization = request.get("finalizationCode")
        if finalization in {"EXACT_CONSENSUS", "NEGATIVE_RESULT"} or request.get("status") == "CONSENSUS":
            verified = finalization == "EXACT_CONSENSUS"
            threshold = request.get("requiredConfirmations")
            require(request.get("status") == ("CONSENSUS" if verified else "FAILED") and
                    request.get("verifiedResult") is verified and type(threshold) is int and
                    2 <= threshold <= len(assigned), "Invalid Oracle finalization")
            agreeing = sum(result["resultHash"] == request.get("resultHash") and result["verified"] is verified
                           for result in observed.values())
            require(agreeing >= threshold, "Oracle quorum requires distinct assigned subjects with the same result")
    return requests, results


def verify_panel(dossier, claim, certificate):
    rounds = unique(records(dossier, "reviewRounds"), "id", "review")
    decisions = unique(records(dossier, "auditorDecisions"), "id", "auditor decision")
    votes = {key: {} for key in rounds}
    for decision in decisions.values():
        review = rounds.get(decision.get("reviewId"))
        require(review is not None, "Auditor decision has no review round")
        require(decision.get("reviewRound") == review.get("round"), "Decision round differs from the review")
        require(decision.get("claimId") == claim["id"] == review.get("claimId"), "Auditor decision claim differs")
        require(review.get("status") not in {"OPEN", "PREPARING"}, "Open review contains disclosed votes")
        auditor = decision.get("auditorId")
        require(auditor in review.get("assignedAuditorIds", []), "Unassigned auditor decision")
        require(auditor not in votes[review["id"]], "Duplicate auditor counted in one round")
        require(decision.get("outcome") in {"APPROVE", "REJECT"}, "Invalid auditor outcome")
        votes[review["id"]][auditor] = decision["outcome"]

    for review in rounds.values():
        outcome = review.get("status")
        require(review.get("claimId") == claim["id"], "Review round claim differs")
        if outcome in {"OPEN", "PREPARING"}:
            continue
        approvals = list(votes[review["id"]].values()).count("APPROVE")
        rejections = list(votes[review["id"]].values()).count("REJECT")
        require((approvals, rejections, approvals + rejections) ==
                (review.get("approvals"), review.get("rejections"), review.get("votesCast")), "Panel tally differs from decisions")
        if review.get("medicalVersion"):
            assigned = review.get("assignedAuditorIds")
            require(isinstance(assigned, list) and len(set(assigned)) == len(assigned) == 4 and
                    review.get("approvalThreshold") == 3 and review.get("rejectionThreshold") == 2,
                    "Medical panel roster or thresholds differ")
        if outcome in {"APPROVED", "REJECTED"}:
            count, field = (approvals, "approvalThreshold") if outcome == "APPROVED" else (rejections, "rejectionThreshold")
            threshold = review.get(field)
            require(type(threshold) is int and threshold > 0 and count >= threshold, "Finalized panel threshold is unmet")

    if certificate and certificate["path"] == "PANEL":
        final = rounds.get(certificate["reviewId"])
        require(final is not None and final.get("status") == "APPROVED", "Missing finalized certificate review")
        require(final.get("medicalVersion") == certificate["claimVersion"], "Panel claim version differs from certificate")
        require(final.get("closedAt") == certificate["approvedAt"], "Panel finalization time differs from certificate")
        decision = decisions.get(certificate["decisionId"])
        require(decision and decision.get("reviewId") == final["id"] and decision.get("outcome") == "APPROVE",
                "Certificate approval decision differs")
    if claim.get("status") == "REJECTED":
        final = rounds.get(claim.get("currentReviewId"))
        require(final and final.get("status") in {"REJECTED", "TIMED_OUT", "ACCESS_FAILED"} and
                final.get("medicalVersion") == claim["version"], "Missing finalized rejection or procedure outcome")
        if final["status"] == "REJECTED":
            decision = decisions.get(claim.get("auditorDecisionId"))
            require(decision and decision.get("reviewId") == final["id"] and decision.get("outcome") == "REJECT",
                    "Final rejection decision differs")
    return decisions


def verify_merkle(dossier, claim, missing):
    evidence = unique(records(dossier, "evidence"), "id", "evidence")
    proven = set()
    require(all(row.get("claimId") == claim["id"] for row in evidence.values()), "Evidence claim differs")
    batches = set()
    for entry in records(dossier, "evidenceMerkle"):
        batch = entry.get("batch")
        require(isinstance(batch, dict) and batch.get("hashAlgorithm") == "SHA-256" and batch.get("leafEncoding") == EVIDENCE,
                "Invalid evidence batch algorithm")
        require(isinstance(batch.get("id"), str) and batch["id"] not in batches, "Duplicate or missing evidence batch ID")
        batches.add(batch["id"])
        ids = batch.get("evidenceIds")
        require(isinstance(ids, list) and all(isinstance(value, str) for value in ids) and ids and
                len(ids) == len(set(ids)) == batch.get("leafCount") and valid_hash(batch.get("rootHash")), "Invalid evidence batch")
        proofs = unique(records(entry, "proofs"), "evidenceId", "evidence Merkle proof")
        require(proofs.keys() == evidence.keys() & set(ids), "Missing evidence Merkle proof from a supplied batch")
        for evidence_id, proof in proofs.items():
            item = evidence[evidence_id]
            require(valid_hash(item.get("contentHash")) and valid_hash(item.get("storageReferenceHash")) and
                    isinstance(item.get("documentType"), str) and type(item.get("claimVersion")) is int, "Invalid evidence leaf fields")
            root = canonical_digest(EVIDENCE, (evidence_id, claim["id"], str(item["claimVersion"]),
                                    item["documentType"], item["contentHash"].lower(), item["storageReferenceHash"].lower()))
            require(root == proof.get("leafHash"), "Evidence leaf hash mismatch")
            steps = records(proof, "proof")
            index, size = ids.index(evidence_id), len(ids)
            require(len(steps) == (size - 1).bit_length(), "Broken evidence Merkle proof depth")
            for step in steps:
                sibling = step.get("hash")
                position = "LEFT" if index % 2 else "RIGHT"
                require(valid_hash(sibling) and step.get("position") == position and
                        (index != size - 1 or not size % 2 or sibling == root), "Broken evidence Merkle proof step")
                left, right = (sibling, root) if position == "LEFT" else (root, sibling)
                root = hashlib.sha256(b"\x01" + bytes.fromhex(left + right)).hexdigest()
                index //= 2
                size = (size + 1) // 2
            require(root == batch["rootHash"], "Broken evidence Merkle proof root")
            proven.add(evidence_id)
    missing.extend(f"Evidence batch proof:{evidence_id}" for evidence_id in evidence.keys() - proven)


def verify_certificate(claim, certificate, settlement, expected_hash):
    require(isinstance(certificate, dict), "Dossier requires an approval certificate")
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
    require(bool(claim_id) and claim.get("id") == claim_id, "Claim ID differs across records")
    require(type(claim.get("version")) is int and claim["version"] == claim_version, "Certificate is stale for the claim version")
    record_id = canonical_digest("fabric-medical-episode-revision-v1", (claim_id, str(claim_version)))
    require(certificate["id"] == record_id, "Certificate ID does not match the claim version")
    require(claim.get("episodeRevision") == certificate["episodeRevision"], "Episode revision differs")
    require(claim.get("descriptionHash") == certificate["statementHash"], "Accepted statement hash differs")
    require(type(claim.get("amountMinor")) is int and claim["amountMinor"] == certificate["amountMinor"], "Amounts differ across records")
    require(certificate["currency"] == "BDT", "Currency differs across records")
    if settlement is not None:
        require(isinstance(settlement, dict) and settlement.get("claimId") == claim_id, "Claim ID differs across records")
        require(type(settlement.get("amountMinor")) is int and settlement["amountMinor"] == certificate["amountMinor"],
                "Amounts differ across records")
        require(settlement.get("currency") == "BDT", "Currency differs across records")
        require(bool(settlement.get("id")) and claim.get("medicalSettlementId") == settlement["id"], "Current settlement ID differs")
        require(settlement.get("approvalCertificateHash") == derived, "Settlement certificate link differs")
    require(certificate["path"] in {"PANEL", "ORACLE_AUTO"}, "Unknown approval path")
    return derived, version


def verify_payout(dossier, certificate, strict, missing):
    if not certificate or not certificate.get("breakdownHash"):
        return
    payout = dossier.get("payoutBreakdown")
    if payout is None:
        require(not strict, "Missing certificate payout breakdown")
        missing.append("payoutBreakdown")
        return
    require(isinstance(payout, dict) and isinstance(payout.get("inputs"), dict) and
            isinstance(payout.get("values"), dict), "Invalid payout breakdown")
    inputs, values = payout["inputs"], payout["values"]
    fields = ("billedMinor", "serviceSublimitMinor", "deductibleBps", "deductibleCapMinor",
              "insurerShareBps", "coverageLimitMinor", "remainingCoverMinor")
    require(all(type(inputs.get(field)) is int and 0 <= inputs[field] < 2**63 for field in fields),
            "Invalid payout breakdown inputs")
    bill, sublimit, deductible_bps, cap, share_bps, limit, remaining = (inputs[field] for field in fields)
    require(remaining <= limit and deductible_bps <= 10_000 and share_bps <= 10_000, "Invalid coverage or payout rate")
    eligible = min(bill, sublimit)
    deductible = min(eligible * deductible_bps // 10_000, cap)
    share = (eligible - deductible) * share_bps // 10_000
    payable = min(remaining, share)
    require(values == {"eligibleMinor": eligible, "deductibleMinor": deductible, "insurerShareMinor": share,
                       "payableMinor": payable}, "Payout arithmetic differs from the breakdown")
    require(payable == certificate["amountMinor"], "Payout amount differs from the certificate")
    require(inputs.get("packageId") == certificate["packageId"] and inputs.get("rulesVersion") == certificate["rulesVersion"] and
            inputs.get("termsHash") == certificate["termsHash"], "Payout terms differ from the certificate")
    statement_version, statement_hash = payout.get("statementVersion"), payout.get("statementHash")
    require(valid_hash(statement_hash) and type(statement_version) is int and 0 < statement_version <= certificate["claimVersion"],
            "Invalid payout statement identity")
    if statement_version == certificate["claimVersion"]:
        claim = dossier.get("claim", {})
        plain = canonical_digest("fabric-medical-statement-v1", (
            str(claim.get("policyId", "")), certificate["termsHash"], certificate["episodeRevisionHash"],
            str(certificate["episodeRevision"]), str(payable), str(remaining),
        ))
        require(statement_hash in {certificate["statementHash"], plain}, "Payout statement differs from the certificate")
    else:
        require(any(isinstance(row.get("value"), dict) and row["value"].get("version") == statement_version and
                    row["value"].get("descriptionHash") == statement_hash for row in records(dossier, "history")),
                "Payout statement is absent from claim history")
    digest = canonical_digest("fabric-medical-breakdown-v1", (payout["statementHash"], *map(
        str, (bill, sublimit, eligible, cap, deductible, share_bps, share, limit, remaining, payable))))
    require(digest == payout.get("breakdownHash") == certificate["breakdownHash"], "Payout breakdown hash mismatch")


def verify_sampling(dossier, requests, strict, missing):
    rows = unique(records(dossier, "auditSampling"), "requestId", "audit sampling")
    for request in requests.values():
        period_id = request.get("auditPeriodId")
        row = rows.get(request["id"])
        require(not row or period_id, "Unexpected audit sampling entry")
        if not period_id:
            continue
        if not row:
            require(not strict, "Missing pinned audit sampling period")
            missing.append(f"auditSampling:{request['id']}")
            continue
        period, selection = row.get("period"), row.get("selection")
        require(isinstance(period, dict) and period.get("id") == period_id and
                valid_hash(period.get("commitment")), "Audit sampling period differs")
        seed = period.get("seed")
        if seed:
            require(valid_hash(seed) and canonical_digest("fabric-medical-audit-seed-v1", (period_id, seed)) == period["commitment"],
                    "Audit seed commitment mismatch")
        if not selection:
            missing.append(f"Audit selection unavailable:{request['id']}")
            continue
        rate = period.get("rateBps")
        require(isinstance(selection, dict) and seed and type(rate) is int and 0 < rate <= 10_000 and
                valid_hash(request.get("resultHash")), "Invalid audit selection inputs")
        digest = canonical_digest("fabric-medical-audit-selection-v1", (
            seed, request["claimId"], str(request["claimVersion"]), request["resultHash"],
        ))
        expected = {"periodId": period_id, "claimId": request["claimId"], "version": request["claimVersion"],
                    "resultHash": request["resultHash"], "digest": digest, "rateBps": rate,
                    "selected": int(digest[:8], 16) * 10_000 < rate * 2**32}
        require(selection == expected, "Audit selection proof differs")
    require(rows.keys() <= requests.keys(), "Audit sampling has no Oracle request")


def js_canonical(value):
    if isinstance(value, dict):
        pairs = sorted(value.items(), key=lambda pair: pair[0].encode("utf-16-be", errors="surrogatepass"))
        return "{" + ",".join(f"{js_canonical(key)}:{js_canonical(item)}" for key, item in pairs) + "}"
    if isinstance(value, list):
        return "[" + ",".join(map(js_canonical, value)) + "]"
    if type(value) in (float, int):
        require(math.isfinite(value), "Non-finite explanation value")
        if not value:
            return "0"
        number = Decimal(repr(value)).normalize()
        if -6 <= number.adjusted() < 21:
            return format(number, "f")
        coefficient, exponent = format(number, "e").split("e")
        return f"{coefficient}e{int(exponent):+d}"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def verify_receipts(dossier, requests, results, decisions):
    seen = set()
    for receipt in records(dossier, "explanationReceipts"):
        subject = (receipt.get("requestId"), receipt.get("oracleId"))
        require(all(isinstance(value, str) for value in subject) and subject not in seen, "Duplicate or invalid explanation receipt")
        seen.add(subject)
        request = requests.get(subject[0])
        result = next((row for row in results.values() if (row["requestId"], row["oracleId"]) == subject), None)
        require(request and result and receipt.get("schema") == "explanation-receipt-v1" and
                valid_hash(receipt.get("contextHash")) and receipt.get("evaluatorHash") == request.get("modelHash") and
                isinstance(receipt.get("assessment"), dict) and "salt" not in receipt, "Invalid explanation receipt")
        document = {key: receipt[key] for key in ("contextHash", "evaluatorHash", "assessment")}
        digest = hashlib.sha256(js_canonical(document).encode()).hexdigest()
        require(result["verificationCode"] in {"XGB_AUTO:" + digest.upper(), "XGB_REVIEW:" + digest.upper()},
                "Explanation receipt hash mismatch")
    for receipt in unique(records(dossier, "reasonReceipts"), "decisionId", "reason receipt").values():
        decision = decisions.get(receipt["decisionId"])
        require(decision and isinstance(receipt.get("text"), str), "Invalid reason receipt")
        digest = hashlib.sha256(receipt["text"].encode()).hexdigest()
        if decision.get("reasonCode"):
            digest = canonical_digest("medical-reason-v1", (decision["reasonCode"], digest))
        require(digest == decision.get("reasonHash"), "Reason receipt hash mismatch")


def verify(dossier, expected_hash=None, readback=None, require_readback=False):
    require(isinstance(dossier, dict), "Expected a dossier object")
    claim, certificate, settlement = (dossier.get(key) for key in ("claim", "approvalCertificate", "settlement"))
    require(isinstance(claim, dict) and isinstance(claim.get("id"), str) and claim["id"] and
            type(claim.get("version")) is int and claim["version"] > 0, "Dossier requires a valid claim")
    strict = dossier.get("schemaVersion", 0) == 7
    missing = [section for section in READBACK_SECTIONS if section not in dossier]
    require(not strict or not missing, "Missing dossier sections: " + ", ".join(missing))
    status = claim.get("status")
    digest = version = None
    if status == "REJECTED":
        require(certificate is None and settlement is None and expected_hash is None, "Rejected claim contains an approval or payout")
    else:
        require(status in {"SETTLED", "SETTLEMENT_AUTHORIZED", "APPROVED"}, "Unsupported claim dossier outcome")
        digest, version = verify_certificate(claim, certificate, settlement, expected_hash)
        if status == "SETTLED":
            require(settlement and settlement.get("status") == "CONFIRMED" and settlement.get("transferId"),
                    "Dossier does not describe a confirmed payout")
        elif status == "SETTLEMENT_AUTHORIZED":
            require(settlement and settlement.get("status") == "AUTHORIZED", "Dossier does not describe an authorized payout")
        else:
            require(settlement is None, "Approved claim unexpectedly includes a settlement")

    requests, results = verify_oracle(dossier, claim, strict, missing)
    decisions = {}
    if strict or "reviewRounds" in dossier or "auditorDecisions" in dossier or status == "REJECTED":
        decisions = verify_panel(dossier, claim, certificate)
    if certificate and (strict or (requests and certificate["path"] == "ORACLE_AUTO")):
        oracle_id = certificate["oracleRequestId"]
        if oracle_id:
            request = requests.get(oracle_id)
            require(request and request.get("claimVersion") == claim["version"] and
                    all(request.get(field, "") == certificate[cert_field] for field, cert_field in
                        (("resultHash", "oracleResultHash"), ("modelHash", "modelHash"),
                         ("registrySnapshotId", "registrySnapshotId"), ("registryRootHash", "registryRootHash"))),
                    "Oracle request differs from the certificate")
            if certificate["path"] == "ORACLE_AUTO":
                require(request.get("finalizationCode") == certificate["oracleOutcome"] == "EXACT_CONSENSUS" and
                        request.get("finalizedAt") == certificate["approvedAt"], "Oracle approval finalization differs from the certificate")
        else:
            require(certificate["path"] == "PANEL", "Oracle approval is missing its Oracle request")
    if strict and certificate:
        write = dossier.get("certificateWrite")
        require(isinstance(write, dict) and isinstance(write.get("transactionId"), str) and
                isinstance(write.get("issuedAt"), str) and type(write.get("blockNumber")) is int and
                write["blockNumber"] > 0 and valid_hash(write.get("blockHash")), "Missing certificate write transaction")
    verify_payout(dossier, certificate, strict, missing)
    verify_sampling(dossier, requests, strict, missing)
    verify_merkle(dossier, claim, missing)
    verify_receipts(dossier, requests, results, decisions)

    require(readback is not None or not require_readback, "Peer readback is required")
    if readback is not None:
        require(isinstance(readback, dict) and readback.get("schema") == "dossier-peer-readback-v1" and
                isinstance(readback.get("channel"), str) and bool(readback["channel"]) and
                isinstance(readback.get("chaincode"), str) and bool(readback["chaincode"]) and
                type(readback.get("blockHeight")) is int and readback["blockHeight"] > 0 and
                valid_hash(readback.get("blockHash")), "Invalid peer readback metadata")
        require(dossier.get("channel") == readback["channel"] and dossier.get("chaincode") == readback["chaincode"],
                "Dossier and readback channel or chaincode differs")
        sections = readback.get("sections")
        require(isinstance(sections, dict), "Peer readback has no sections")
        for section in READBACK_SECTIONS:
            require(section in sections and section in dossier, f"Missing peer readback section: {section}")
            require(sections[section] == dossier[section], f"Peer readback differs: {section}")
    return {"claimId": claim["id"], "claimVersion": claim["version"], "claimStatus": status,
            "settlementId": settlement["id"] if settlement else None, "certificateHash": digest, "certificateVersion": version,
            "verification": "ANCHORED TO SUPPLIED PEER READBACK" if readback else "INTERNALLY CONSISTENT — NOT ANCHORED",
            "anchor": "peer readback" if readback else "caller-supplied hash" if expected_hash else "dossier consistency only",
            "missingSections": sorted(set(missing))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dossier", type=Path, help="JSON exported from the Claim dossier view")
    parser.add_argument("--expected-certificate-hash", help="Certificate digest obtained independently from the ledger")
    parser.add_argument("--readback", type=Path, help="JSON from a separate trusted peer readback")
    parser.add_argument("--require-readback", action="store_true", help="Fail when no peer readback is supplied")
    args = parser.parse_args()
    try:
        if args.expected_certificate_hash is not None and not re.fullmatch(r"[0-9a-f]{64}", args.expected_certificate_hash):
            raise ValueError("Expected certificate hash must contain 64 lowercase hexadecimal digits")
        readback = json.loads(args.readback.read_text(encoding="utf-8-sig")) if args.readback else None
        result = verify(json.loads(args.dossier.read_text(encoding="utf-8-sig")), args.expected_certificate_hash,
                        readback=readback, require_readback=args.require_readback)
    except (OSError, ValueError, TypeError, AttributeError, KeyError, OverflowError) as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        return 1
    print(result["verification"])
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
