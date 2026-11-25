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
