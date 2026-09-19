# Block-Insure web application

This Next.js application is the server-side application boundary for the local
Fabric network. Browser code never reads Fabric certificates or private keys.
Server modules under `lib/fabric/` select a fixed organization identity for each
business operation and connect through Fabric Gateway.

## Local commands

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

The defaults work when commands run from `apps/web` and the generated network
material exists under `../../network/organizations`. Check application health at
`/api/health` and the live ledger connection at `/api/fabric/health`.

`SESSION_COOKIE_SECURE=false` is only for plain-HTTP local development. Set it to
`true` whenever the application is served behind HTTPS.

## Implemented routes

- `/api/fabric/health` evaluates `GetSchemaVersion` through Fabric Gateway.
- `/api/auth/*` creates and clears HMAC-signed, HTTP-only demo sessions.
- `/api/workflows` validates and role-gates ledger mutation commands.
- `/api/ledger/[assetType]/[id]` reads ledger assets and enforces policyholder ownership.
- `/api/audit/claims/[id]` lets insurer/auditor sessions export a consolidated
  ledger-backed claim history, evidence/access, verification, every review round
  and vote, appeal, advisory fraud assessment, and settlement dossier.
- `/api/evidence` stores an uploaded `.enc` ciphertext exactly once and commits
  its integrity/reference hashes; an origin-checked `POST` to `/api/evidence/[id]`
  records authorized access and returns ciphertext.
- `/api/internal/events/sync` replays committed chaincode events from a durable
  block/transaction checkpoint into an idempotent local operational projection.
  The repository-root checkpoint survives standalone rebuilds; its response
  reports `limitReached` if a scheduler should immediately request another batch.
- `/api/operations/notifications` and `/api/operations/events` expose role-filtered
  inbox records and auditable indexed events.
- `/research` and `/api/research/snapshot` provide a role-restricted,
  ledger-derived thesis dashboard and reproducibility-hashed JSON artifact.
- `/api/banking/otp` sends a policy/account-bound code through the configured
  email gateway; `/api/banking/premium-payment` consumes it once and atomically
  debits the customer account while crediting the insurer account.

## Supervised event worker

Set the same random `EVENT_WORKER_SECRET` (at least 32 characters) for the web
server and worker. With the web application already running, perform one full
catch-up or keep a supervised consumer running:

```powershell
npm run events:sync -- --once
npm run events:sync
```

The worker immediately requests another bounded batch when `limitReached` is
true, otherwise polls at `EVENT_WORKER_INTERVAL_MS`. Transient failures use
bounded exponential backoff and produce structured JSON logs. It accepts HTTP
only for a loopback URL; remote endpoints must use HTTPS. Process supervision
(for example a container restart policy or service manager) remains a deployment
responsibility.

## Automatic premium collection worker

Set `BANKING_WORKER_SECRET` for both the web application and worker. The worker
uses the configured `BANKING_BUSINESS_TIMEZONE` (default `Asia/Dhaka`) to run an
idempotent cycle:

```powershell
npm run banking:collect -- --once
npm run banking:collect
```

Each cycle creates deterministic on-ledger obligations for active mandates that
are due, then performs atomic BDT transfers to `INSURER_PREMIUM_ACCOUNT_ID`.
Restarting the worker cannot create a second collection for the same mandate and
due date. Insufficient customer funds produce a bounced transfer and leave the
policy premium unpaid.

- `/api/internal/banking/collections` is the bearer-protected EFT worker boundary;
  each due debit settles or bounces deterministically from the ledger balance.
- `/api/policies/[id]/statement` exports an ownership-filtered policy, premium,
  mandate, claim, benefit, and liability statement.
- `/workspace/<role>` provides canonical organization dashboards, guided
  transactions, browser evidence encryption/decryption, and an advanced JSON console.

The local identity registry includes four separately enrolled auditor accounts.
Review assignments are certificate-subject based; a default four-person panel
finalizes at three approvals or two rejections, and the policyholder may submit
one appeal after rejection.

Policyholders can create revocable evidence grants scoped by organization, role,
certificate subject, purpose, expiry, and access count. These grants authorize
ciphertext retrieval; passphrase/key distribution remains out of scope.

## Security boundary

The current identity map and signed sessions are local-development adapters,
not production authentication. Do not accept a Fabric role or identity label
directly from a browser request. Replace demo account selection with an
institutional identity provider before deployment.

The policyholder UI creates versioned AES-256-GCM `.enc` envelopes in the browser,
and authorized non-bank roles decrypt retrieved ciphertext in the browser after
the server records access on Fabric. Passphrases and plaintext never reach the
server. The application never stores encryption keys; key sharing/recovery remains
the users' responsibility in this demonstration. Replace local filesystem storage
with durable encrypted object storage and institutional key management before
production use. The complete format and limitations are documented in
`../../docs/evidence-security.md`.
