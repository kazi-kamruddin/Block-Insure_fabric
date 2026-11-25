# Offline Oracle v2 source adapters

One Node process hosts four synthetic sources on loopback. S-A issues hospital
invoice records, S-B publishes regulator licences, accreditation and tariffs,
S-C publishes receipt records and S-D simulates payment events. The fixture
contains no patient data. A receipt refers to its original invoice through
`derivedFrom` and can reveal a mismatch. It cannot corroborate the billed
amount independently.

## Run the fixture

With Node 24, run `npm --prefix services/integrations/source-adapters test`.
The tests start four ephemeral loopback listeners with disposable keys and
test data, then close them. No Fabric service is required. Run
`node services/integrations/source-adapters/fixtures/generate.mjs --seed 42`
to print the unsigned seed. It includes a suspended licence, a tariff
supersession and a payment amount that differs from the invoice.

The standalone service reads three distinct opaque bearer values from
`ORACLE_ADAPTER_TOKEN_ORACLE1`, `ORACLE_ADAPTER_TOKEN_ORACLE2` and
`ORACLE_ADAPTER_TOKEN_ORACLE3`. Supply each value from the operator's ignored
secret store. Start the four listeners with:

```powershell
node services/integrations/source-adapters/server.mjs --seed 42
```

S-A through S-D listen on ports 3411 to 3414. The overrides are `--port-his`,
`--port-regulator`, `--port-receipt` and `--port-payment`. Keys are created
once under `data/dev-lite/source-adapters/keys/`, and signed versions are
stored under `feeds/<issuer>/<version>.json` in the same ignored directory.
`issuer-registry.json` contains the public issuer metadata. Use `--root` to
select a disposable fixture directory. An existing version cannot be replaced
or reused for different fixture inputs. Startup prints the listener addresses
and a `process.memoryUsage()` sample.

Start a second instance with the same worker bearer settings to reproduce a
stale mirror:

```powershell
node services/integrations/source-adapters/server.mjs --mirror-from data/dev-lite/source-adapters --through-version 1
```

The mirror uses ports 3421 to 3424 and a separate `mirror` subdirectory.
It copies issuer-signed feed versions from the direct store and rechecks their
signatures. `--through-version 1` withholds version 2. Omitting that cap lets
the mirror copy later versions in its periodic refresh. A mirror that has
already copied version 2 needs a fresh `--root` to simulate version 1 again.
The mirror generates its own retrieval-signing keys and does not require
access to the issuer private keys. Its `retrieval-keys.json` provides the
public diagnostics keys for a separately configured verifier.

## API and verification

All routes require a worker bearer token. Feed versions and roots are pinned by
the consuming request. The latest version is available for discovery.

| Method and path | Response |
| --- | --- |
| `GET /feed/latest` | Newest available signed feed. |
| `GET /feed/:version` | Specific signed feed with `records`, `merkleRoot`, signed `coverage`, `issuedAt`, `signature` and `anchorSignature`. |
| `GET /record/:id?version=N` | Signed record plus zero-based Merkle proof `{index,size,siblings}`, issuer, version and root. The query is optional for discovery. |
| `GET /coverage/:version` | Issuer-signed statement covering an inclusive interval in its synthetic namespace, with the ordered list of record IDs present at the pinned root. |
| `POST /retrieval-receipt` | Signed `{requestId,oracleId,feedVersion,root}` after matching the Oracle subject to the bearer and the root to the stored version. |

Version requests beyond the available history return HTTP 409 with
`FEED_NOT_AVAILABLE` and `latestFeedVersion`. An unknown record at an existing
version returns HTTP 404. Verified absence requires the pinned feed and a
valid coverage statement for the relevant scope, record and date. The mirror
status and retrieval path belong to worker diagnostics.

The Ed25519 signatures cover the 32 bytes of the shared domain-separated
canonical digest. Signatures and SPKI DER public keys use unpadded base64url.
Merkle leaves cover the complete signed record. Node hashes cover the ordered
child pair and duplicate an odd last child. Archive order is strictly by
record ID. The checkpoint anchor signs the feed root, its effective time and
the digest of the unsigned coverage statement. The fixture sets checkpoint
effective time to feed issue time. See [Oracle v2 SPEC](../../../docs/oracle-v2/SPEC.md).
