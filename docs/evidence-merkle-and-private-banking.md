# Evidence Merkle proofs and private Bank state

## Evidence commitment

Encrypted evidence remains in the off-chain ciphertext store. Fabric stores each
`EvidenceReference`, then an insurer administrator may publish an
`EvidenceMerkleBatch` covering 1–256 existing references. Evidence IDs are sorted
lexicographically before hashing. A leaf is the length-prefixed canonical SHA-256
commitment to the leaf-encoding version, evidence ID, claim ID/version, document
type, plaintext content hash, and encrypted-storage reference hash.

Parent nodes hash `0x01 || leftHashBytes || rightHashBytes`. An unpaired node is
duplicated. The batch stores the root, ordered evidence IDs, algorithm, encoding
version, count, publisher, and transaction timestamp. Chaincode recomputes the
root before accepting it; callers cannot publish an arbitrary manifest/root pair.

The application generates portable inclusion-proof JSON and chaincode independently
reconstructs its root through `VerifyEvidenceInclusion`. Claim dossier schema 6
embeds every applicable batch and proof. Modifying a leaf field, sibling hash,
direction, or anchored root makes `included=false`.

## Targeted private-data collection

`bankInsurerPrivateData` is the only configured PDC. Its member policy is
`BankMSP` or `InsurerMSP`, and its collection-level endorsement requires both
organizations. It has no block-to-live expiry in the local thesis environment.

Public `BankAccountReference` state contains the account ID, Bank/owner IDs,
account type, display label, masked number, BDT currency, lifecycle status, and
timestamps. The PDC contains only the account-token hash and simulated balance.
Opening values enter chaincode through the `bankAccountPrivate` transient field;
legacy public-argument registration is disabled. Transfers update both private
balances atomically while public transfer receipts retain IDs, amount, method,
status, and hashes.

Fabric PDC membership is organizational: every authorized InsurerMSP peer can
receive collection data. Chaincode additionally restricts merged reads to a Bank
officer, insurer administrator, or owning policyholder. HospitalMSP, AuditorMSP,
and OracleMSP peers do not receive the collection and cannot retrieve its state.
The application continues applying subject ownership checks before returning an
account to a policyholder.

Schema-10 development accounts are migrated by the showcase seeder through
`MigrateBankAccountPrivateState`, which writes their sensitive fields into the
collection and rewrites the public value without them. This is a local migration
aid, not a general production data-migration system.
