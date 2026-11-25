# Auditor vote visibility

While a review round is open, the Gateway withholds the individual votes and
tallies from every browser role. Assigned auditors receive an acknowledgment
for their own committed vote and can tell whether they have already voted.
The operational event feed exposes the vote payload only after it can read
and verify the corresponding closed review. A failed review read suppresses
the vote. Research reports calculate alignment against closed rounds with
an approval or rejection outcome.

After closure, the insurer and the claimant for the case can read the
votes. Auditors can read votes for their assigned rounds through the
authorized case surfaces. Generic ledger queries also require the current
assignment for the claim and its version.

Fabric 1.9.0 keeps submitted votes in public peer state, including votes
from open rounds. Channel members with direct ledger access can read them.
Phase 2 retains this chaincode behavior. The Phase 3 design introduces
committed votes with a separate reveal period for newly opened rounds.
