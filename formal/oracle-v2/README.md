# Oracle v2 protocol model

The model covers one pinned request and its three assigned Oracle subjects. It
uses eleven representative fact vectors, including distinct evidence
references with the same decision, missing evidence, integrity failures,
tariff and receipt failures, and model advice to review. Exact agreement means
that two subjects open commitments to the same vector. The decision is a
function of that vector.

The commit phase accepts one commitment per subject and reserves the hash
against duplicate use. A symbolic commitment includes its bound subject and
vector. A worker can store a symbolic digest bound to a different subject
before that subject commits, but can never open it as its own. It can therefore
affect liveness until a deadline, while contributing no vote to a quorum.
Commitments are modeled as collision-resistant. Request and channel bindings
are implicit because the model explores one pinned request.

Two successful matching reveals close the request with their decision. Three
different valid reveals close it with a conflict. The reveal deadline closes an
incomplete round. Integrity failures, policy failures, conflicts and timeouts
all route to panel review. The property `DecisionOrPanel` depends on weak
fairness of both deadline transitions. This abstracts eventual clock progress
and a permitted deadline finalization being submitted and committed. Worker
participation itself is optional.

The model abstracts successful authentication and evidence checks into the
representative vectors. It omits issuer signature arithmetic, lineage graphs,
revocation and Fabric ordering. The panel outcome and settlement are covered
separately in the [medical certificate model](../medical-certificate/README.md).

Run TLC only during the approved Phase 1 live-verification window with the Fabric
containers stopped. From this directory:

```powershell
java -XX:+UseSerialGC -Xmx512m -cp ../insurance-workflow/.cache/tla2tools.jar tlc2.TLC -config OracleV2.cfg OracleV2.tla
```

The Phase 1 offline pass checks source and configuration references. TLC results
remain pending.
