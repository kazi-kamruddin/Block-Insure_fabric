# Settlement endorsement on dev-lite

20 November 2026, Asia/Dhaka. Synthetic, one host, live Fabric 2.5.16 on
`insurance-dev-lite-190`, chaincode 1.9.0 sequence 4, LevelDB.

The test supplied each of the ten two-organization pairs explicitly to
Fabric Gateway SDK 1.12.1. An authenticated Insurer administrator proposed
authorization and an authenticated Bank officer proposed confirmation.
The same synthetic claim, current panel certificate and account inputs
were held constant across the authorization proposals. The resulting
authorized settlement was then held constant across the confirmation
proposals. Successful envelopes were checked for the exact requested MSPs.

| Requested peer MSPs | AuthorizeSettlement | ConfirmSettlement |
| --- | --- | --- |
| Auditor + Bank | Rejected at endorsement | Rejected at endorsement |
| Auditor + Hospital | Rejected at endorsement | Rejected at endorsement |
| Auditor + Insurer | Rejected at endorsement | Rejected at endorsement |
| Auditor + Oracle | Rejected at endorsement | Rejected at endorsement |
| Bank + Hospital | Rejected at endorsement | Rejected at endorsement |
| Bank + Insurer | VALID, code 0 | VALID, code 0 |
| Bank + Oracle | Rejected at endorsement | Rejected at endorsement |
| Hospital + Insurer | Rejected at endorsement | Rejected at endorsement |
| Hospital + Oracle | Rejected at endorsement | Rejected at endorsement |
| Insurer + Oracle | Rejected at endorsement | Rejected at endorsement |

All 18 refusals occurred during simulation. The extra peers lacked the
private Bank account data for the public hash version. They generated no
committed INVALID records. The successful authorization transaction was
`481b1e70bea9fc274d6ad31bed85bd0fc4b1efff1c41fe8bd95fd392aba5dc09`.
The successful confirmation was
`52f7f245d0a07a7dc87e4f8c200f533dbf230acc400cb47a4d695140e5af4a11`.
The final settlement was CONFIRMED for BDT 40.00 with the same certificate
hash. The source decreased by 4,000 minor units and the destination
increased by 4,000.

The default chaincode policy is two of five. Both settlement operations
read private Bank accounts. Confirmation also writes collection state
with an explicit Bank AND Insurer policy. The conditional instruction to
add a per-key rule did not trigger because no pair without Bank could
authorize in the experiment. The evidence covers the deployed collection
membership, one panel claim and all pairs of two peers. It does not
establish authorization behavior after collection membership or code
changes, nor isolate the validator's behavior for an independently prepared
envelope. [Settlement implementation](../../chaincode/insurance-contract/src/decisions.go),
[collection policy](../../network/config/collections_config.json),
[Fabric Gateway 2.5](https://hyperledger-fabric.readthedocs.io/en/release-2.5/gateway.html).

The local machine-readable record is
`data/dev-lite/maintenance-endorsement-pairs.json`. It has 20 rows, requested
and actual endorsing MSPs when an envelope was returned, error stage,
validation code where applicable, and final ledger balance deltas. No
source code or Go test count changed for this experiment.
