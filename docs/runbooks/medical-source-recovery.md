# Medical Oracle source recovery

Run the source check from the Fabric repository with the approved LevelDB
dev-lite network running.

```powershell
node scripts/medical-source-preflight.mjs --live
```

The Insurer Gateway evaluates `ListMedicalOracleSources` and reads the
associated episode views and benchmark registration history for incomplete
records. It prints the hospital, service, episode identifier and diagnostic
reason. The snapshot proposal page also shows an incomplete-source count
for the selected hospital.

| Result | Recovery |
| --- | --- |
| `UNVERIFIED_ASSOCIATION` | In the Insurer Customers workspace, compare the Hospital patient reference with the verified member record. Resolve the episode association for the current revision. |
| `MISSING_BENCHMARK` | As Insurer, register a reference for the hospital and service. Use the actual approved tariff range, licence status and source hash. Confirm the invoice date separately. |
| `MISSING_INVOICE_DATE` | In the Hospital Patient billing workspace, save the correction using the same episode reference, the current revision and the actual invoice date. The Insurer must confirm the association for the current episode as needed. |
| `INVOICE_DATE_OR_PRIVATE_BENCHMARK_UNAVAILABLE` | The registration is recorded, but this read cannot prove its private value was available at the peer. Confirm the invoice date with the Hospital and investigate collection availability if the billing date is present. |
| `EPISODE_READBACK_UNAVAILABLE` | Refresh the listing and compare the current episode revision. A concurrent correction can change the revision between evaluates. |

The recovery steps use ordinary ledger transactions and need the owner's
approval on the preserved demonstration ledger. After a correction, have the
claimant accept the revised reimbursement where required, then propose and
have the Hospital attest a refreshed snapshot before retrying the automatic
path. Claims with incomplete Oracle sources can proceed through the governed
auditor panel.

The current chaincode withholds both invoice facts and the benchmark hash for
an incomplete source. A valid registration establishes that the benchmark was
committed. A complete source for the same hospital and service also establishes
that the peer could read it during the source check.
