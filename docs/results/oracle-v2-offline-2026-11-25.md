# Oracle v2 paired offline experiment

Date 2026-11-25 (Asia/Dhaka). Node v24.16.0. Seed 42. 24 synthetic diagnostic claims per scenario for 264 distinct paired cases and 1056 mode observations.

## Cohort and decision gates

The benchmark pairs the same claims and truth labels across four configurations. The v1 fixture gives workers a shared Insurer snapshot and uses the v1 result digest and threshold function. Signed single-origin v2 verifies the HIS invoice under an invoice-only comparison policy. Signed multi-source v2 adds licence, accreditation, tariff, claimant receipt and payment where the fixture policy enables it. Provenance-aware v2 adds cross-domain and disjoint-origin checks between the invoice and the material regulator and payment evidence. The receipt is used to check consistency with the invoice and cites it in every case.

The adapters sign the synthetic records and feeds with test-only Ed25519 keys. The verifier checks feed pins, record authority and Merkle membership before the v2 routes are evaluated. The experiment fixes model advice to AUTO to isolate the evidence gate. The ground-truth labels come from scenario construction. In this cohort, 12 eligible claims contain a receipt transcription mismatch. The remaining mismatched receipts represent ineligible claims. The licence/accreditation cases alternate the two integrity failures. The optional-payment policy applies to the contradictory-payment scenario and every other clean case.

Each scenario has equal representation. The cohort contains 108 eligible and 156 ineligible cases. Most stale-mirror cases retain two agreeing current workers. Every sixth case has a third distinct result, and the preceding case has one late reveal, exercising compound-fault CONFLICT and TIMEOUT. The duplicate-offer scenario models acceptance at the old commit gate versus refusal at the subject-bound gate. Both modes rely on two valid reveals for their decision.

The panel budget is fixed at 50% of the full cohort, rounded down to 132 fixed slots per mode. Referrals enter the panel in routing-time order with ties broken by claim ID. Overflow is unresolved; referrals count regardless of panel capacity. Modeled routing times use a 60-second commit deadline, a 120-second reveal deadline, and deterministic worker delays and jitter. Completing a panel slot adds a fixed 30 seconds in the simulation. The decision percentiles exclude unresolved cases. These times describe the analytical schedule.

## Outcomes at the fixed panel budget

| Configuration | Auto approvals (% of all) | Wrong auto approvals (% of ineligible) | Legitimate referrals (% of eligible) | CONFLICT (% of all) | TIMEOUT | Panel demand (% of all) | Panel served | Unresolved | Routing p50/p95 (s) | Decision p50/p95 (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v1 shared Insurer snapshot | 256 (97.0%) | 156 (100.0%) | 8 (7.4%) | 4 (1.5%) | 4 | 8 (3.0%) | 8 | 0 | 9/65 | 9/65 |
| v2 signed single-origin | 232 (87.9%) | 132 (84.6%) | 8 (7.4%) | 4 (1.5%) | 4 | 32 (12.1%) | 32 | 0 | 10/66 | 10/66 |
| v2 signed multi-source | 136 (51.5%) | 48 (30.8%) | 20 (18.5%) | 4 (1.5%) | 4 | 128 (48.5%) | 128 | 0 | 11/66 | 39/66 |
| v2 provenance-aware | 112 (42.4%) | 24 (15.4%) | 20 (18.5%) | 4 (1.5%) | 4 | 152 (57.6%) | 132 | 20 | 12/66 | 40/65 |

Compared with signed multi-source v2, the provenance-aware mode sends 24 additional cases to the panel and prevents 24 additional wrong automatic approvals in this cohort. The residual 24 automatic errors are the consistent-collusion cases. Those signed hospital and claimant assertions agree on an in-band false amount, and separate regulator evidence independently supports the licence, accreditation and tariff. The configured policy has no independent amount observation for that scenario.

In the table below, each mode column reports wrong automatic approvals / legitimate referrals / panel demand / unresolved.

| Scenario | Eligible / total | v1 shared | v2 single origin | v2 multi-source | v2 provenance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Insurer snapshot altered | 0/24 | 24/0/0/0 | 0/0/24/0 | 0/0/24/0 | 0/0/24/0 |
| Hospital bill above regulator band | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/4 |
| Claimant receipt changed, including benign transcription mismatches | 12/24 | 12/0/0/0 | 12/0/0/0 | 0/12/24/0 | 0/12/24/1 |
| Inactive licence or unaccredited service | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/3 |
| One worker offline | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| One worker reads a stale mirror, with compound-fault subsets | 24/24 | 0/8/8/0 | 0/8/8/0 | 0/8/8/0 | 0/8/8/6 |
| Duplicate commitment offered by one worker | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| Consistent Hospital and claimant reports of a false amount | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 |
| Agreement on a dependent copy of false source evidence | 0/24 | 24/0/0/0 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 |
| Independent payment evidence contradicts the request | 0/24 | 24/0/0/0 | 24/0/0/0 | 0/0/24/0 | 0/0/24/6 |
| Clean claim | 24/24 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |

## Replay of one shared-source decision

The synthetic case agreeing-copies-001 claims BDT 3691.87. Its ground-truth invoice is BDT 2941.87. The regulator-signed accreditation record cites the hospital's invoice record, so their origin closures overlap even though their signer and control-domain metadata differ. The signed claimant receipt matches the hospital invoice as a derivative copy.

| Configuration | Routing decision | Agreeing worker observations | Reveals needed before finalization | Evidence condition | Shared result or fact-vector hash |
| --- | --- | ---: | ---: | --- | --- |
| v1-shared | AUTO_APPROVE | 3 | 2 | SHARED_SNAPSHOT_POSITIVE | c4442cf8bd01f943eb4ee6ee7e4be4f7b6a1c9cbb0b32cc3a3bd4a3e2b93b03d |
| v2-single-origin | AUTO_APPROVE | 3 | 2 | PASS | d41f593a62a7d51fef0bcd5b06a545b2e2c69ed7ce59d8e85b72330707f3a8bd |
| v2-multi-source | AUTO_APPROVE | 3 | 2 | PASS | 6e66f6daf3336b11cd3f51ca67d9f1e7223733df68492f7a746b2fd86444a295 |
| v2-provenance-aware | PANEL_REVIEW | 3 | 2 | DEPENDENT_ACCREDITATION | 4dae548c6baa5936cfa72d54fb76e760c0df9825d7b36da44f6ff9119d778ba2 |

The three observations produce the same result within each configuration for this case. Two exact reveals decide the route. In the same run clean-001 routes AUTO_APPROVE under v2 provenance. The consistently false in-band case consistent-collusion-001 also routes AUTO_APPROVE under that policy. The fixture results quantify the named evidence and availability scenarios at the selected workload and budget.

## Reproduce

Run from the Fabric repository root:

~~~powershell
node --test benchmarks/oracle-v2/harness.test.mjs
node benchmarks/oracle-v2/run.mjs --seed 42 --per-scenario 24 --panel-budget 50 --date 2026-11-25
~~~

[Per-case results CSV](oracle-v2-offline-2026-11-25.csv)
