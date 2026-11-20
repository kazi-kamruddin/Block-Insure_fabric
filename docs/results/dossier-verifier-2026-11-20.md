# Standalone dossier verification

On 20 November 2026 four Python tests passed on one host using synthetic
dossiers. The suite checked both certificate encodings, one-field tampering,
a stale claim version with a nonzero CLI exit, mismatched amounts, and an
independent expected digest. The full Go suite stayed green at 53 tests and
18 subtests. The raw Go run is under
`.local-reference/maintenance-1.9/item-05/`.

The verifier reads only the export and optional caller-supplied ledger hash.
No live Fabric reads or external validation were used. Certificate
recomputation alone checks the dossier's internal consistency. Independent
ledger provenance requires a digest obtained through a trusted channel.
