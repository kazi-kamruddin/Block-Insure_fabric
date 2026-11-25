import copy
import unittest

from test_verify_dossier import fixture
from verify_dossier import (canonical_digest, draw_panel, verify_certificate, verify_revision_proof,
                            verify_r2_sampling, verify_sealed_panels)


class ApprovalV3Tests(unittest.TestCase):
    def test_v3_certificate_decision_and_issuance_are_distinct_bindings(self):
        dossier = fixture()
        cert = dossier["approvalCertificate"]
        base = cert["hash"]
        cert.update(certificateVersion=3, reviewTranscriptHash="a" * 64, samplingRecordHash="b" * 64,
                    decidedAt=cert["approvedAt"], issuedAt="2026-11-20T06:00:01Z")
        cert["hash"] = canonical_digest("fabric-medical-approval-v3", (base, cert["reviewTranscriptHash"], cert["samplingRecordHash"],
            "", "", "", "", cert["breakdownHash"], cert["decidedAt"], cert["issuedAt"]))
        dossier["settlement"]["approvalCertificateHash"] = cert["hash"]
        self.assertEqual(verify_certificate(dossier["claim"], cert, dossier["settlement"], None)[1], 3)
        cert["issuedAt"] = "2026-11-20T06:00:02Z"
        with self.assertRaisesRegex(ValueError, "Certificate hash mismatch"):
            verify_certificate(dossier["claim"], cert, dossier["settlement"], None)

    def test_valid_and_mutated_ballot_abstention_and_replacement(self):
        subjects = [f"auditor{i}" for i in range(1, 7)]
        review = {"id": "review-one", "round": 1, "medicalVersion": 3, "claimId": "claim-one",
                  "ballotVersion": "panel-vote-v1", "rosterVersion": "roster-one", "initialPrepareBy": "2026-11-25T06:00:00Z",
                  "prepareBy": "2026-11-25T06:05:00Z", "openedAt": "2026-11-25T06:01:00Z",
                  "commitDeadline": "2026-11-25T06:02:00Z", "deadline": "2026-11-25T06:03:00Z", "closedAt": "2026-11-25T06:03:01Z",
                  "status": "PROCEDURAL_FAILURE", "approvals": 1, "rejections": 0, "commitmentsCast": 1}
        selected, standby = draw_panel(review, subjects)[:4], draw_panel(review, subjects)[4:]
        review["replacements"] = [{"absentAuditorId": selected[0], "newAuditorId": standby[0], "replacedAt": "2026-11-25T06:00:00Z"}]
        review["assignedAuditorIds"] = [standby[0], *selected[1:]]
        review["standbyAuditorIds"] = standby[1:]
        voter = selected[1]
        vote = {"id": "decision-one", "reviewId": review["id"], "auditorId": voter, "outcome": "APPROVE",
                "ballotVersion": "panel-vote-v1", "reasonHash": "a" * 64, "ballotSalt": "b" * 64, "createdAt": "2026-11-25T06:02:01Z"}
        packet = {"reviewId": review["id"], "auditorId": voter, "round": 1, "claimVersion": 3, "committedAt": "2026-11-25T06:01:30Z",
                  "commitment": canonical_digest("panel-vote-v1", (review["id"], "1", "3", voter, "APPROVE", "a" * 64, "b" * 64))}
        dossier = {"reviewRounds": [review], "panelVoteCommitments": [packet], "auditorRosters": [
            {"version": "roster-one", "subjects": subjects, "approvedMsps": ["InsurerMSP", "AuditorMSP", "OracleMSP"]}],
            "appeals": []}
        verify_sealed_panels(dossier, {vote["id"]: vote})
        with self.assertRaisesRegex(ValueError, "does not open"):
            verify_sealed_panels(dossier, {vote["id"]: dict(vote, ballotSalt="c" * 64)})
        inconsistent = copy.deepcopy(dossier)
        inconsistent["reviewRounds"][0]["rejections"] = 2
        with self.assertRaisesRegex(ValueError, "merits threshold"):
            verify_sealed_panels(inconsistent, {vote["id"]: vote})
        inconsistent = copy.deepcopy(dossier)
        inconsistent["reviewRounds"][0]["replacements"][0]["newAuditorId"] = standby[1]
        with self.assertRaisesRegex(ValueError, "Invalid standby"):
            verify_sealed_panels(inconsistent, {vote["id"]: vote})

    def test_nonce_is_required_and_detects_mutation(self):
        proof = {"id": "episode", "revision": 2, "patientReferenceHash": "a" * 64, "service": "DIAGNOSTIC",
                 "serviceDate": "2026-11-05", "admissionDate": "2026-11-05", "dischargeDate": "2026-11-05",
                 "billMinor": 4000, "invoiceDate": "2026-11-05", "diagnosisCode": "Z01", "digestVersion": 2, "revisionNonce": "b" * 64}
        proof["publicHash"] = canonical_digest("fabric-medical-intake-v2", (
            "b" * 64, "episode", "a" * 64, "DIAGNOSTIC", "2026-11-05", "2026-11-05", "2026-11-05", "4000", "2026-11-05", "Z01"))
        claim = {"episodeId": "episode", "episodeRevision": 2, "version": 1}
        requests = {"request": {"claimVersion": 1, "patientTokenKeyVersion": 1}}
        verify_revision_proof({"revisionProof": proof}, claim, None, requests)
        proof["revisionNonce"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "Revision digest proof differs"):
            verify_revision_proof({"revisionProof": proof}, claim, None, requests)

    def test_sampling_default_refuses_mutated_selection(self):
        period = {"id": "period", "rateBps": 2500, "status": "AUDIT_SEED_DEFAULTED", "panelLoad": 1, "graceEndsAt": "2026-11-25T06:02:00Z",
                  "eligible": [{"claimId": "claim", "version": 1, "episodeRevisionHash": "b" * 64}],
                  "shares": [{"msp": msp, "commitment": "a" * 64} for msp in ("AuditorMSP", "HospitalMSP", "InsurerMSP")]}
        selection = {"claimId": "claim", "version": 1, "periodId": "period", "episodeRevisionHash": "b" * 64,
                     "rateBps": 2500, "status": "AUDIT_SEED_DEFAULTED", "resolvedAt": period["graceEndsAt"], "digest": "", "selected": True}
        selection["hash"] = canonical_digest("fabric-medical-audit-record-v2", ("period", "claim", "1", "b" * 64, "", "2500", "true",
            "AUDIT_SEED_DEFAULTED", period["graceEndsAt"]))
        self.assertEqual(verify_r2_sampling(period, selection, {"claimId": "claim", "claimVersion": 1}), selection["hash"])
        selection["selected"] = False
        with self.assertRaisesRegex(ValueError, "Frozen audit selection differs"):
            verify_r2_sampling(period, selection, {"claimId": "claim", "claimVersion": 1})
