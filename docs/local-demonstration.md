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
`insurance-contract` 0.3.0, and schema version 2.

## 2. Start the application

From Windows PowerShell in `apps/web`, prepare `.env.local` from `.env.example`,
set a local `AUTH_SECRET` of at least 32 characters, and enable demo authentication.
Then use either development mode:

```powershell
npm run dev
```

or the deployable standalone build:

```powershell
npm run build
$env:HOSTNAME = "127.0.0.1"
$env:PORT = "3000"
npm run start
```

Open `http://127.0.0.1:3000/workspace`. Fabric certificates and private keys
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
   ciphertext reference.
3. **Hospital Officer** — open the submitted claim from the verification queue,
   optionally retrieve/decrypt evidence with the shared demonstration passphrase,
   then record `VERIFIED` or `INVALID`.
4. **Insurer Administrator** — move a verified claim into independent review.
5. **Independent Auditor** — inspect the claim/evidence and record `APPROVE` or
   `REJECT`.
6. **Insurer Administrator** — authorize a settlement for an approved claim.
7. **Bank Officer** — confirm the authorized settlement using an external payment
   reference; only its browser-generated hash is written to the ledger.
8. **Policyholder One** — read the claim and confirm its final state is `SETTLED`.
9. **Insurer Administrator or Independent Auditor** — list evidence access records
   and show the immutable role/purpose trail created by retrievals.

Each account is redirected to its canonical role workspace and cannot navigate
into another role's route. Chaincode independently rechecks MSP and certificate
attributes even if the application boundary is bypassed.

## 4. Run the reproducible integrity gate

From the repository root in Windows PowerShell:

```powershell
.\scripts\verify-all.ps1
```

This runs lint, TypeScript, unit and cryptographic tests, dependency audit,
standalone production build, Go chaincode tests, live Fabric topology/schema
verification, role isolation, WCAG 2.1 AA checks, encrypted evidence
round-trip/access logging, and the complete five-session settlement workflow.
The ignored result is written to `verification-results/latest.json`.

The browser workflow creates uniquely named ledger records. Use the local
development network for rehearsals; do not point it at shared or production state.
