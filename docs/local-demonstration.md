# Local six-organization demonstration

This runbook demonstrates the permissioned insurance journey using the local
InsurerMSP, HospitalMSP, AuditorMSP, BankMSP, and OracleMSP business network plus
the development orderer. It assumes the documented
WSL2, Docker Desktop, Fabric, Go, and Node prerequisites are already available.

## 1. Confirm the network and contract

From Ubuntu WSL at the repository root:

```bash
bash network/scripts/network.sh up
bash network/scripts/deploy-chaincode.sh
bash network/scripts/network.sh verify
```

The verifier should report 17 healthy services, six reachable CAs, five ready
CouchDB instances, all five peers joined to `insurance-channel`, both Oracle
identities enrolled, chaincode `insurance-contract` 0.7.1, and schema version 6.

## 2. Start the supervised application stack

The normal start path is non-destructive and never replaces ledger data:

```powershell
.\scripts\demo-stack.ps1 Preflight
.\scripts\demo-stack.ps1 Start
.\scripts\demo-stack.ps1 Status
```

It supervises the standalone Next.js application, durable event worker, Oracle 1,
and Oracle 2. `Stop` stops application services and Fabric containers while
retaining ledger volumes; add `-KeepNetwork` to leave Fabric running.

The default `-OracleScenario Baseline` gives exact positive/negative agreement.
After stopping only the managed processes with `Stop -KeepNetwork`, use
`Start -OracleScenario Conflict` for the tracked divergent Oracle 2 snapshot or
`Start -OracleScenario Oracle2Unavailable` for a deliberate timeout. No source or
private-key edit is required during the presentation.

Only after deliberately approving loss of the local development ledger, create a
clean showcase with the small policy/benefit/Oracle catalog and no old claims:

```powershell
.\scripts\demo-stack.ps1 CleanBootstrap -ConfirmReset
```

The command refuses to reset anything unless `-ConfirmReset` is present.
It clears only this project's generated Fabric identities/channel/ledger volumes
and ignored evidence, event, Oracle cursor/health, and supervisor state before
seeding; tracked source and `reference/` are untouched.

### Manual alternatives

From Windows PowerShell in `apps/web`, prepare `.env.local` from `.env.example`,
set a local `AUTH_SECRET` of at least 32 characters, and enable demo authentication.
Then use either development mode:

```powershell
npm run dev
```

For automatic event catch-up, configure the same `EVENT_WORKER_SECRET` in the
web and worker environments, then start a second terminal in `apps/web`:

```powershell
npm run events:sync
```

Use `npm run events:sync -- --once` when only a pre-demonstration catch-up is
needed. Stop the continuous worker with Ctrl+C.

or the deployable standalone build:

```powershell
npm run build
$env:HOSTNAME = "127.0.0.1"
$env:PORT = "3000"
npm run start
```

Open `http://localhost:3000/workspace`. Fabric certificates and private keys
remain server-side throughout the demonstration.

## 3. Complete the governed journey

Use unique IDs for every rehearsal. The guided forms hash sensitive references
inside the browser and convert BDT values to exact integer poisha.

1. **Insurer Administrator** — create a package, publish it, issue a policy to
   `policyholder1`, then optionally retire the package to prove existing policy
   snapshots remain valid.
2. **Policyholder One** — submit a claim against that policy. In the evidence
   panel, provide the claim/evidence IDs, choose a small original document, enter
   and safely retain a passphrase, encrypt in the browser, then store the
   ciphertext reference. Create an expiring/use-limited grant for a specific
   organization, role, certificate subject, and retrieval purpose.
3. **Hospital Officer** — open the submitted claim from the verification queue,
   optionally retrieve/decrypt evidence with the shared demonstration passphrase,
   then record `VERIFIED` or `INVALID`.
4. **Insurer Administrator** — record the transparent advisory fraud assessment,
   then request two-Oracle verification with `registry-demo-v1`, `model-v1`,
   assigned subjects `oracle1`/`oracle2`, and future commit/reveal deadlines.
5. **Oracle 1 and Oracle 2 services** — independently consume the committed request,
   query their own registry snapshots, submit salted commitments, and reveal only
   after the commit phase. Show identities, sources, progress, and latency in the
   Oracle operations panel.
6. **Automatic success path** — use the `11…11` registry lookup and matching claim
   description to demonstrate exact positive consensus. The claim becomes
   `APPROVED`; the insurer then authorizes settlement and BankMSP confirms it.
7. **Failure/fallback path** — use the `22…22` lookup and matching negative record.
   Both Oracles agree on `RECORD_INVALID`, producing `ORACLE_FAILED`. The insurer
   routes that request into a new four-auditor review with immutable assignments,
   quorum thresholds, and a deadline.
8. **Independent Auditors One through Four** — inspect assigned claim/evidence
   and cast certificate-bound `APPROVE` or `REJECT` votes. Three approvals or two
   rejections finalize the default 3-of-4 review; duplicate votes are rejected.
9. **Policyholder One** — if the manual review rejects the claim, submit the
   single permitted appeal. The insurer opens a new round and a fresh quorum can
   overturn or uphold the decision without erasing round-one votes.
10. **Insurer Administrator** — authorize a settlement for an approved claim.
11. **Bank Officer** — confirm the authorized settlement using an external payment
   reference; only its browser-generated hash is written to the ledger.
12. **Policyholder One** — read the claim and confirm its final state is `SETTLED`.
13. **Insurer Administrator or an assigned Independent Auditor** — list evidence access records
   and show the immutable role/purpose trail created by retrievals. Enter the
   claim ID in **Export claim dossier** to download the consolidated JSON artifact.
14. **Insurer Administrator** — synchronize committed Fabric events. Show the
    transaction-aware checkpoint and role inbox, then open the thesis dashboard
    and download its reproducibility-hashed JSON snapshot.

Each account is redirected to its canonical role workspace and cannot navigate
into another role's route. Chaincode independently rechecks MSP and certificate
attributes even if the application boundary is bypassed.

## 4. Run the reproducible integrity gate

From the repository root in Windows PowerShell:

```powershell
.\scripts\demo-stack.ps1 Stop -KeepNetwork
.\scripts\verify-all.ps1
.\scripts\demo-stack.ps1 Start
```

Stop the managed application processes while retaining Fabric before the gate.
This lets Next.js replace its standalone build on Windows and gives Playwright
exclusive Oracle ports for the baseline, divergent-snapshot, and unavailable-
Oracle phases. The verifier fails early with this instruction if those ports are
occupied; restarting afterward reopens the supervisor-ready Baseline stack.

This runs lint, TypeScript, unit and cryptographic tests, dependency audit,
event-worker syntax validation, Oracle worker tests and health, standalone production build, Go chaincode tests,
live Fabric topology/schema
verification, role isolation, WCAG 2.1 AA checks, encrypted evidence
round-trip/access logging, multi-auditor appeal adjudication, automatic Oracle
settlement, negative-result auditor fallback, isolated conflict and timeout
fallbacks, and the existing multi-session workflows.
The ignored result is written to `verification-results/latest.json`, including
the commit/branch, dirty-tree flag, selected gates, runtime versions, and timings.

The browser workflow creates uniquely named ledger records. Use the local
development network for rehearsals; do not point it at shared or production state.
