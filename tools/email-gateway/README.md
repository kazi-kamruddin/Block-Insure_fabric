# Local Brevo email connector

Without this connector, the dev-lite app shows OTP codes on screen. With it,
the app sends OTP codes and Bank notices as real email through Brevo's free
transactional email API. Use it only for synthetic demo data.

The connector listens on `127.0.0.1:3330` and implements the app's existing
`EMAIL_GATEWAY_URL` contract: `POST /send` with `{to, template, variables}`
returns `{messageId}`. It sends only to recipients listed in its config, so a
synthetic address such as `policyholder1@block-insure.demo` reaches the real
address you map it to, and an unmapped address is refused.

## Set up (owner only)

1. Create a free Brevo account and verify a sender address under
   **Senders, Domains & Dedicated IPs**.
2. Create an API key under **SMTP & API → API Keys**.
3. Create `data/dev-lite/email-gateway.json`. The `data/` folder is
   git-ignored; never put this file anywhere else in the repository.

   ```json
   {
     "apiKey": "xkeysib-…",
     "sender": { "email": "your-verified-sender@example.org", "name": "Block-Insure demo" },
     "recipients": { "policyholder1@block-insure.demo": "the-address-to-receive-codes@example.org" }
   }
   ```

4. Start the app with email enabled:

   ```powershell
   .\scripts\dev-lite-app.ps1 -TwoOracles -Email
   ```

The start script launches the connector, waits for its `/health` check and
passes it the shared `EMAIL_GATEWAY_TOKEN` from `app-secrets.json`. The
connector logs only the template name and Brevo message ID, never the code.

If the demo room has no internet, start without `-Email`; the code then
appears on screen as before.

Tests: `node --test tools/email-gateway/gateway.test.mjs` (Brevo is replaced
by a stub; no network access).
