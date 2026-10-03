# Isolated hardening channel live gate — 3 October 2026

This record covers the current working tree on the local Fabric network. The test
channel is `insurance-phase2-hardening-20260927`; the preserved
`insurance-channel` definition remains version 1.4.0. The working tree was dirty
and no commit was made.

## Package and gate

- `create-hardening-channel.sh` joined all five business peers, committed
  `insurance-contract` version `1.4.1-hardening` at sequence 1 with all five
  organization approvals, and seeded the channel. Its package ID was
  `insurance-contract_1.4.1-hardening:bc7efaf5925738bd0ab1b23e4efaf186d416d0dc5fcf71a3ba0baeb074e003b0`.
- `audit-chaincode-package.sh` found all 22 packaged runtime files byte-for-byte
  identical to the current source and confirmed the same installed/approved
  package ID on all five peers.
- `scripts/verify-all.ps1` passed all 17 selected steps with network, browser,
  and dependency audit enabled. The saved local report is
  `verification-results/latest.json` (23:53:57 on 2 October to 00:08:26 on
  3 October, Asia/Dhaka). It covers web lint/type/unit tests, zero npm audit
  vulnerabilities, a production build, Oracle tests, Go tests, baseline Fabric
  topology, the main browser/live-workflow suite, and five separate Oracle
  scenarios: conflict, two-worker wrong majority, common-source wrong result,
  one-worker unavailability, and timeout fallback.
- `verify-private-collections.sh` passed using registered presentation
  `oracle-presentation-success-1790963976036-156657`: authorized reads of the
  Bank and Oracle-proof collections succeeded and excluded-peer reads failed.

The gate's baseline topology step checks the preserved main channel's 1.4.0
schema; the isolated package audit and browser workflows establish the 1.4.1
current-source result. The package/source comparison applies to Go runtime
files; a later presentation-only markup change does not change that package.

## Managed supervisor display

The managed web, event worker, premium collection worker, and three Oracle
workers were started on the hardening channel. `/api/fabric/health` reported
that exact channel and schema 14; `/api/health/ready` reported `ready` and all
three Oracles connected. `/showcase` returned HTTP 200. A real Edge browser
opened the presentation board and signed in as Insurer Administrator at
`http://localhost:3000/workspace/insurer`.

Visual review found that the showcase's closing checklist wrapped its text into
a 35-pixel grid column. Wrapping each item's text in one span fixed it; measured
text widths are 634 pixels at a 1440-pixel viewport and 319 pixels at a
390-pixel viewport. The corrected production build passed lint, TypeScript,
and build checks. Screenshots are local in `verification-results/`.

The managed supervisor script previously printed `127.0.0.1:3000`, while the
app's `APP_ORIGIN` is `http://localhost:3000`; browser login from the printed
address failed origin validation. The printed URL was corrected to `localhost`,
and browser login there passed. The health endpoint uses loopback without a
browser Origin header and still works.

The following existing test assets were reopened through the managed server;
their dossiers contained an Oracle request and confirmed settlement:

| Claim ID | Ledger outcome | Review rounds |
| --- | --- | ---: |
| `oracle-claim-success-1790963976036-156657` | `SETTLED`, `EXACT_CONSENSUS` | 0 |
| `oracle-claim-negative-1790964023922-422178` | `SETTLED`, `NEGATIVE_RESULT` | 1 |
| `oracle-claim-conflict-1790964210145-643870` | `SETTLED`, `CONFLICT` | 1 |

## Remaining presentation risks

- Host available memory fell below 0.5 GiB during deployment and browser work.
  Old experiment and inactive main-channel chaincode runtime containers were
  stopped without deleting volumes; avoid running another gate or heavy apps
  during the presentation. The earlier intermittent Ubuntu WSL timeout remains
  consistent with resource pressure but lacks a proven root cause.
- The hardening channel contains synthetic test assets and the showcase seed.
  Use the verified IDs above for a short read-only evidence route, or choose
  unique IDs for a new live journey. Do not claim that the preserved main-channel
  1.4.0 definition contains the hardening changes.
- Process restart/replay with a pending live transaction, external bank/clinical
  integration, and independent Oracle data provenance were not established by
  this gate. The thesis claims remain bounded by the local synthetic setup.
