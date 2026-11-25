# Defence checklist

Working defence date 15 January 2027, Asia/Dhaka. Use the actual January date when it is known.

- Select only the retained LevelDB dev-lite ledger. Check the committed package, sequence and ledger marker with the matching [profile](../scripts/profiles/dev-lite-190.json) and [provenance](provenance.md).
- Check Windows and peer clocks within five seconds and gossip membership for the peers used by each private collection.
- Validate the policy calendar with `node scripts/validate-dev-lite-seed.mjs --defence-date 2027-01-15 --live`.
- Use the [walkthrough](defence-walkthrough.md) and keep the [R1 live evidence](results/r1-journeys-2026-11-25.md) available. Obtain a quiescent independent peer readback for any dossier presented as verified.
- Use one production web process. Run the production build, Go, TLC and Playwright after stopping Fabric. Start workers and adapters only for the relevant segment.
- Keep the verified backup manifest and original local credential stores available. Do not display keys, evidence passphrases or OTP values in the presentation.

## Limits

The demonstration runs on one 8 GB Windows/WSL host with one orderer. The candidate shared ccaas process is a common failure domain. The three Oracle identities and separate adapters model scoped roles on the same physical host. Hospitals share HospitalMSP. The simulated source institutions and BDT settlement are local. Authorized actors can collude or agree on false inputs without an independent observation. The archived ML cohorts are synthetic and lack external clinical validation.

The Gateway holds Fabric signing identities. Authorized browsers manage evidence decryption material. The separate Windows Bank operator drill is `NOT-RUN (owner drill)` absent evidence. Long calendar windows are covered through Go tests. The A6/U28 SBE pilot, U30 public data minimization, K19 multi-service packages and U46 per-actor vote-key optimization were dropped under the memory-first scope decisions. Historical public data remains on the ledger.
