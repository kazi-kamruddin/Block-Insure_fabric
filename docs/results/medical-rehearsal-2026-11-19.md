# Medical Fabric deployment and browser rehearsal

The isolated medical candidate completed one simulated BDT 40.00 Bank payout
from a browser-submitted medical claim on 19 November 2026 (Asia/Dhaka).

| Deployment identity | Verified value |
| --- | --- |
| Channel | `insurance-medical-reimbursement` |
| Chaincode | `insurance-contract`, `1.7.0-medical`, sequence 1, schema 15 |
| Package SHA-256 | `29a873fb43d093482b53f536e8ce83c1a76da7c1a79152c3bee61538d7d53594` |
| Source check | All 30 runtime files matched the archive built from the medical source retained in `da525ed` |
| Peer checks | All five peers reported the exact installed package, approval, committed definition and schema |
| Evaluator | `fabric-xgb-synthetic-v1`, `4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4` |

The final browser run passed 1/1 with zero retries. It published a medical
policy, accepted its terms, paid the first installment with a local demo OTP,
saved the hospital intake, proved the episode stayed hidden until insurer
verification, and proved the medical API refused the old hospital model-fact
write. The verified episode populated a claim with an accepted statement.
The synthetic BDT 500.00 bill was capped at BDT 80.00 of eligible charges,
with a BDT 8.00 deductible and a BDT 57.60 insurer share before the remaining
BDT 40.00 policy limit. This live fixture differs from the BDT 100.00 unit
example at the bill amount. Both use the same limit and yield BDT 40.00.

All three Oracle workers reported the same positive frozen XGBoost result for
request `oracle-8d2b35e5-73f8-4246-8b2b-076c291697cb`, claim version 1,
using the existing two-of-three matching rule. The insurer authorized a payout
and the Bank confirmed `med-payout-075a1d3e-a2c`. A duplicate was denied and an
independent Bank readback found exactly one claim payout across the channel.
The customer balance went from BDT 99.00 after premium to BDT 139.00, and the
funded reserve fell from BDT 100.00 to BDT 60.00. The claim finished settled.

The first guarded startup hit a Windows-reserved TCP port. Compose now supports
an optional Oracle host port, propagated through the candidate launcher,
Gateway endpoint and read-only verification. The medical run used 23051 and
retained 13051 as the default. Two partial browser attempts are retained:
the first stalled selecting a valid package due to an exact locator, and the
second stalled after the OTP debit because the test waited for a consumed
button to become enabled. Neither made a claim payout. The corrected test
checks the paid policy through the ledger and preserves the duplicate payout
assertion. The missed app readiness wait was due to sequential package
compilation. A longer readiness wait succeeded.

The four preserved channels had identical heights and current and previous
block hashes on all five peers before and after. All 49 original Docker volumes
were retained. Work was local and used existing enrolled identities, a separate
medical state directory and synthetic records. The medical definition and
fixture state remain on the medical channel for reuse. The preserved demo build
was outside the medical build directory. After verification, five owned app
processes and 16 owned containers were stopped. Docker remained healthy and the
rehearsal listeners were released.

Local evidence is under `.local-reference/medical-reimbursement-20261118/live/`.
Its `browser-03/report.json`, `payout-verified.json`, `warm-170.log`,
`preservation.json` and `resource-shutdown.json` record the result. Earlier
startup logs and partial browser traces remain in the same local evidence root.
The two-minute browser duration is a functional rehearsal time.

To resume, use the [medical runbook](../medical-reimbursement-candidate.md)
with the same channel and private state. Preserve the settled fixture rather
than executing another confirmation against it. A repeat Playwright run uses
fresh fixture IDs. On this populated channel set `MEDICAL_BENCHMARK_EXISTS=true`
only after confirming the documented synthetic benchmark remains registered.
