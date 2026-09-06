# Distributed claim adjudication and fraud decision support

Block-Insure Fabric uses explicit review-round assets instead of treating one
auditor response as the final claim decision. The design keeps eligibility,
votes, thresholds, deadlines, and appeal history on the shared ledger so every
member organization can audit how a decision was reached.

In the supervisor workflow, this review system is the governed fallback after a
negative, conflicting, or timed-out two-Oracle request. The legacy
`OpenClaimReview` transaction remains available for an explicitly manual initial
review, while `RouteOracleFailureToReview` proves and records that the normal
Oracle path failed before opening the same fixed-quorum machinery. Oracle
agreement never changes the review thresholds and fraud triage remains advisory.

## Review lifecycle

An insurer administrator opens an initial `ClaimReview` for a hospital-verified
claim. The transaction records an immutable array of three to nine Fabric
certificate subject IDs, separate approval and rejection thresholds, and an
RFC 3339 deadline. Thresholds must satisfy:

```text
approval threshold + rejection threshold = assignment count + 1
```

This guarantees that approval and rejection cannot both become reachable. The
demonstration profile assigns `auditor1` through `auditor4`, requiring three
approvals or two rejections. An AuditorMSP identity with the `auditor` attribute
may vote only when its certificate `subjectId` appears in that review. Fabric
rejects duplicate votes from the same subject in the same round.

Each vote is an immutable `AuditorDecision` containing the review and claim IDs,
round number, outcome, reason hash, MSP, role, certificate subject, and serialized
certificate identity. When a threshold is reached, chaincode atomically closes
the review and advances the claim. A deadline does not cause hidden wall-clock
mutation: an authorized transaction explicitly finalizes an expired open review.

## Appeal lifecycle

A policyholder may submit one appeal for an initially rejected owned claim. The
appeal stores only a reason hash. An insurer administrator opens a new review
round with an independently recorded assignment, threshold, and deadline.
Approval marks the appeal `OVERTURNED` and the claim `APPROVED`; rejection or
timeout marks it `UPHELD`. The initial review and all earlier votes remain intact.

## Fraud assessment boundary

The deterministic local rule engine evaluates amount-to-coverage ratio, evidence
count, and prior policy claim count. Fabric stores the resulting basis-point
score, risk band, signal codes, engine version, model hash, and input hash as an
immutable `FraudAssessment`.

Every assessment is explicitly `advisory: true`. Recording one never approves,
rejects, or otherwise mutates the claim lifecycle. Its purpose is explainable
review prioritization and reproducible research, not automated adjudication.

## Verified behavior

The Go suite covers assignment and threshold validation, unassigned and duplicate
vote rejection, quorum closure, timeout, appeal limits, cross-round history, and
fraud non-authority. The live CLI smoke completes a 3-of-4 approval and confirms
the assessment remains advisory. The Playwright suite also completes a rejected
round, one appeal, and a three-vote overturn through distinct signed application
sessions and Fabric identities.
The Oracle suite additionally proves automatic exact-result approval and manual
fallback without granting either Oracle settlement authority.
