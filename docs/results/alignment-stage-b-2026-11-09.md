# Isolated alignment verification — 9 November 2026

Status: selected isolated Stage B tests PASSED; broader acceptance remains pending.
This record covers selected synthetic functional and failure
tests, not clinical accuracy, a benchmark, production readiness or preserved
channel activation. Original failures remain in ignored local evidence.

The working source is based on `094421b` with the Stage B changes listed in the
local handoff. Only `insurance-workflow-alignment-20261108` was upgraded: final
chaincode `1.6.2-xgb-alignment`, sequence3, schema15, package SHA256
`15e313b50afa93ddaab5604c4ef48a4995fbac24b423fcdb3fa2ef193ce34cb4`.
Earlier1.6.0/1 and intermediate1.6.1/2 archives remain intact. All five peers
passed exact installed/approved/committed checks and25 runtime source-file
comparisons on final deployment. Recheck final retained state before activation.

The unchanged evaluator is `fabric-xgb-synthetic-v1`, hash
`4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4`;
frozen bundle hash
`e83eab8c8df7c9996471c754d352d9201ffd30246184c72cd1943c612d2ab380`.
Its documented numerical adapter is synthetic. No weights or thresholds were
changed. Runtime, tests and tooling remain independent of the Solidity checkout.

## Confirmed defects and scoped fixes

- A queued EFT installment remained DUE after OTP collected it. Bank-authorized
  reconciliation now links an exact existing payment and SETTLED transfer,
  without another debit, attempt, payment or transfer. Inconsistent, ambiguous
  and wrong-period linkage fails closed. A separate event prevents a second
  receipt. The original live failure and focused event failure are preserved.
- A local HTTP email receiver accepted a message then lost its response; retry
  lacked a stable key. Delivery now supplies a deployment/event/recipient-bound
  Idempotency-Key. The provider must implement that contract. An unmapped owner
  no longer falls back to an unrelated generic email address; fallback requires
  an explicit matching ledger subject. Original three component failures remain.
- A repeated live settlement test reused a global synthetic external reference.
  Chaincode correctly rejected it. Only the test reference became fixture-unique;
  duplicate-transfer protection was retained.

## Recorded checks

| Check | Result and boundary |
| --- | --- |
| Full Go suite, including exact paid-period reconciliation and authorization | PASSED; serial384MiB, network disabled, no ledger or identity mount |
| Web unit tests / typecheck / lint / production build | PASSED;100/100 unit tests at recorded source checkpoint |
| Live OTP/EFT race | PASSED; one collectible period, one valid debit, competing request conflicts |
| Live exact paid-period collection reconciliation | PASSED on final package |
| Corrected appeal | PASSED; new claim/evidence version, stale grant/vote denial, fresh Oracle request, four-person governance |
| Review expiry | PASSED; real deadline, insufficient approvals reject |
| Mid-commit worker restart | PASSED; two saved commitments, third worker absent, registry unavailable after restart, two matching reveals and unchanged journals |
| Actual Gateway uncertain commit | PASSED; saved status requests reconstructed after reconnect; code0 VALID versus code11 MVCC; only valid debit/credit applied |
| Final human approval / Bank settlement rerun | PASSED after fixture correction; original failure retained |
| Final premium/mandate/benefit lifecycle rerun | PASSED after Docker restart; original interrupted commit wait retained |
| Copied ciphertext restore, persistent OTP, persistent delivery retry | PASSED; owner and owner-offline assigned reviewer decrypt both documents, one debit, stable retry key and one accepted loopback delivery;503 OTP challenge revoked |
| Three distinct Oracle results / safe disagreement | PASSED; one honest and two different tampered local replicas, three different complete hashes, FAILED/CONFLICT, no approval; original wrong-field test assertion retained |
| Required context unavailable after source facts arrive later | PASSED; original snapshot stays unavailable and routes away from automatic approval |
| Model-only review with clean mandatory checks | PASSED; actual persisted worker observation mandatory=false, sole reason MODEL_THRESHOLD, score90,846,555 against frozen86,932,212 operating point |
| Final preserved-head and package/source audit | PASSED15/15 preserved peer/channel heads;5/5 exact installed/approved/committed packages and25 runtime source files |
| Final volume-retention audit | PASSED; four owned app/workers and16 owned containers stopped, all47 volumes unchanged, Docker29.9.2 healthy |

Evidence root: `.local-reference/alignment-2026-11-09-stage-b/`. Logs, original
traces, fixture identifiers, source hashes and final dispositions stay local.
These are API-driven Playwright tests where stated; no new browser UI coverage
is inferred from them. Existing320px role checks have their own dated report.

## Interpretation and pending acceptance

The first XGB_REVIEW fixture exercises a mandatory expected-range check together
with the frozen threshold. A separate final case reuses the paired baseline's
June dates, amount units and prior-history gap; its actual journal confirms a
model-only crossing, including the baseline's90,846,555 score. Retained later
records cannot enter that historical cutoff. Original harness failure assumed
Oracle1 must reveal, which is not required by exact2-of-3. The final test reads
an actual quorum participant and retains full model-only assertions.
The SDK uncertainty test proves real validation-code recovery, not a general
durable journal for every browser operation. A grant is authorization, not
decryption or user-exclusive custody. Local HTTP delivery is not external email
delivery. Existing historical studies retain their original source identities;
these tests support no new performance or classification claims.

The retained16 October audit's HIGH SECURITY-01 Go/toolchain/x/net followup is
still pending a coordinated builder update and fresh vulnerability verification.
Passing current Go tests does not resolve it. No fresh vulnerability scan was
performed here; that finding remains tied to its dated audit. Latest standalone
npm audit results are recorded separately in the CI report.

Preserved main/demo/audit activation remains owner-only and requires a reviewed
package/source, backup/recovery and acceptance plan. No preserved channel was
upgraded, no Git history was changed, and Solidity was left unchanged.
