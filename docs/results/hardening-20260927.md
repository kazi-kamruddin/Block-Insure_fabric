# Hardening follow-up — 2026-09-27

This work follows the Phase 2 study. It changes the current source tree but does not revise the historical Phase 2 measurements. The preserved `insurance-channel` and `insurance-phase2-20260926` ledgers were not written during this follow-up.

## Implemented

- Revoking an invoice or policy privacy credential now prevents an already registered presentation from starting a new Oracle request. A positive Oracle reveal also rechecks credential status and expiry. The worker returns `PRIVACY_CREDENTIAL_INACTIVE` for a revoked or expired source credential. Historical presentation registration remains an audit record.
- Only the credential's exact issuing identity may revoke it. The UI exposes revocation to the Hospital issuer and insurer administrator.
- A policyholder can read private presentation data only when they own the associated claim. The ledger API no longer brokers private Bank account values to auditor sessions, and the auditor dashboard no longer fetches those values.
- Browser scenarios now cover two matching divergent Oracle workers, an anchored common-source counterexample with an explicitly synthetic external truth label, credential revocation after presentation registration, settlement bounce and retry, an auditor vote after review closure, EFT bounce, payment replay, and ciphertext tampering at decryption.
- A durable event projection test reloads a checkpoint from disk and rejects a replayed event. Existing worker tests cover Oracle cursor and health checkpoint persistence.
- `benchmarks/caliper/robustness.yaml` rotates five seeded policy and Hospital invoice fixtures across 200-transaction rounds in a shuffled rate order. `run.ps1 -Profile robustness` selects that profile; the original 19-round profile remains available.
- `network/scripts/create-hardening-channel.sh` prepares an isolated `insurance-phase2-hardening-20260927` channel with chaincode version `1.4.1-hardening`. `network/scripts/verify-private-collections.sh` probes both private collections from authorized and excluded peers.

## Verified locally

- Web lint and type check passed after the latest application changes.
- Web unit suite passed: 20 files, 56 tests.
- Oracle worker syntax and 17 unit tests passed.
- The production build passed before the final API and test edits; those later edits passed lint and type check.
- Playwright discovered 39 browser tests, including the new scenarios. This is discovery, not execution.
- Bash syntax checks passed for the new channel and private collection scripts and the updated fixture seeder. The robustness YAML parsed as 10 rounds, both workload files passed `node --check`, and the PowerShell runner parsed without errors.
- Go chaincode tests passed earlier in this follow-up after the revocation change, before the later private-read authorization and late-vote test edits. Those final Go edits still need a fresh Go run.

## Live verification still required

The local Docker API hung after Fabric startup, and Ubuntu WSL subsequently failed to start with `Wsl/Service/CreateInstance/E_FAIL`. A separate `npm audit` attempt could not reach the npm registry. No live browser, private collection, restart, or Caliper result is claimed for this source tree.

Once Docker and WSL are healthy, run on the new isolated channel:

1. `bash network/scripts/create-hardening-channel.sh` from Ubuntu WSL. Set `FABRIC_CHANNEL_NAME=insurance-phase2-hardening-20260927` for the application, three Oracle workers, verification script, and Caliper.
2. `./scripts/verify-all.ps1` to run the current-source gate, including new Oracle browser scenarios. Capture the report and any failures before interpreting results.
3. With a presentation ID created by the live suite, run `FABRIC_CHANNEL_NAME=insurance-phase2-hardening-20260927 bash network/scripts/verify-private-collections.sh <presentation-id>` from Ubuntu WSL.
4. Run `bash benchmarks/caliper/seed-load-fixture.sh` and `./benchmarks/caliper/run.ps1 -RunId hardening-robustness-1 -Profile robustness` for repeated robustness trials. Compare results with the original profile only after successful runs and resource sampling.
5. Restart the Oracle worker, web event worker, and premium collection worker against pending transactions on this isolated channel. Confirm cursor replay, projection checkpoint, ciphertext retrieval/decryption, and collection status after restart. The file persistence and replay tests above do not replace these process restart tests.

Two agreeing wrong workers and a shared wrong source are explicit limits of exact 2-of-3 consensus. Independent Oracle organizations and independent source providers remain an architectural follow-up; they are not implemented here.
