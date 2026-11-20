# Model release upgrade finding

On 20 November 2026 the unreleased dev-lite prototype passed 55 Go tests
and 24 subtests, up from 53 and 18. The release tests exercised ordered
hold, commit, reveal, authorization, and correction fixtures using
`memoryStub`. Both promotion/hold orders were exercised serially. No
claim about concurrent validation by Fabric peers follows from those tests.
The Oracle worker's existing 29 tests also passed.

A separate synthetic, one-host restart check failed the upgrade
compatibility invariant. A saved decision for an existing frozen-model
commitment could resume under its original identity. Under the prototype,
the identity included an empty release ID for the same historical request.
That changed the persisted lookup key. The worker reported its decision
missing and refused to regenerate it against the existing commitment. A
worker readiness check also showed that a newly named routing release
could pass the registry's approval gate while the installed evaluator
returned a model-version mismatch.

The prototype is uncommitted. Work stopped at the finding, without a
production fix or deployment. Worker compatibility, a named-release
replay tool, and the pending-claim live hold demo remain open. The later
items were not started. The raw Go log is under
`.local-reference/maintenance-1.9/item-06/`. The synthetic restart result
is under that run's `restart-probe/case-J0vgQu/` directory.
