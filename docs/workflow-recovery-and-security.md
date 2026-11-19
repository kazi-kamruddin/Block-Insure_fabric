# Workflow recovery and the patched chaincode candidate

The November recovery/security candidate uses the existing isolated channel
`insurance-workflow-alignment-20261108`, schema15, chaincode
`1.6.3-xgb-alignment`, sequence4, package SHA256
`bc2a30f5b434c73649f765a31232892941ced4f617c7f5518cf399af8457c44a`.
Preserved main, demonstration and audit channels have not been upgraded.
Use the candidate application and package together. `scripts/workflow-demo.ps1`
now defaults to this candidate; `-Profile Historical` explicitly selects the
preserved October workflow. See [the maintained startup guide](candidate-demonstration.md).

## Resume the existing isolated candidate

Inspect Docker, ports and process ownership first. Select the patched builder
described below, then use the existing guarded launcher:

```powershell
.\scripts\low-memory-network.ps1 Start -ChaincodeVersion 1.6.3-xgb-alignment -EvidencePath .local-reference/candidate-resume.jsonl
```

This resumes existing state. It does not install or activate a package. Do not
rerun channel creation, seeding or lifecycle deployment for this used candidate.
Keep compilers and cold network startup separate. If WSL's Docker socket/interop
fails, do not repeatedly launch the same heavy stack; the local handoff preserves
the native-controller procedure and original failures.

The application and all three workers need these existing deployment settings:

| Setting | Isolated selection |
| --- | --- |
| FABRIC_CHANNEL_NAME | insurance-workflow-alignment-20261108 |
| FABRIC_CHAINCODE_NAME / FABRIC_EXPECTED_SCHEMA_VERSION | insurance-contract / 15 |
| FABRIC_NETWORK_ROOT | This checkout's network directory |
| FABRIC_XGBOOST_ENABLED | true |
| ORACLE_STATE_ROOT | This checkout's data/oracle-alignment-20261108 |
| EVIDENCE_STORAGE_ROOT | This checkout's data/evidence-alignment-20261108 |
| EVENT_PROJECTION_ROOT | This checkout's data/events-alignment-20261108 |
| OTP_STATE_ROOT | This checkout's data/otp-alignment-20261108 |
| WORKFLOW_OPERATION_ROOT | This checkout's data/workflow-operations-alignment-20261108 |
| ORACLE_REGISTRY_API_URL | http://127.0.0.1:3200/api/public/oracle-registries |
| APP_ORIGIN / PORT | http://127.0.0.1:3200 / 3200 |

Restore the same protected AUTH_SECRET, OTP_SECRET, registry token and enrolled
identities used with these state roots. Do not print, regenerate or replace them
to bypass recovery. The local handoff identifies the existing owned-process
helper and its synthetic-only environment; it is not a production configuration.
Keep real email provider variables unset for a local rehearsal. The tested
external adapter override accepts only a loopback receiver.

Start the built web application with apps/web/scripts/start-standalone.mjs and
the three workers with services/oracle-worker/src/index.mjs and their respective
.env.oracle1.example through .env.oracle3.example profiles, applying the shared
overrides above. Each role/profile still selects its authorized enrolled identity.
Wait for web /api/health/live, web /api/health/ready and worker /health on
3301–3303. Confirm exact selected channel/schema/package before transactions.
Stop only recorded owned processes and selected core/candidate containers after
the rehearsal. Retain all volumes, ciphertext, journals and worker checkpoints.

## Saved actions

The browser saves the original command and request identity before sending a
supported critical action. Storage is qualified by deployment and account.
After response loss or reload, **Check saved action** queries that same action.
A different instruction cannot replace an unresolved saved action. Confirmed
INVALID, rejected or unsubmitted actions can be reviewed for an explicit new
attempt, preserving the original business identifiers. Invalid form/console
commands and failed browser persistence are rejected before anything is sent.

Supported actions are claim submission and processing, appeals, opening/routing
reviews, auditor decisions, review/Oracle expiry, settlement authorization and
confirmation, Bank balance adjustments and EFT processing. Other workflows retain
their existing mechanisms. Legacy callers without recovery headers retain the
existing API and chaincode replay protections; they do not acquire a journal
retroactively.

`POST /api/workflows` accepts the normal command plus:

```text
idempotency-key: <original 20–100 character request identity>
x-workflow-deployment: <channel>/<chaincode>
x-workflow-recovery: true
```

The last header requests recovery only. Authentication, role authorization,
input validation and mutation-origin checks run before journal access. The same
identity with different command contents is rejected. Server storage additionally
qualifies account, subject and role. In-flight recovery binds the original
Fabric certificate; identity rotation must retain the authorized original state.

The server reserves an immutable intent, endorses the final transaction, then
durably saves its commit-status request and endorsed result **before submit**.
Fabric commit status determines the outcome:

| Outcome | HTTP | Meaning |
| --- | --- | --- |
| COMMITTED |200| Original transaction VALID, or explicitly reconciled existing authoritative workflow state |
| PENDING |202| Outcome unresolved; no automatic re-endorsement or resubmission |
| INVALID |409| Committed validation failure, including MVCC/code11; endorsed result is not returned as success |
| REJECTED |409| Failure before the final transaction could be submitted |
| NOT_SUBMITTED |409| Recovery found no saved submission, or the original process ended before transaction preparation |

A valid transaction can record a business failure, such as insufficient funds.
COMMITTED does not mean the claim was approved or a payout succeeded. Recovery
returns the original transaction result; refresh the ledger view for current
balances, appeal versions and decisions. Unknown status remains pending. It is
not proof that a transaction is absent, and must not trigger new financial IDs.
An indefinitely unresolved prepared transaction requires operator investigation;
the journal favors preventing duplicate effects over guessing its outcome.

## Durable storage and restoration

`WORKFLOW_OPERATION_ROOT` is optional. Blank defaults to
`data/workflow-operations` beside the configured network directory; relative
paths are anchored to `apps/web` before standalone startup changes its working
directory. The default and alignment variants are Git-ignored.

Records use authenticated AES-GCM encryption derived from the stable server
`AUTH_SECRET`, restricted file modes and atomic publication of fully written
files. This is server custody, not user-exclusive encryption. No Fabric private
key or evidence passphrase is placed in browser saved actions or journal records.
These records do not replace encrypted evidence storage or its BIF1 recovery file.

New records use a compact `v2/<fully-qualified-digest>/` layout to avoid common
Windows path limits. Earlier records retain their original three-digest layout,
ciphertext and authentication semantics. Recovery reads them without migration
or rewriting. Conflicting copies in both layouts fail closed for investigation.

Back up the whole journal root, protected server secret and necessary identity
material through the deployment's existing custody process. Restore the directory
layout before accepting new requests. Preserve both layouts; never delete a
pending intent/checkpoint to force a retry. Changing `AUTH_SECRET` makes protected
records unreadable unless the original secret is restored. A different operation
namespace cannot decrypt a copied record. Successful restored-record decryption
and legacy replay have separate tests and local evidence.

## Go build and deployment

The chaincode module pins Go 1.26.11, which fixes
[GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859). The separate
`block-insure/fabric-ccenv:2.5.16-go1.26.11` image retains Fabric's builder
and installs the compiler from a digest-pinned official Go image.
Compilation is serial with bounded Go memory settings. CI and new builds
check that the Go directive and the builder image pin agree. Local Docker
tests and the Docker packaging fallback use the same pinned image.

From the Fabric root, build the image without starting or resetting a network:

```powershell
docker build --memory 512m --tag block-insure/fabric-ccenv:2.5.16-go1.26.11 network/chaincode-builder
$env:FABRIC_CHAINCODE_BUILDER = 'block-insure/fabric-ccenv:2.5.16-go1.26.11'
```

Linux environments can use `scripts/build-chaincode-builder.sh`. Select the
image before starting isolated peers. The maintained deployment script checks
all five peer builder configurations before installing new source. Source/test
compiler updates alone do not establish the compiler of deployed chaincode.
The dated verification ties exact package IDs, runtime binary hashes and actual
binary build information to the scan result.

Use the archived Go 1.26.10 builder and its matching source and archive
when resuming the already verified November and medical demos. The Go
1.26.11 builder is for a new, separately approved chaincode deployment.

The source and deployed binary scans use official `govulncheck`1.9.0. JSON mode
can exit zero while reporting vulnerabilities, so CI separately checks findings
with `scripts/check-go-vulnerabilities.mjs`. Called-symbol findings fail; other
findings remain visible. Scanner/provider failures must not be converted to a
clean result. A scan is a dated statement about that source/binary and database,
not a security claim about every Fabric service or operating-system image.

Quality runs the Go gate on pushes and pull requests. Its daily
default-branch run checks for newly published advisories between PRs.
The failed job retains the raw scan as the `chaincode-govulncheck`
artifact. The current patch version comes from `go.mod`. For a future
Go patch, update the Go directive and the exact official image tag and
digest in `network/chaincode-builder/Dockerfile` together, then run the
source checks and scan before pushing.

With the pinned Go version and Node installed, run the same source gate
locally from the Fabric root in Bash. The temporary scan path is printed
so a failed run can be inspected.

```bash
(
  set -euo pipefail
  source network/scripts/chaincode-toolchain.sh
  export GOTOOLCHAIN=local
  test "$(go env GOVERSION)" = "go$chaincode_go_version"
  cd chaincode/insurance-contract
  test -z "$(gofmt -l .)"
  go vet ./...
  go test ./...
  scan="$(mktemp)"
  printf 'Scan report at %s\n' "$scan"
  go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -json ./... > "$scan"
  node ../../scripts/check-go-vulnerabilities.mjs "$scan"
)
```

On 19 November 2026 the Go 1.26.11 Linux source run passed formatting,
module verification, vet and chaincode tests. Both the source scan and
the scan of a new local builder-produced binary reported zero findings
with database revision `2026-11-11T02:51:11Z`. The offline proof archive
matched all 36 runtime files. It was never installed, and all 49 existing
Docker volumes were retained. The optional local Go 1.26.10 comparison
timed out under the bounded memory profile. The supplied GitHub failure
is the pre-patch baseline. Local evidence is under
`.local-reference/go-2026-6859-20261119/`, including both successful raw
scans, the package audit and preservation record. GitHub's push and PR
checks still need to run on the patch.

## Email acknowledgement

An external gateway must return successful HTTP plus JSON containing a nonempty
`messageId` (at most200 characters). Malformed/empty acknowledgement, non-success
HTTP and the bounded10-second timeout remain visible failures. OTP failure
revokes its challenge. Receipt retries keep the stable deployment/event/recipient
Idempotency-Key; the provider must honor it. Recipient fallback still requires
an explicitly matching ledger subject. DELIVERED means acknowledged by the
gateway, not confirmed inbox receipt. Real-provider acceptance is owner-only;
local tests send no external email.

## Verification and activation boundary

See [the dated results](results/recovery-security-2026-11-10.md) for exact
source/package/environment identity, original failures and final dispositions.
The actual Gateway tests use real endorsements/status codes; their controlled
barrier and expired deadline reproduce failures without mocking the ledger.
The separate offline UI transport fixture is identified as such. Browser recovery
tests drop a real valid committed response and restart only task-owned processes.

Preserved-channel activation needs a reviewed application/package/schema plan,
backup and recovery preparation, identity/secret coordination, acceptance and
rollback through a new definition. No startup or test command authorizes it.
Historical experiments retain their original artifacts and results. No model
weights, operating threshold or evaluator identity changed in this work.
