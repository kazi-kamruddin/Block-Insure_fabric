# Verify a medical claim dossier

Run the verifier with an Insurer dossier export. It checks settled, authorized, approved and rejected medical claims and reports missing sections. Historical dossiers can still verify the fields available in their schema.

```powershell
python -B tools/verify-dossier/verify_dossier.py <export.json>
```

For a version-8 dossier, the verifier recomputes the Oracle v2 manifest,
exact fact vector, routing decision, subject-bound commitments and
certificate fields. It checks the issuer's Ed25519 signatures over
anchored feed roots with the existing Node 24 runtime. Version-7 and older
dossiers retain their historical rules.

A local export reports **INTERNALLY CONSISTENT — NOT ANCHORED** if its checks pass. The optional `--expected-certificate-hash` compares only the certificate hash with a separately obtained digest.

For an anchored check, obtain a separate readback against the Insurer peer while the approved dev-lite stack is running. The command evaluates existing chaincode and QSCC queries. It writes its JSON under the ignored `data/dev-lite/dossier-readback/` directory and reports the path.

```powershell
node scripts/export-dossier-readback.mjs CLM-2026-000201
python -B tools/verify-dossier/verify_dossier.py <export.json> --readback <readback.json> --require-readback
```

The verifier checks the v1 result digests, previously revealed commitment digests, assigned-subject quorum, panel rounds and dissent, evidence inclusion, audit sampling and committed payout arithmetic. It checks explanation and reason receipts when supplied. A commitment with no valid reveal has no available opening and appears in the missing-section list. The certificate's decision timestamp and the commit transaction's issue timestamp are separate fields.

The anchor is a readback file supplied by the operator. Obtain it independently from a trusted peer and protect it alongside the original export. Verification establishes consistency with that peer's report and the included hashes. Fabric endorsement verification and the accuracy of the original clinical evidence lie outside this check.

Run the offline tests with `python -B -m pytest tools/verify-dossier -q`.
