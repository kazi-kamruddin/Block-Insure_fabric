# WebAuthn receipt for claimant intent

The claimant can attest to a particular operation with an enrolled platform or
roaming authenticator. The Gateway retains the Fabric signer. This design
adds a record of the operation the claimant confirmed.

## Challenge and binding

Generate a 32-byte random nonce for each attempt. Persist it server-side with
the authenticated customer ID, credential allowlist, requesting origin and
expiry. Canonically encode the operation name, ledger provisioning ID,
customer ID, claim ID, revision or terms hash and nonce under the domain
`fabric-customer-intent-v1`. Use the SHA-256 digest of those bytes as the
WebAuthn challenge. For initial policy acceptance use the preallocated
operation ID in the claim slot and bind the issued terms hash.

Before requesting the assertion, display the exact terms or claim revision
and operation. The payload refers to that view's hash. The relying-party
screen is responsible for the presentation. Typical authenticators confirm
user presence or verification without displaying the insurance fields.

## Verification and execution

Verify the assertion against the registered credential, the origin and RP ID,
the exact challenge, and the required user-verification flag. Enforce expiry
and the account's eligibility. Consume the nonce atomically with an intent
record in the workflow journal. If the send outcome is ambiguous, recover
that journal entry using the same operation ID. A fresh assertion is needed
when material terms, claim version, account, ledger or operation changes.

Record the SHA-256 hash of the assertion alongside the claim or terms
acceptance in a future certificate revision. Keep the original assertion and
credential metadata in restricted off-chain storage under the retention
policy. Exports can disclose the receipt and operation binding to authorized
reviewers. The ledger commitment binds the receipt bytes to the operation.

## Optional pilot

Start with one synthetic medical submission and an off-chain journal receipt.
Use fixtures for expiry, replay, origin mismatch, changed terms, a different
ledger instance, simultaneous consumption and a lost response. Evaluate
enrollment recovery and the accessible confirmation screen before extending
the receipt to live Fabric.
