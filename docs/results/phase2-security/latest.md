# Oracle security evaluation

Generated 2026-09-26T16:55:23.960Z. Safe outcomes: 8/8; automated evidence coverage: 100%.

| ID | Threat | Initial risk | Expected outcome | Result | Automated evidence |
|---|---|---|---|---|---|
| T01 | Single malicious Oracle | HIGH | CONTAINED | PASS | singleMaliciousOracle, TestOracleTwoOfThreeThresholdConsensus |
| T02 | Unavailable Oracle | HIGH | TOLERATED | PASS | unavailableOracle, TestOracleTwoOfThreeThresholdConsensus |
| T03 | Conflicting or corrupted registry | HIGH | DETECTED_AND_FAILED_CLOSED | PASS | conflictingRegistry, TestOracleTwoOfThreeThresholdConsensus |
| T04 | Forged or unassigned Oracle identity | CRITICAL | PREVENTED | PASS | TestOracleAuthorizationCommitRevealAndExactSuccess |
| T05 | Replay or stale Oracle result | HIGH | PREVENTED | PASS | replayAndStaleResult, TestOracleAuthorizationCommitRevealAndExactSuccess, TestOracleDeadlinesStaleVersionsAndAppealIsolation |
| T06 | Altered selective-disclosure proof | CRITICAL | PREVENTED | PASS | alteredPrivacyProof, TestSelectiveDisclosureCredentialAndPresentationLifecycle |
| T07 | Late commitment or reveal | MEDIUM | PREVENTED | PASS | lateReveal, TestOracleLateSubmissionsAreRejected |
| T08 | Appeal-version substitution | HIGH | PREVENTED | PASS | appealSubstitution, TestOracleDeadlinesStaleVersionsAndAppealIsolation |

## Trust assumptions

- Fabric MSP certificate issuance and private keys are not compromised.
- At most one of three assigned Oracles is Byzantine for integrity guarantees.
- SHA-256 collision and preimage resistance hold.
- Authorized Fabric peers enforce the configured private-data collection policy.
- Auditor governance remains available when Oracle consensus fails closed.

## Residual risks

- **T01 (HIGH):** Two colluding assigned Oracles can form a quorum; this is the explicit 2-of-3 trust boundary.
- **T02 (MEDIUM):** Loss of two workers prevents automatic consensus and requires governed fallback.
- **T03 (HIGH):** All replicas derived from the same incorrect source can agree on incorrect data.
- **T04 (MEDIUM):** A stolen valid Oracle private key remains able to act until certificate revocation is enforced operationally.
- **T05 (LOW):** Compromise before finalization is governed by the quorum assumption rather than replay protection.
- **T06 (MEDIUM):** Authorized Oracle collection members still see disclosed fields; this is selective disclosure, not zero knowledge.
- **T07 (LOW):** A transaction submitted near a deadline can be affected by normal ordering latency.
- **T08 (MEDIUM):** The correctness of newly submitted source evidence remains an off-chain provenance concern.
