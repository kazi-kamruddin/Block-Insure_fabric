import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from verify_dossier import verify


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
