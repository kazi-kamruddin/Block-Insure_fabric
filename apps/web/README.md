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
- `/api/evidence` stores an uploaded `.enc` ciphertext exactly once and commits
  its integrity/reference hashes; `/api/evidence/[id]` retrieves authorized ciphertext.
- `/workspace` provides a role-aware local demonstration console.

## Security boundary

The current identity map and signed sessions are local-development adapters,
not production authentication. Do not accept a Fabric role or identity label
directly from a browser request. Replace demo account selection with an
institutional identity provider before deployment.

The evidence API accepts only files named `.enc`; callers are responsible for
client-side encryption and key distribution. The application never stores those
encryption keys. Replace local filesystem storage with durable encrypted object
storage before production use.
