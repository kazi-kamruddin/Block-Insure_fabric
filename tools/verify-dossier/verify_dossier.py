#!/usr/bin/env python3
"""Verify a Fabric claim dossier and compare it with a separate peer readback."""

import argparse
import hashlib
import hmac
import json
import math
import re
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
import oracle_v2


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
R2_SECTIONS = ("panelVoteCommitments", "auditorRosters", "revisionProof")
TIMING_WINDOWS = {"REAL": (60, 120), "DEMO": (15, 30)}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def canonical_bytes(domain, values):
    payload = bytearray(domain.encode("ascii"))
    for value in values:
        encoded = value.encode("utf-8")
        payload.extend(f"|{len(encoded)}:".encode("ascii"))
        payload.extend(encoded)
    return payload


def canonical_digest(domain, values):
    return hashlib.sha256(canonical_bytes(domain, values)).hexdigest()


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
        if request.get("protocolVersion") == "v2":
            commitment = commitment_groups[request["id"]].get(subject)
            require(commitment is not None and commitment.get("oracleIdentity") == result.get("oracleIdentity"),
                    "Missing or different v2 Oracle commitment identity")
            oracle_v2.verify_result(dossier, request, result, reveals.get(result_id), commitment)
            continue
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
        if request.get("protocolVersion") == "v2":
            oracle_v2.verify_manifest(dossier, request)
            oracle_v2.verify_finalization(request, observed, submitted)
            continue
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


def time_value(value, label):
    require(isinstance(value, str) and "T" in value, f"Missing {label} timestamp")
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(stamp.tzinfo is not None, f"Invalid {label} timestamp")
    return stamp


def timing_profile(record):
    if record is None or "timingProfile" not in record:
        return None
    value = record["timingProfile"]
    require(isinstance(value, str) and value in TIMING_WINDOWS, "Invalid timing profile")
    return value


def verify_timing_profile(dossier, claim, certificate, requests):
    reviews = {review["id"]: review for review in records(dossier, "reviewRounds")}
    for record in [dossier, certificate, *requests.values(), *reviews.values()]:
        require(timing_profile(record) != "DEMO" or dossier.get("channel") == "insurance-dev-lite-190",
                "DEMO timing is restricted to dev-lite")
    for request in requests.values():
        profile = timing_profile(request)
        if not profile:
            continue
        require(request.get("protocolVersion") == "v2", "Only Oracle v2 requests carry a timing profile")
        commit_wait, reveal_wait = TIMING_WINDOWS[profile]
        requested = time_value(request.get("requestedAt"), "Oracle request")
        commit = time_value(request.get("commitDeadline"), "Oracle commit deadline")
        reveal = time_value(request.get("revealDeadline"), "Oracle reveal deadline")
        require(commit - requested == timedelta(seconds=commit_wait), "Oracle commit window differs from its timing profile")
        require(reveal - commit == timedelta(seconds=reveal_wait), "Oracle reveal window differs from its timing profile")
    certificate_profile = timing_profile(certificate)
    if certificate_profile:
        require(certificate.get("certificateVersion") == 3, "Only version 3 certificates carry a timing profile")
        source = (reviews.get(certificate.get("reviewId")) if certificate.get("path") == "PANEL"
                  else requests.get(certificate.get("oracleRequestId")))
        require(source is not None and certificate_profile == (timing_profile(source) or "REAL"),
                "Certificate timing profile differs from its source")
    current_review = reviews.get(claim.get("currentReviewId"))
    current_request = requests.get(claim.get("currentOracleRequestId"))
    if current_review and current_review.get("medicalVersion") != claim["version"]:
        current_review = None
    if current_request and current_request.get("claimVersion") != claim["version"]:
        current_request = None
    current = certificate_profile or timing_profile(current_review) or timing_profile(current_request)
    require(timing_profile(dossier) == current, "The dossier timing profile differs from its current ledger record")


def draw_panel(review, subjects):
    seed = canonical_digest("medical-panel-draw-v1", (review["claimId"], str(review["medicalVersion"]), str(review["round"])))
    return sorted(subjects, key=lambda subject: (canonical_digest("medical-panel-seat-v1", (seed, subject)), subject))


def verify_sealed_panels(dossier, decisions):
    reviews = unique(records(dossier, "reviewRounds"), "id", "review")
    rosters = unique(records(dossier, "auditorRosters"), "version", "auditor roster")
    appeals = unique(records(dossier, "appeals"), "id", "appeal")
    commitments = {}
    for record in records(dossier, "panelVoteCommitments"):
        review_id, auditor = record.get("reviewId"), record.get("auditorId")
        require((review_id, auditor) not in commitments and valid_hash(record.get("commitment")), "Duplicate or invalid panel commitment")
        review = reviews.get(review_id)
        require(review and review.get("ballotVersion") == "panel-vote-v1" and auditor in review["assignedAuditorIds"] and
                record.get("round") == review["round"] and record.get("claimVersion") == review["medicalVersion"],
                "Panel commitment belongs to another seat, round or version")
        require(time_value(review["openedAt"], "opening") <= time_value(record["committedAt"], "commitment") <
                time_value(review["commitDeadline"], "commit deadline"), "Commitment is outside its window")
        commitments[review_id, auditor] = record
    votes = {(vote["reviewId"], vote["auditorId"]): vote for vote in decisions.values()}
    for review in reviews.values():
        if review.get("ballotVersion") != "panel-vote-v1":
            continue
        roster = rosters.get(review.get("rosterVersion"))
        require(roster and set(roster.get("approvedMsps", [])) == {"InsurerMSP", "AuditorMSP", "OracleMSP"}, "Missing approved roster for sealed review")
        subjects = roster.get("subjects", [])
        require(isinstance(subjects, list) and all(isinstance(subject, str) for subject in subjects) and
                len(subjects) == len(set(subjects)) == 6, "Sealed review roster must have six distinct subjects")
        prior_id = review.get("standbyForReviewId")
        if not prior_id and review.get("appealId"):
            prior_id = appeals.get(review["appealId"], {}).get("medicalPriorReviewId")
            require(prior_id, "Appeal lacks its original panel")
        if prior_id:
            prior = reviews.get(prior_id)
            require(prior and prior["round"] < review["round"], "Mixed panel lacks its original round")
            if review.get("standbyForReviewId"):
                require(prior["status"] == "PROCEDURAL_FAILURE", "Standby round did not follow a procedural failure")
            originals = set(prior["assignedAuditorIds"])
            require(len(originals) == 4 and originals <= set(subjects), "Original panel differs from the six-subject roster")
            panel = draw_panel(review, set(subjects) - originals) + draw_panel(review, originals)[:2]
        else:
            panel = draw_panel(review, subjects)[:4]
        standby = draw_panel(review, set(subjects) - set(panel))
        replacements = review.get("replacements", [])
        prepare_end = time_value(review["initialPrepareBy"], "initial preparation")
        replaced = set()
        for index, replacement in enumerate(replacements):
            absent, new = replacement.get("absentAuditorId"), replacement.get("newAuditorId")
            when = time_value(replacement["replacedAt"], "replacement")
            require(absent in panel and absent not in replaced and standby and new == standby[0] and when >= prepare_end,
                    "Invalid standby replacement")
            if review.get("openedAt"):
                require(when <= time_value(review["openedAt"], "opening"), "Replacement followed the opening of voting")
            panel[panel.index(absent)] = standby.pop(0)
            replaced.add(new)
            if index == 0:
                seconds = 30 if review.get("timingProfile") == "DEMO" else 300
                prepare_end = when + timedelta(seconds=seconds)
        require(review["assignedAuditorIds"] == panel and review.get("standbyAuditorIds", []) == standby and
                time_value(review["prepareBy"], "preparation") == prepare_end, "Panel assignments or preparation extension differ")
        records_in_round = [record for (round_id, _), record in commitments.items() if round_id == review["id"]]
        require(review.get("commitmentsCast", 0) == len(records_in_round), "Panel commitment tally differs")
        for auditor in panel:
            record = commitments.get((review["id"], auditor))
            vote = votes.get((review["id"], auditor))
            if not vote:
                continue
            require(record and vote.get("ballotVersion") == "panel-vote-v1" and valid_hash(vote.get("ballotSalt")) and
                    valid_hash(vote.get("reasonHash")), "Revealed vote has no sealed commitment")
            opened = time_value(vote["createdAt"], "reveal")
            require(opened >= time_value(record["committedAt"], "commitment") and
                    opened <= time_value(review["deadline"], "reveal deadline"), "Reveal is outside its window")
            if opened < time_value(review["commitDeadline"], "commit deadline"):
                require(len(records_in_round) == 4 and all(time_value(item["committedAt"], "commitment") <= opened for item in records_in_round),
                        "Panel reveal preceded the close of commitments")
            expected = canonical_digest("panel-vote-v1", (review["id"], str(review["round"]), str(review["medicalVersion"]),
                auditor, vote["outcome"], vote["reasonHash"], vote["ballotSalt"]))
            require(expected == record["commitment"], "Panel ballot does not open its commitment")
        if review["status"] == "PROCEDURAL_FAILURE":
            require(review["approvals"] < 3 and review["rejections"] < 2, "Procedural failure reached a merits threshold")
            deadline = review.get("deadline") or review["prepareBy"]
            require(time_value(review["closedAt"], "closing") > time_value(deadline, "close deadline"), "Procedural failure closed too early")
    return commitments, votes


def verify_review_transcript(dossier, certificate, commitments, votes):
    claim_id = certificate["claimId"]
    transcript = [claim_id]
    if certificate["path"] == "PANEL":
        reviews = records(dossier, "reviewRounds")
        final = next(row for row in reviews if row["id"] == certificate["reviewId"])
        for review in sorted(reviews, key=lambda row: (row["round"], row["id"])):
            if review["round"] > final["round"]:
                break
            fields = [review["id"], str(review["round"]), str(review["medicalVersion"])]
            fields.extend(review.get(field, "") for field in ("kind", "status", "ballotVersion", "rosterVersion",
                "standbyForReviewId", "initialPrepareBy", "prepareBy", "openedAt", "commitDeadline", "deadline", "closedAt"))
            profile = timing_profile(review)
            if profile:
                fields.append(profile)
            for change in review.get("replacements", []):
                fields.append(canonical_digest("medical-auditor-replacement-v1", (change["absentAuditorId"], change["newAuditorId"], change["replacedAt"])))
            for auditor in review["assignedAuditorIds"]:
                record = commitments.get((review["id"], auditor), {})
                vote = votes.get((review["id"], auditor))
                seat = [auditor, record.get("commitment", ""), record.get("committedAt", "")]
                if vote:
                    seat.extend(vote.get(field, "") for field in ("id", "outcome", "reasonCode", "reasonHash", "createdAt", "ballotSalt"))
                fields.append(canonical_digest("medical-review-seat-v1", seat))
            transcript.append(canonical_digest("medical-review-round-v1", fields))
    require(canonical_digest("medical-review-transcript-v1", transcript) == certificate["reviewTranscriptHash"], "Review transcript hash differs")


def verify_revision_proof(dossier, claim, certificate, requests):
    proof = dossier.get("revisionProof")
    e3 = any(row.get("patientTokenKeyVersion") and row["claimVersion"] == claim["version"] for row in requests.values())
    if not proof:
        require(not e3, "Missing nonce-bound E3 revision proof")
        return
    require(proof.get("id") == claim.get("episodeId") and proof.get("revision") == claim.get("episodeRevision"),
            "Revision proof is not bound to the current episode")
    keys = ("id", "patientReferenceHash", "service", "serviceDate", "admissionDate", "dischargeDate", "billMinor", "invoiceDate", "diagnosisCode")
    values = [str(proof[key]) for key in keys]
    version = proof.get("digestVersion", 1)
    require(version in (1, 2) and (not e3 or version == 2), "Unknown or unexpected revision proof version")
    if version == 2:
        require(valid_hash(proof.get("revisionNonce")) and proof["revisionNonce"] != "0" * 64, "Invalid revision nonce")
        values.insert(0, proof["revisionNonce"])
    expected = canonical_digest(f"fabric-medical-intake-v{version}", values)
    require(proof.get("publicHash") == expected and (not certificate or certificate["episodeRevisionHash"] == expected), "Revision digest proof differs")


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
    v3 = certificate.get("certificateVersion") == 3
    require(v3 or "certificateVersion" not in certificate, "Unknown approval certificate version")
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
    if (not v3 or certificate.get("path") == "ORACLE_AUTO") and any(field in certificate for field in oracle_v2.V2_CERTIFICATE_FIELDS):
        require(certificate.get("path") == "ORACLE_AUTO" and certificate.get("decision") == "AUTO_APPROVE" and
                certificate.get("policyVersion") == "diagnostic-v1" and valid_hash(certificate.get("manifestHash")) and
                valid_hash(certificate.get("factVectorHash")), "Invalid Oracle v2 certificate binding")
        domain += ":oracle-v2"
        canonical.extend(certificate[field] for field in oracle_v2.V2_CERTIFICATE_FIELDS)
    require(not certificate.get("supersededBy"), "Certificate is superseded")
    derived = canonical_digest(domain, canonical)
    if v3:
        require(valid_hash(certificate.get("reviewTranscriptHash")) and
                (not certificate.get("samplingRecordHash") or valid_hash(certificate["samplingRecordHash"])), "Invalid certificate v3 evidence hash")
        require(time_value(certificate.get("decidedAt"), "decision") <= time_value(certificate.get("issuedAt"), "issuance"),
                "Certificate issuance preceded the decision")
        v3_fields = (derived, certificate["reviewTranscriptHash"], certificate.get("samplingRecordHash", ""),
            *(certificate.get(field, "") for field in oracle_v2.V2_CERTIFICATE_FIELDS), certificate.get("breakdownHash", ""),
            certificate["decidedAt"], certificate["issuedAt"])
        profile = timing_profile(certificate)
        if profile:
            v3_fields += (profile,)
        derived = canonical_digest("fabric-medical-approval-v3", v3_fields)
        version = 3
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
    selection_hashes = {}
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
        if isinstance(period, dict) and period.get("status"):
            require(period["id"] == period_id, "Audit sampling period differs")
            selection_hashes[request["id"]] = verify_r2_sampling(period, selection, request)
            if not selection:
                missing.append(f"Audit selection unavailable:{request['id']}")
            continue
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
        selection_hashes[request["id"]] = canonical_digest("fabric-medical-audit-record-v1", (
            period_id, selection["claimId"], str(selection["version"]), selection["resultHash"],
            digest, str(rate), str(selection["selected"]).lower(),
        ))
    require(rows.keys() <= requests.keys(), "Audit sampling has no Oracle request")
    return selection_hashes


def verify_r2_sampling(period, selection, request):
    shares = period.get("shares", [])
    revealed = []
    expected_order = ["AuditorMSP", "HospitalMSP", "InsurerMSP"]
    require([share.get("msp") for share in shares] == expected_order, "Audit period lacks the three governed commitments")
    for share in shares:
        require(valid_hash(share.get("commitment")), "Invalid audit share commitment")
        if share.get("share"):
            require(valid_hash(share["share"]) and canonical_digest("fabric-medical-audit-share-v2",
                    (period["id"], share["msp"], share["share"])) == share["commitment"], "Audit share commitment differs")
            revealed.append(share["share"])
    candidate = next((item for item in period.get("eligible", [])
        if item["claimId"] == request["claimId"] and item["version"] == request["claimVersion"]), None)
    require(candidate and valid_hash(candidate.get("episodeRevisionHash")), "Oracle request has no frozen audit inputs")
    if not selection:
        return ""
    status = period["status"]
    rate = period.get("rateBps")
    require(type(rate) is int and 0 < rate <= 10000, "Invalid sampling rate")
    require(status in ("AUDIT_SEED_DEFAULTED", "FINALIZED") and status == selection.get("status"), "Sampling record period is unresolved")
    resolved = time_value(selection["resolvedAt"], "audit resolution")
    digest = ""
    if status == "AUDIT_SEED_DEFAULTED":
        require(len(revealed) < 3 and not period.get("seed") and period.get("panelLoad") == len(period.get("eligible", [])) and
                resolved >= time_value(period["graceEndsAt"], "audit grace"), "Audit seed could not have defaulted yet")
        selected = True
    else:
        seed = canonical_digest("fabric-medical-audit-combined-seed-v2", revealed)
        require(len(revealed) == 3 and period["seed"] == seed and resolved >= time_value(period["endsAt"], "audit end"), "Combined audit seed differs")
        digest = hmac.new(bytes.fromhex(seed), canonical_bytes("fabric-medical-audit-selection-v2",
            (candidate["claimId"], str(candidate["version"]), candidate["episodeRevisionHash"])), hashlib.sha256).hexdigest()
        selected = int(digest[:8], 16) * 10000 < rate * 2**32
    require(selection.get("digest") == digest and selection.get("selected") is selected and
            selection.get("periodId") == period["id"] and selection.get("claimId") == candidate["claimId"] and
            selection.get("version") == candidate["version"] and selection.get("episodeRevisionHash") == candidate["episodeRevisionHash"] and
            selection.get("rateBps") == rate, "Frozen audit selection differs")
    derived = canonical_digest("fabric-medical-audit-record-v2", (period["id"], candidate["claimId"], str(candidate["version"]),
        candidate["episodeRevisionHash"], digest, str(rate), str(selected).lower(), status, selection["resolvedAt"]))
    require(selection.get("hash") == derived, "Audit selection record hash differs")
    return derived


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
    schema = dossier.get("schemaVersion", 0)
    strict = schema in (7, 8, 9)
    required_sections = READBACK_SECTIONS + (R2_SECTIONS if schema == 9 else ())
    missing = [section for section in required_sections if section not in dossier]
    require(not strict or not missing, "Missing dossier sections: " + ", ".join(missing))
    status = claim.get("status")
    digest = version = None
    e3_referral = schema == 9 and status == "MEDICAL_REVIEW_REQUIRED"
    if e3_referral:
        require(certificate is None and settlement is None and expected_hash is None,
                "Claim awaiting medical review contains an approval or payout")
        require(readback is not None, "Peer readback is required for an E3 referral")
    elif status == "REJECTED":
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
    if e3_referral:
        request = requests.get(claim.get("currentOracleRequestId"))
        require(request and request.get("protocolVersion") == "v2" and type(request.get("patientTokenKeyVersion")) is int and
                request["patientTokenKeyVersion"] > 0 and
                request.get("claimVersion") == claim["version"] and request.get("status") == "CONSENSUS" and
                request.get("finalizationCode") == claim.get("oracleOutcome") and
                request.get("resultHash") == claim.get("oracleResultHash"), "E3 referral differs from its current Oracle decision")
    verify_timing_profile(dossier, claim, certificate, requests)
    decisions = {}
    if strict or "reviewRounds" in dossier or "auditorDecisions" in dossier or status == "REJECTED":
        decisions = verify_panel(dossier, claim, certificate)
    if schema == 9 or version == 3:
        commitments, votes = verify_sealed_panels(dossier, decisions)
        verify_revision_proof(dossier, claim, certificate, requests)
        if version == 3:
            verify_review_transcript(dossier, certificate, commitments, votes)
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
                expected_code = "EXACT_CONSENSUS"
                if request.get("protocolVersion") == "v2":
                    require(all(request.get(field) and request[field] == certificate.get(field) for field in oracle_v2.V2_CERTIFICATE_FIELDS),
                            "Oracle v2 request and certificate binding differ")
                    expected_code = f"V2:AUTO_APPROVE:{request['factVectorHash']}"
                require(request.get("finalizationCode") == certificate["oracleOutcome"] == expected_code and
                        request.get("finalizedAt") == certificate["approvedAt"], "Oracle approval finalization differs from the certificate")
            if version == 3 and request.get("protocolVersion") == "v2":
                require(all(request.get(field, "") == certificate.get(field, "") for field in oracle_v2.V2_CERTIFICATE_FIELDS),
                        "Certificate v3 Oracle evidence differs")
        else:
            require(certificate["path"] == "PANEL", "Oracle approval is missing its Oracle request")
    if strict and certificate:
        write = dossier.get("certificateWrite")
        require(isinstance(write, dict) and isinstance(write.get("transactionId"), str) and
                isinstance(write.get("issuedAt"), str) and type(write.get("blockNumber")) is int and
                write["blockNumber"] > 0 and valid_hash(write.get("blockHash")), "Missing certificate write transaction")
        if version == 3:
            require(time_value(write["issuedAt"], "ledger issuance") == time_value(certificate["issuedAt"], "certificate issuance"),
                    "Certificate issuance timestamp differs from its transaction")
    verify_payout(dossier, certificate, strict, missing)
    samples = verify_sampling(dossier, requests, strict, missing)
    if version == 3:
        require(certificate.get("samplingRecordHash", "") == samples.get(certificate["oracleRequestId"], ""), "Certificate sampling link differs")
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
        v2_sections = ("oracleSourceIssuers", "oracleSourceFeeds") if any(row.get("protocolVersion") == "v2" for row in requests.values()) else ()
        timing_sections = ("timingProfile",) if "timingProfile" in sections or "timingProfile" in dossier else ()
        for section in required_sections + v2_sections + timing_sections:
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
