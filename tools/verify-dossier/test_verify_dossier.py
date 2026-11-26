import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from verify_dossier import READBACK_SECTIONS, canonical_digest, verify, verify_payout


def fixture(version=2):
    certificate = {
        "id": "194a49686b5b865a75e0ea9e4fe058f62124fd6fe3f487621a0535ecd2d95210",
        "activationTransactionId": "activate-tx", "claimId": "claim-one", "claimVersion": 3,
        "episodeRevision": 2, "episodeRevisionHash": "a" * 64, "associationVersion": 1,
        "statementHash": "b" * 64, "amountMinor": 4000, "currency": "BDT", "path": "PANEL",
        "oracleRequestId": "oracle-one", "oracleResultHash": "c" * 64, "oracleOutcome": "EXACT_CONSENSUS",
        "registrySnapshotId": "registry-one", "registryRootHash": "d" * 64, "modelHash": "e" * 64,
        "reviewId": "review-one", "decisionId": "decision-one", "escalatedAt": "",
        "duplicateReview": True, "approvedAt": "2026-11-20T06:00:00Z",
        "hash": "1f7810eb740571d06b09661fbded36e84bbd2dced06adf24e912604158cb1619",
    }
    if version == 2:
        certificate.update(packageId="package-one", rulesVersion=1, termsHash="f" * 64, breakdownHash="1" * 64,
                           hash="92e1cc094512440d6d693f7ecc88f0fec81f4973788bc4a38798fb45ddf1362d")
    claim = {"id": "claim-one", "version": 3, "episodeRevision": 2, "descriptionHash": "b" * 64,
             "amountMinor": 4000, "medicalSettlementId": "settlement-one", "status": "SETTLED"}
    settlement = {"id": "settlement-one", "claimId": "claim-one", "amountMinor": 4000, "currency": "BDT",
                  "approvalCertificateHash": certificate["hash"], "status": "CONFIRMED", "transferId": "payout-one"}
    return {"claim": claim, "approvalCertificate": certificate, "settlement": settlement}


class DossierVerifierTests(unittest.TestCase):
    def test_corrected_appeal_uses_the_unwrapped_payout_statement(self):
        dossier = fixture()
        certificate = dossier["approvalCertificate"]
        dossier["claim"]["policyId"] = "policy-one"
        statement = canonical_digest("fabric-medical-statement-v1", (
            "policy-one", certificate["termsHash"], certificate["episodeRevisionHash"], "2", "4000", "10000",
        ))
        digest = canonical_digest("fabric-medical-breakdown-v1", (
            statement, "5000", "8000", "5000", "1000", "0", "8000", "4000", "10000", "10000", "4000",
        ))
        certificate["breakdownHash"] = digest
        dossier["payoutBreakdown"] = {"statementVersion": 3, "statementHash": statement, "breakdownHash": digest,
            "inputs": {"packageId": "package-one", "rulesVersion": 1, "termsHash": "f" * 64,
                       "billedMinor": 5000, "serviceSublimitMinor": 8000, "deductibleBps": 0,
                       "deductibleCapMinor": 1000, "insurerShareBps": 8000, "coverageLimitMinor": 10000,
                       "remainingCoverMinor": 10000},
            "values": {"eligibleMinor": 5000, "deductibleMinor": 0, "insurerShareMinor": 4000, "payableMinor": 4000}}
        verify_payout(dossier, certificate, True, [])
        dossier["payoutBreakdown"]["statementHash"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "Payout statement differs"):
            verify_payout(dossier, certificate, True, [])

    def test_valid_versions(self):
        for version in (1, 2):
            with self.subTest(version=version):
                dossier = fixture(version)
                digest = dossier["approvalCertificate"]["hash"]
                result = verify(dossier, digest)
                self.assertEqual(result["certificateVersion"], version)
                self.assertEqual(result["certificateHash"], digest)

    def test_one_field_tamper(self):
        dossier = fixture()
        dossier["approvalCertificate"]["breakdownHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Certificate hash mismatch"):
            verify(dossier)

    def test_stale_version_exits_nonzero_with_reason(self):
        dossier = fixture()
        dossier["claim"]["version"] += 1
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "fixture.json")
            path.write_text(json.dumps(dossier), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("verify_dossier.py")), str(path)],
                capture_output=True, text=True, check=False,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale for the claim version", result.stderr)

    def test_amount_and_independent_anchor(self):
        dossier = fixture()
        with self.assertRaisesRegex(ValueError, "supplied ledger hash"):
            verify(dossier, "0" * 64)
        dossier["settlement"]["amountMinor"] += 1
        with self.assertRaisesRegex(ValueError, "Amounts differ"):
            verify(dossier)

    def test_reveal_and_commitment_mutations(self):
        dossier = fixture()
        dossier.update(
            oracleRequests=[{
                "id": "req", "claimId": "claim-one", "claimVersion": 3, "registryVersion": 1,
                "queryHash": "q", "modelVersion": "model", "modelHash": "m",
                "assignedOracleIds": ["oracle1", "oracle2", "oracle3"],
                "requiredConfirmations": 2, "commitmentCount": 2, "revealCount": 2,
                "status": "CONSENSUS", "verifiedResult": True, "finalizationCode": "EXACT_CONSENSUS",
            }],
            oracleCommitments=[], oracleResults=[], oracleReveals=[],
        )
        record_hash = "a" * 64
        result_hash = canonical_digest("block-insure-oracle-v1:result", (
            "req", "claim-one", "q", "3", "", "", "", "", "1", "", "", "", "model", "m",
            "", "", "", "true", "VERIFIED", record_hash,
        ))
        dossier["oracleRequests"][0]["resultHash"] = result_hash
        for oracle, salt in [("oracle1", "b" * 64), ("oracle2", "c" * 64)]:
            submission_id = "req:" + oracle
            common = {"id": submission_id, "requestId": "req", "claimId": "claim-one",
                      "claimVersion": 3, "oracleId": oracle, "oracleIdentity": oracle}
            dossier["oracleCommitments"].append(dict(common, commitmentHash=canonical_digest(
                "block-insure-oracle-v1:commitment", ("req", "3", "1", "true", result_hash, "model", "m", salt))))
            dossier["oracleResults"].append(dict(common, registryVersion=1, modelVersion="model", recordHash=record_hash,
                                                  verified=True, verificationCode="VERIFIED", resultHash=result_hash))
            dossier["oracleReveals"].append(dict(resultId=submission_id, requestId="req", oracleId=oracle, salt=salt))
        verify(dossier)
        vectors = [
            ("oracleCommitments", lambda rows: rows.pop(), "Missing commitment"),
            ("oracleResults", lambda rows: rows[0].update(resultHash="0" * 64), "Oracle result digest mismatch"),
            ("oracleReveals", lambda rows: rows[0].update(salt="0" * 64), "Oracle commitment digest mismatch"),
        ]
        for section, mutate, error in vectors:
            with self.subTest(section=section):
                altered = json.loads(json.dumps(dossier))
                mutate(altered[section])
                with self.assertRaisesRegex(ValueError, error):
                    verify(altered)

    def test_panel_mutations(self):
        dossier = fixture()
        dossier["reviewRounds"] = [{
            "id": "review-one", "claimId": "claim-one", "medicalVersion": 3, "round": 1, "status": "APPROVED",
            "assignedAuditorIds": ["a1", "a2", "a3", "a4"], "approvals": 3, "rejections": 1,
            "approvalThreshold": 3, "rejectionThreshold": 2, "votesCast": 4,
            "closedAt": dossier["approvalCertificate"]["approvedAt"],
        }]
        dossier["auditorDecisions"] = [
            {"id": decision, "claimId": "claim-one", "reviewId": "review-one", "reviewRound": 1,
             "auditorId": auditor, "outcome": outcome}
            for auditor, decision, outcome in [
                ("a1", "d1", "APPROVE"), ("a2", "d2", "APPROVE"),
                ("a3", "decision-one", "APPROVE"), ("a4", "d4", "REJECT"),
            ]
        ]
        verify(dossier)
        for section, key, value, error in [
            ("auditorDecisions", "auditorId", "a2", "Duplicate auditor"),
            ("auditorDecisions", "reviewRound", 2, "Decision round differs"),
            ("reviewRounds", "medicalVersion", 2, "Panel claim version differs"),
        ]:
            with self.subTest(key=key):
                altered = json.loads(json.dumps(dossier))
                altered[section][0][key] = value
                with self.assertRaisesRegex(ValueError, error):
                    verify(altered)

    def test_evidence_mutation(self):
        dossier = fixture()
        evidence = {"id": "ev", "claimId": "claim-one", "claimVersion": 3, "documentType": "RECEIPT",
                    "contentHash": "a" * 64, "storageReferenceHash": "b" * 64}
        leaf = canonical_digest("block-insure-evidence-leaf-v1", ("ev", "claim-one", "3", "RECEIPT", "a" * 64, "b" * 64))
        dossier.update(evidence=[evidence], evidenceMerkle=[{
            "batch": {"id": "batch", "rootHash": leaf, "evidenceIds": ["ev"], "leafCount": 1,
                      "hashAlgorithm": "SHA-256", "leafEncoding": "block-insure-evidence-leaf-v1"},
            "proofs": [{"evidenceId": "ev", "leafHash": leaf, "proof": []}],
        }])
        verify(dossier)
        dossier["evidenceMerkle"][0]["proofs"][0]["proof"].append({"hash": leaf, "position": "RIGHT"})
        with self.assertRaisesRegex(ValueError, "Broken evidence Merkle proof"):
            verify(dossier)

    def test_missing_readback_cannot_pass_anchored_verification(self):
        self.assertEqual(verify(fixture())["verification"], "INTERNALLY CONSISTENT — NOT ANCHORED")
        with self.assertRaisesRegex(ValueError, "Peer readback is required"):
            verify(fixture(), require_readback=True)

    def test_supplied_peer_readback_checks_every_section(self):
        dossier = fixture()
        dossier.update({section: [] for section in READBACK_SECTIONS if section not in dossier})
        # This legacy fixture has only the certificate and payout; the test
        # verifies exact comparison with separately supplied sections.
        dossier["reviewRounds"] = [{
            "id": "review-one", "claimId": "claim-one", "medicalVersion": 3, "round": 1, "status": "APPROVED",
            "assignedAuditorIds": ["a1", "a2", "a3", "a4"], "approvals": 3, "rejections": 0,
            "approvalThreshold": 3, "rejectionThreshold": 2, "votesCast": 3,
            "closedAt": dossier["approvalCertificate"]["approvedAt"],
        }]
        dossier["auditorDecisions"] = [
            {"id": decision, "claimId": "claim-one", "reviewId": "review-one", "reviewRound": 1,
             "auditorId": auditor, "outcome": "APPROVE"} for auditor, decision in
            [("a1", "d1"), ("a2", "d2"), ("a3", "decision-one")]
        ]
        dossier.update(channel="test-channel", chaincode="insurance-contract", payoutBreakdown=None)
        anchor = {"schema": "dossier-peer-readback-v1", "channel": dossier["channel"], "chaincode": dossier["chaincode"],
                  "blockHeight": 50, "blockHash": "e" * 64,
                  "sections": json.loads(json.dumps({key: dossier[key] for key in READBACK_SECTIONS}))}
        self.assertEqual(verify(dossier, readback=anchor)["anchor"], "peer readback")
        anchor["sections"]["fraudAssessments"] = [{"id": "fabricated"}]
        with self.assertRaisesRegex(ValueError, "Peer readback differs: fraudAssessments"):
            verify(dossier, readback=anchor)
        del anchor["sections"]["oracleResults"]
        with self.assertRaisesRegex(ValueError, "Missing peer readback section: oracleResults"):
            verify(dossier, readback=anchor)

    def test_authorized_and_rejected_outcomes(self):
        authorized = fixture()
        authorized["claim"]["status"] = "SETTLEMENT_AUTHORIZED"
        authorized["settlement"].update(status="AUTHORIZED", transferId="")
        self.assertEqual(verify(authorized)["claimStatus"], "SETTLEMENT_AUTHORIZED")

        rejected = {"claim": {"id": "claim-one", "version": 3, "status": "REJECTED",
                              "currentReviewId": "review-one", "auditorDecisionId": "d2"},
                    "approvalCertificate": None, "settlement": None,
                    "reviewRounds": [{"id": "review-one", "claimId": "claim-one", "round": 1,
                                      "medicalVersion": 3, "status": "REJECTED", "approvals": 1, "rejections": 2,
                                      "approvalThreshold": 3, "rejectionThreshold": 2, "votesCast": 3,
                                      "assignedAuditorIds": ["a1", "a2", "a3", "a4"]}],
                    "auditorDecisions": [{"id": decision, "claimId": "claim-one", "reviewId": "review-one",
                                          "reviewRound": 1, "auditorId": auditor, "outcome": outcome}
                                         for auditor, decision, outcome in [("a1", "d1", "APPROVE"),
                                                                             ("a2", "d2", "REJECT"), ("a3", "d3", "REJECT")]]}
        self.assertIsNone(verify(rejected)["certificateHash"])
