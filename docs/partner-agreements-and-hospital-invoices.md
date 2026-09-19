# Partner agreements and independent Hospital invoices

Phase 1 models Hospitals and Banks as external organizations that have explicit,
dated agreements with the insurer. An insurer administrator creates, suspends,
or ends each agreement and assigns active partners to a policy package. The
Hospital and Bank IDs are snapshotted when a policy is issued, so later package
changes do not silently change an existing policy's network.

## Hospital boundary

The Hospital workspace represents a separate billing system even though the
thesis demonstration uses the same application and Fabric network. A Hospital
identity can create and update only invoices owned by its certificate subject.
Finalized invoices cannot be rewritten; they may only be voided. Hospital users
cannot read insurer claims, clinical evidence, Oracle operations, reviews, or
settlements through the application boundary.

The shared ledger contains only the structured fields needed for verification:
hashed patient and clinical references, the Oracle lookup reference, amount,
admission/discharge dates, and status. It is not a complete hospital record.

## Insurer cross-check

A policyholder submits a claim against a finalized Hospital invoice. Chaincode
requires the invoice Hospital to be in the policy's snapshotted network and to
have an active agreement. The insurer then performs a deterministic, read-only
cross-check: ownership, invoice status, clinical reference, amount, and incident
date must agree. A successful result creates the version-bound verification
record required by the existing Oracle and auditor workflow.

This design does not make a Hospital approve insurance claims. Hospitals own
their invoice data; the insurer owns claim verification and adjudication.
