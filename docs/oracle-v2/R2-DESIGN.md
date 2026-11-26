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

### Phase order under clock tolerance (sequence 4)

Every chaincode clock reads the transaction proposal timestamp through `ledgerNow`, which refuses a timestamp more than 15 s from the endorsing peer's wall clock. The tolerance is unchanged in both profiles because it absorbs ordinary skew between hosts, not workflow time.

Up to sequence 3 each sealed-value transaction derived its phase only from that timestamp. A proposal could therefore be backdated by up to 15 s. The pre-freeze audit (26 November 2026) found that this let a subject that had withheld its sealed value submit one after another subject's value was already public:

- **Oracle v2 and v1.** `SubmitOracleCommitmentV2` and `SubmitOracleCommitment` checked only `now ≤ CommitDeadline`, while reveals open once the deadline passes. A withheld worker could copy a revealed fact vector into a fresh commitment and create a false 2-of-3 when the two honest workers disagree. This held in REAL as well as DEMO; DEMO only made it more visible because 15 s is the whole DEMO commit window.
- **Sealed panel ballots.** `CommitAuditorVote` had the same shape, so an auditor who had not sealed could seal after a vote was revealed. That defeats the anti-herding purpose of sealing. Practical exposure was lower, because auditor identities stay behind the Gateway, which sets proposal timestamps.

Sequence 4 closes the phase in ledger state rather than in time. A commitment is refused once `RevealCount > 0`; a ballot is refused once `VotesCast > 0`. Each commit transaction already reads and writes the same request or review key that the first reveal writes, so Fabric's MVCC validation serialises a racing commit and reveal: in any block at most one of them is valid against the version both read. The first reveal is therefore the state switch that the TLA+ models represent with a single `stage` variable ([Oracle v2 model](../../formal/oracle-v2/README.md), [sealed panel model](../../formal/medical-certificate/README.md)). After this change the implementation follows the modelled order: no sealed value can enter after any value has been opened.

One effect of the tolerance remains, and it concerns liveness only. A reveal whose timestamp is ahead of real time could open the reveal phase up to 15 s early once all commitments have arrived or the shifted deadline has passed. That can exclude a slow honest worker or auditor, who then counts as absent. The remaining two Oracle workers still decide by exact agreement, and an absent auditor abstains under the existing expiry rules. Integrity, meaning which values may count, is not affected.

Evidence: [`late_commit_guard_test.go`](../../chaincode/insurance-contract/src/late_commit_guard_test.go) reproduces the backdated late commitment for v2, v1 and sealed ballots. All three tests failed against the sequence-3 source and pass against sequence 4. A fourth test shows that a tolerated commitment before any reveal still counts. [Session C record](../results/session-c-2026-11-26.md)

Oracle requests store their commit and reveal deadlines with the profile. Reviews keep the profile through voting, standby replacement, and closure. The final model approval records `activationEligibleAt` for that governance round. Earlier records fall back to REAL, including the existing failure on claim 206. Certificates v3 bind the decisive review or Oracle request profile into the digest. The dossier checks each stamped review, the Oracle v2 deadlines, and the certificate profile, including against independent readback when required.
