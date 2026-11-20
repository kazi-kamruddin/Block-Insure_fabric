# Dev-lite certificate replacement and revocation drill

20 November 2026, Asia/Dhaka. Synthetic, one host, live Fabric 2.5.16 on the
isolated `insurance-dev-lite-190` channel.

The Bank CA issued a new enrollment certificate with the same Bank officer
role. The Auditor CA issued two disposable certificates for the same
assigned auditor. The active demo credentials stayed in place. Before the
update, all four tested credentials could evaluate their respective queries.
The Bank query required Bank private-data access. The auditor query checked
channel proposal acceptance.

The Auditor CA revoked just the disposable older certificate by serial,
and the channel MSP update recorded the signed CRL in config block 451.

| Enrollment | Before CRL | After CRL |
| --- | --- | --- |
| Current Bank | Accepted | Accepted |
| Replacement Bank | Accepted | Accepted |
| Disposable old auditor | Accepted | Rejected during proposal validation |
| Replacement auditor | Accepted | Accepted |

Local evidence is under `data/dev-lite/maintenance-revocation-drill/`.
The sanitized `before.json` and `after.json` record the distinct
credential fingerprints and query outcomes. The fetched
`updated-config.block` records the committed MSP update.

The later synthetic signer rehearsal also used those replacement
credentials for valid writes. The replacement auditor's approval vote
committed as
`aa356741e2044ad8279ef5cfc3a3d3ca43ff82f5d6e7bc6fdbf8388673ba80d2`.
The separate CLI used the replacement Bank certificate to confirm BDT
40.00 in transaction
`5b8ed1b940870a20160e62ef68c94d192fed94ec9b467586c7d3256b9411638b`.
The normal gateway confirmation path refused the same synthetic
settlement while configured for external signing. An operator with a
separate OS identity still needs to repeat that approval to establish
independent custody.

The disposable CouchDB migration ledger additionally exercised Bank
predecessor retirement. Both Bank certificates initially read the
same private account. The replacement confirmed a BDT 40.00 payout in
transaction `5c8e562307a8aed33e5b5f6a06f7a9fffe414e6d2b3d3fd4cb52c51654b72d38`.
After the BankMSP CRL committed in config block 81, the predecessor was
refused and the replacement still read the account. The working LevelDB
Bank enrollment stayed in place. Machine-readable records and the
fetched block are under
`data/dev-lite-couchdb/migration-rehearsal/bank-rotation/`.
