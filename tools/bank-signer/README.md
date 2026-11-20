# Dev-lite Bank signer

This tool is for the dev-lite channel and Bank peer on port 31351. It requires
the checkout's installed web dependencies, a separate interactive terminal,
and explicit paths to the dev-lite Bank enrollment files.

Set `FABRIC_DEV_LITE_BANK_CUSTODY=external` for the dev-lite gateway only
after granting the Bank operator's OS account access to its signer key and
denying the gateway account access to that key and any copies. The gateway
then refuses Bank Fabric connections, including Bank-private reads and
operations such as account provisioning. Provision the synthetic fixture first.
These controls assume the operator and gateway share a workstation and use
different OS identities or an equivalent key isolation mechanism.

From a Bank-authenticated session, POST a normal `confirmSettlement`
command to `/api/medical/bank-signing-request`. Save the returned request JSON
and hand it to the Bank operator. The endpoint generates an unsigned request.

Run `node tools/bank-signer/confirm-dev-lite.mjs REQUEST_JSON BANK_CERT BANK_KEY DEV_LITE_BANK_PEER_TLS_CA`
as that operator. The CLI signs read-only evaluations to obtain the current
claim, settlement and certificate directly from the peer. Compare the claim
version, settlement ID, amount, accounts, transfer ID and certificate hash
before entering the confirmation shown. The CLI re-reads the ledger and
signs the settlement proposal and endorsed transaction only after assent.
It checks commit status separately. If the commit response is lost, inspect the
displayed settlement ID on the ledger before preparing another request.

Synthetic tests exercise request validation, explicit approval and changing
ledger state with `node --test tools/bank-signer/confirmation.test.mjs`.
The live custody and operator confirmation checks require an isolated
OS account or secure storage with an explicit access check.
