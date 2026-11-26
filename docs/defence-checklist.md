# Defence checklist

Working defence date 15 January 2027, Asia/Dhaka. Use the actual January date when it is known.

- Select only the retained LevelDB dev-lite ledger. Check the committed package, sequence and ledger marker with the matching [profile](../scripts/profiles/dev-lite-190.json) and [provenance](provenance.md).
- Check Windows and peer clocks within five seconds and gossip membership for the peers used by each private collection.
- Validate the policy calendar with `node scripts/validate-dev-lite-seed.mjs --defence-date 2027-01-15 --live`.
- Use the [walkthrough](defence-walkthrough.md) and keep the [R1 live evidence](results/r1-journeys-2026-11-25.md) available. Obtain a quiescent independent peer readback for any dossier presented as verified.
- Use one production web process. Run the production build, Go, TLC and offline Playwright with Fabric stopped. A live read-only Chromium capture needs a 900 MB immediate memory reading. [Session A memory and capture evidence](runbooks/defence-memory-plan.md#session-a-measurement-26-november-2026) · [Walkthrough](defence-walkthrough.md)
- Keep the verified backup manifest and original local credential stores available. Do not display keys, evidence passphrases or OTP values in the presentation.

## Limits

The demonstration runs on one 8 GB Windows/WSL host with one orderer. One shared ccaas process is a common failure domain. The three Oracle subjects share OracleMSP, and the Hospitals share HospitalMSP. The institutions, S-B regulator data and BDT settlement are simulated. Agreement and signature verification establish consistency and integrity under the modelled trust assumptions. Clinical truth and real fraud detection accuracy were outside the evaluation. [Dated R2 latency](results/r2-latency-2026-11-26.md) · [Synthetic replay](results/challenger-replay-2026-11-25.md)

The Gateway holds Fabric signing identities. Authorized browsers manage evidence decryption material. The separate Windows Bank operator drill is `NOT-RUN (owner drill)` absent evidence. Long calendar windows are covered through Go tests. The A6/U28 SBE pilot, U30 public data minimization and K19 multi-service packages were dropped under the memory-first scope decisions. Historical public data remains on the ledger. U46 leaves shared Oracle counters in place. The single DEMO pass recorded 20 code-11 conflicts across four requests, split evenly between commitment and reveal. The study reports latency and observed conflicts on the one host. [Measured U46 limitation](results/r2-latency-2026-11-26.md#mvcc-attribution)

Clock tolerance is a stated limit. Every chaincode clock reads the proposal timestamp, accepted within ±15 s of the peer. Since sequence 4 that tolerance can change only *when* sealing ends, by up to 15 s, never *whether* a value chosen after a reveal can count: the first reveal closes sealing in state for Oracle commitments and panel ballots. If asked how this was found, the pre-freeze audit reproduced the backdated copy in Go, and the fix was deployed as sequence 4 the same day. [Session C record](results/session-c-2026-11-26.md)

## Before the meeting

- Keep at least 2 GB free on drive C. Docker Desktop's engine stopped once on 26 November while C had about 0.2 GB free, then recovered on its own.
- Close browsers with many tabs. The full stack needs 700 MB available for writes and 900 MB for a screenshot pass.
- Run `r2-demo.ps1 Start`, then `Status`, and check sequence 4, DEMO, three workers, six adapters and `BusinessMemoryReady : True`. If the preflight's definition readback says "unavailable" right after startup, run it once more before investigating.
