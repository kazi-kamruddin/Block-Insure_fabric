# R2 release design

R2 keeps the existing request protocol and three-subject exact 2-of-3 Oracle rule. The active roster and release are ledger governance decisions. Older Oracle requests keep their pinned release, E2 digest and historical source query. E3 preserves the v2 wire protocol with a separate artifact identity and a distinct private source query.

## Reviewer governance and disclosure

Insurer, Auditor and Oracle MSPs approve a six-subject roster. New reviews rank its subject IDs by a SHA-256 draw bound to claim ID, claim version and review round. The four lowest ordered scores take seats. Appeals and a standby round select both previous standbys and two seeded members of the former panel. Two panels of size four from six overlap by at least two. A disjoint panel would require eight subjects.

The insurer supplies the exact private episode and statement bytes through transient data. Insurer and Auditor peers compare each byte SHA-256 with the preceding collection's private-state hash and endorse its copy into `auditorReviewPrivateData`. A cross-hospital explanation, when supplied, is copied the same way. An assigned reviewer reads these facts from the Auditor peer. Evidence attachments still use their existing grants. After the preparation deadline, a missing original seat can be replaced once with a standby. The first replacement extends preparation by five minutes. The new reviewer must acknowledge the disclosure and complete the applicable document checks.

Each sealed commitment uses the canonical domain `panel-vote-v1` and the review ID, round, claim version, auditor subject, outcome, encoded reason hash and a 32-byte salt. Reveals can begin once the commit window closes or all four commitments arrive. Three approvals or two rejections close the round. Missing or invalid openings abstain. An expired round without a threshold records `PROCEDURAL_FAILURE` and permits the mixed standby panel. Previously opened reviews keep their original open-vote semantics.

## Sampling and invalidation

The insurer proposes a sampling rate, start, end and grace window. Insurer, Auditor and Hospital must each commit before the opening. The open transaction freezes eligible claim versions and their episode hashes. Three matching reveals are required. The sorted shares derive the HMAC seed. The index calculation uses claim ID, version and episode revision hash. A missing share at the grace deadline defaults the sampled cohort to panel review. Each selection records the frozen input and result. The claim can use the audit grace deadline for escalation.

For unpaid approvals, retirement checks both current medical source validity and the Bank execution hash in the same transaction. It retires an existing unpaid authorization and liability, releases the claim's cover once, and marks the certificate ineffective without erasing it. Bank mutations require the account's Bank identifier. The original dev-lite BankMSP signing certificate has CA enrollment ID and common name `bankOfficer` and lacks `subjectId`. Its explicit fallback maps solely to `bank-demo`.

## E3 and certificate v3

New R2 medical revisions hash a private 32-byte nonce with the original factual fields. Historical revisions keep their existing digest. E3 uses purpose-scoped patient tokens derived from a versioned private key. Requests pin the key version, and a rotation preserves prior key records needed by pending or historical requests. The E3 scoring projection uses the token to retain the frozen scorer's matching behavior without passing a raw member subject into the scorer.

Certificate v3 wraps the legacy certificate digest with the panel transcript, sampling link, routing and payout bindings, decision time and issuance time. A new panel transcript covers every applicable round, including previous open votes and sealed-round replacements. An independent readback can compare the certificate and evidence sections. The full dossier requires the insurer role. The Auditor export retains the review assignment boundary. A nonce-bound dossier contains a private revision proof and must be kept with the authorized evidence archive.

## Local chaincode runtime

The dev-lite candidate uses one shared ccaas process on the internal Docker network. The peer's pinned 2.5.16 image and mounted configuration include the external builder. The local connection has no published host port. The chaincode server checks its package ID and retains the original peer-launched mode when the server settings are absent. A shared process is one failure domain and does not model independently operated institutional infrastructure.

## Governed medical timing

InsurerMSP proposes a named REAL or DEMO profile for `insurance-dev-lite-190`. AuditorMSP approves the proposal against the active revision. The ledger records the activation timestamp and transaction ID. A stale proposal cannot replace a newer profile. The default and the profile on all other channels are REAL.

| Chaincode wait or clock | Classification | REAL | DEMO |
| --- | --- | --- | --- |
| Oracle v2 commit and subsequent reveal | Protocol | 60 s, then 120 s | 15 s, then 30 s |
| Active model release eligibility after final approval | Protocol | 10 min | 30 s |
| Claimant escalation after submission or Oracle finalization | Protocol | 24 h | 2 min |
| Claimant escalation while Oracle request is pending | Protocol boundary | Ledger reveal deadline + 1 s | Ledger reveal deadline + 1 s |
| Escalated review preparation | Protocol | 7 d | 10 min |
| First standby replacement extension | Protocol | 5 min | 30 s |
| Rejected review appeal or recovery | Protocol | 30 d | 30 min |
| Review minimum and maximum, and default preparation and voting | Protocol | 1 min to 14 d, defaults 48 h and 24 h | 15 s to 20 min, defaults 3 min and 2 min |
| Sealed ballot commit cutover and clarification deadline | Protocol | Voting midpoint, clarification capped at preparation deadline | Same calculation on the pinned DEMO deadlines |
| Audit sampling duration and three-party grace | Governed calendar interval | 1 min to 31 d, grace 60 s to 7 d | Same user-governed interval and bounds |
| Claimant escalation during audit seed grace | Governed calendar interval | Ledger grace end | Ledger grace end |
| Legacy Oracle v1 and generic review deadline arguments | Caller-specified legacy clock | Absolute caller deadlines | Absolute caller deadlines |
| Policy starts, ends, eligibility, waiting, filing, premium intervals, grace, renewals and mandate expiry | Calendar | Issued policy terms and existing calendar rules | Same |
| Hospital agreement, credential, grant, presentation, issuer and source-feed validity | Calendar | Explicit dates, existing one-year bounds where applicable | Same |
| Duplicate service-day neighborhood and Oracle's 90-day prior source window | Historical calendar | Existing day offsets and cutoff | Same |
| Appeal-note disposal | Retention | 365 d | 365 d |
| Peer ledger-clock tolerance | Clock | 15 s | 15 s |

The unchanged 15 s proposal tolerance equals the DEMO Oracle commit window. The phase guards compare with the accepted proposal timestamp during endorsement. Treat DEMO timing as a rehearsal setting. The pre-freeze audit leaves a strict peer-observed phase boundary open for a sequence-4 design. [Dated R2 run](../results/r2-journeys-2026-11-26.md#pre-freeze-readback)

Oracle requests store their commit and reveal deadlines with the profile. Reviews keep the profile through voting, standby replacement, and closure. The final model approval records `activationEligibleAt` for that governance round. Earlier records fall back to REAL, including the existing failure on claim 206. Certificates v3 bind the decisive review or Oracle request profile into the digest. The dossier checks each stamped review, the Oracle v2 deadlines, and the certificate profile, including against independent readback when required.
