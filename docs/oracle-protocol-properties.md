# Oracle protocol properties

The 2-of-3 profile uses a strict-majority quorum, `K = 2`, over `N = 3`
certificate-bound workers.

## Safety

1. **Unique decision:** two different result hashes cannot both receive two
   votes in a three-member set. Any two quorums intersect in at least one
   identity, and each identity may reveal only one result per request.
2. **Version binding:** commitments and results cover the request, claim version,
   Hospital verification, appeal commitment, registry/rules versions and hashes,
   and model versions and hashes.
3. **Reveal integrity:** chaincode accepts a reveal only when its recomputed
   commitment equals that identity's stored commitment.
4. **No unilateral approval:** one Oracle result cannot satisfy the configured
   strict majority.
5. **Settlement separation:** Oracle consensus changes claim adjudication only;
   insurer authorization and Bank confirmation remain mandatory.

## Liveness and bounded failure

1. Two matching available workers can finalize after the third worker fails or
   diverges.
2. Workers may reveal after all commitments arrive or after the commit deadline,
   preventing one silent worker from blocking the reveal phase indefinitely.
3. A request that cannot reach quorum becomes `TIMEOUT` after its reveal deadline.
4. A complete three-way disagreement becomes `CONFLICT` immediately.
5. Both failure states have an explicit route to governed auditor review.

## Verification map

| Property | Executable evidence |
| --- | --- |
| Strict-majority configuration | Go request-validation tests |
| One unavailable worker tolerated | Go threshold test and `@oracle-one-unavailable` browser scenario |
| One divergent worker tolerated | Go threshold test and consensus state evaluator |
| No-majority conflict | `@oracle-conflict` browser scenario |
| Quorum loss timeout | `@oracle-timeout` browser scenario |
| All abstract response states | `npm run evaluate:consensus` and worker unit test |
| Stale appeal isolation | Go appeal/Oracle lifecycle tests |

The executable model is an exhaustive finite-state check of the response-counting
rule. It is not a proof of the complete Fabric network, transport, or cryptographic
implementation; those concerns are covered by contract, worker, and live workflow
tests.
