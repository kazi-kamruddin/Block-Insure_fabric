# Evidence encryption and access boundary

Block-Insure Fabric keeps medical-document plaintext and encryption secrets out
of Hyperledger Fabric and out of the Next.js server. In the local demonstration,
the policyholder's browser encrypts a selected file and uploads only the resulting
binary envelope. Fabric stores integrity metadata and every authorized retrieval
event, not the document bytes.

## Browser envelope version 1

The `.enc` file uses this deterministic header followed by authenticated
ciphertext:

| Offset | Length | Value |
|---:|---:|---|
| 0 | 4 | ASCII magic `BIF1` |
| 4 | 4 | unsigned big-endian PBKDF2 iteration count |
| 8 | 16 | random PBKDF2 salt |
| 24 | 12 | random AES-GCM IV |
| 36 | remaining | AES-256-GCM ciphertext and 128-bit authentication tag |

The browser derives a non-exportable AES-256 key from the passphrase using
PBKDF2-HMAC-SHA-256 with 310,000 iterations. AES-GCM authenticates both the file
and this additional data:

```text
block-insure-fabric:evidence:v1:<claimId>:<evidenceId>
```

That binding prevents a valid ciphertext from being silently moved to another
claim or evidence record. The browser also computes the original plaintext's
SHA-256 digest. Only that digest, document type, safe storage-reference hash,
claim ID, evidence ID, and submitting identity are committed to Fabric.

## Retrieval path

1. An authenticated non-bank user submits an origin-checked `POST` to
   `/api/evidence/<evidenceId>`.
2. The server reads the evidence reference and claim from Fabric and checks the
   caller's role, organization, ownership, and current workflow state.
3. The server verifies the storage reference, loads ciphertext, and commits an
   `EvidenceAccessRecord` through the caller's organization identity.
4. The response returns ciphertext with its ciphertext hash, expected plaintext
   hash, and ledger-derived claim ID in private/no-store headers.
5. The browser derives the key, authenticates/decrypts the envelope, recomputes
   the plaintext digest, and enables download only when it matches Fabric.

Hospital retrievals are recorded with purpose `VERIFY`, auditor retrievals with
`AUDIT`, and insurer/policyholder retrievals with `DOWNLOAD`. Bank identities are
not permitted to retrieve medical evidence.

## Security properties and limitations

- The passphrase is held only in browser memory and is cleared from the form
  after encryption or successful decryption.
- The server cannot recover a lost passphrase. A lost passphrase means the
  ciphertext is unrecoverable.
- AES-GCM detects incorrect passphrases, modified ciphertext, and changed
  claim/evidence binding.
- PBKDF2 slows offline guessing but cannot make a weak passphrase safe. The UI
  enforces only a 12-character minimum for the local demonstration.
- Local filesystem ciphertext storage is a development adapter. Production
  requires durable encrypted object storage, retention/backup policy, malware
  controls, institutional key recovery/escrow policy, and secure identity
  lifecycle management.
- This design does not copy the Ethereum reference's proxy re-encryption scheme.
  Adding delegated key grants requires an explicit organizational key-management
  design; Fabric membership alone cannot distribute a browser-held passphrase.

The implementation is in `apps/web/lib/evidence/browser-crypto.ts`, with
cryptographic round-trip, wrong-passphrase, and claim-rebinding tests.
