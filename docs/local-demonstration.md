# Local five-organization demonstration

This runbook demonstrates the permissioned insurance journey using the local
InsurerMSP, HospitalMSP, AuditorMSP, and BankMSP network. It assumes the documented
WSL2, Docker Desktop, Fabric, Go, and Node prerequisites are already available.

## 1. Confirm the network and contract

From Ubuntu WSL at the repository root:

```bash
bash network/scripts/network.sh up
bash network/scripts/deploy-chaincode.sh
bash network/scripts/network.sh verify
```

The verifier should report 14 healthy services, five reachable CAs, four ready
CouchDB instances, all four peers joined to `insurance-channel`, chaincode
`insurance-contract` 0.6.1, and schema version 5.

## 2. Start the application

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
   then open an independent review with immutable auditor assignments, quorum
   thresholds, and a deadline.
5. **Independent Auditors One through Four** — inspect assigned claim/evidence
   and cast certificate-bound `APPROVE` or `REJECT` votes. Three approvals or two
   rejections finalize the default 3-of-4 review; duplicate votes are rejected.
6. **Policyholder One** — if the initial review rejects the claim, submit the
   single permitted appeal. The insurer opens a new round and a fresh quorum can
   overturn or uphold the decision without erasing round-one votes.
7. **Insurer Administrator** — authorize a settlement for an approved claim.
8. **Bank Officer** — confirm the authorized settlement using an external payment
   reference; only its browser-generated hash is written to the ledger.
9. **Policyholder One** — read the claim and confirm its final state is `SETTLED`.
10. **Insurer Administrator or an assigned Independent Auditor** — list evidence access records
   and show the immutable role/purpose trail created by retrievals. Enter the
   claim ID in **Export claim dossier** to download the consolidated JSON artifact.
11. **Insurer Administrator** — synchronize committed Fabric events. Show the
    transaction-aware checkpoint and role inbox, then open the thesis dashboard
    and download its reproducibility-hashed JSON snapshot.

Each account is redirected to its canonical role workspace and cannot navigate
into another role's route. Chaincode independently rechecks MSP and certificate
attributes even if the application boundary is bypassed.

## 4. Run the reproducible integrity gate

From the repository root in Windows PowerShell:

```powershell
.\scripts\verify-all.ps1
```

This runs lint, TypeScript, unit and cryptographic tests, dependency audit,
event-worker syntax validation, standalone production build, Go chaincode tests,
live Fabric topology/schema
verification, role isolation, WCAG 2.1 AA checks, encrypted evidence
round-trip/access logging, multi-auditor appeal adjudication, and the complete
multi-session settlement workflow.
The ignored result is written to `verification-results/latest.json`, including
the commit/branch, dirty-tree flag, selected gates, runtime versions, and timings.

The browser workflow creates uniquely named ledger records. Use the local
development network for rehearsals; do not point it at shared or production state.
