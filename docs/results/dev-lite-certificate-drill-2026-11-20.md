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

This establishes live endorser rejection of one revoked enrollment and
successful reads with both replacement credentials on this deployment.
Bank application cutover and old Bank retirement remain operator actions.
No production key migration, transaction signed by the replaced auditor,
or cross-host custody was demonstrated.
