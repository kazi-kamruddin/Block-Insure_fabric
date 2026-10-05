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

## Current invoice and claim workflow

A Hospital officer enters a patient reference equal to the covered policyholder's
insurance subject ID. The browser hashes it before submission. Finalizing an
invoice creates its private credential automatically. A finalized invoice is
immutable; voiding it revokes that automatic credential.

A policyholder binds a claim to a finalized invoice. Chaincode checks the
contracted Hospital, policy ownership, and hashed patient reference. The
insurer administrator starts claim processing without making an invoice-match
verdict. The new `SOURCE_BOUND` record captures the claim version and invoice
reference for the Oracle request; it is not a positive verification result.
The three Oracle workers compare the invoice ID, Hospital, patient reference,
amount, and incident date with a snapshot derived from the Hospital's Fabric
record. A positive claim amount may be less than the invoice total. A claim
narrative does not have to equal the Hospital's treatment reference. Two
matching worker results finalize the Oracle outcome.

The earlier insurer `CrossCheckClaimInvoice` transaction remains for historical
claims. New schema-15 invoices use the Oracle path. The Hospital only maintains
its records and does not receive claim, review, or settlement actions.
