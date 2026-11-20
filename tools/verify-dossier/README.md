# Verify a medical settlement dossier

Run `python tools/verify-dossier/verify_dossier.py <export.json>` with an Insurer dossier export for a confirmed dev-lite payout. The tool supports legacy and terms-bound certificates and exits nonzero with a reason when a check fails.

Supply `--expected-certificate-hash` with a digest obtained independently from the ledger to anchor the certificate to that trusted value. A local export alone establishes consistency among the signed-off fields and their links. The tool does not fetch a block, verify Fabric endorsements, validate clinical evidence, or recompute a private calculation whose inputs are absent.

Run the offline tests with `python -B -m unittest discover -s tools/verify-dossier`.
