# Failure-aware Oracle adjudication in a Fabric health-insurance prototype: a controlled evaluation

**Implementation:** Block-Insure Fabric research prototype. **Protocol/fault-study baseline:** `da58820`. **Load-workload baseline:** `de0c65a`. **Working-tree sources and raw evidence:** [manifest](../results/phase2-manifest.json) and [index](../results/phase2-evidence-index.md). **Experiment ledger:** `insurance-phase2-20260926`.

## Abstract

We evaluate a permissioned health-insurance prototype that binds external-data adjudication to certificate identities, versioned source commitments, and an exact 2-of-3 Oracle quorum. We measure local protocol computation separately from Fabric transactions and complete application journeys. Across 15 repeated deployed fault journeys, all specified ledger outcomes were observed. In three Caliper repetitions, claim-submit throughput rose to 24.1 transactions/s at 40 offered TPS, then fell to 20.83 transactions/s at the highest observed send rate of 135.4 TPS, while mean latency rose to 3.597 s. Eight modeled security cases passed, but a shared-source counterexample shows that three consistent Oracle results can be wrong against an external truth label. The evidence supports a bounded claim about the implemented workflow on a local five-organization network; it does not establish clinical truth, independent data-provider corroboration, production capacity, or external bank settlement.

## 1. Introduction and related work

A permissioned ledger can record who decided a claim and which source commitment was used. It cannot determine whether an off-chain medical or insurance record is true. A single external-data service is an integrity and availability dependency; replication helps only under an appropriate failure-independence assumption. A claim also needs a controlled route when automated verification cannot finish.

This study asks how an implemented 2-of-3 Oracle workflow behaves under those boundaries. Its contribution is an **evaluated prototype and reproducible failure study**: certificate-bound commit/reveal, exact-result quorum, governed fallback, version-bound appeals, and separate measurements for local protocol computation, Fabric Gateway transactions, and complete browser-to-ledger journeys. We report a common-source counterexample alongside successful one-worker tolerance.

Tripathi et al. describe a Hyperledger Fabric healthcare-insurance system with smart-contract claim processing and shared-ledger auditability in their publisher abstract [1]. The full article was unavailable for this study, so specific mechanism and novelty comparisons remain unresolved. Fabric's modular permissioned architecture is described by Androulaki et al. [2]. We make no priority claim for Fabric-based insurance.

## 2. System and trust model

The local network has one orderer and five organizations, each with one peer: InsurerMSP, HospitalMSP, AuditorMSP, BankMSP, and OracleMSP. The web application maps demo sessions to server-held Fabric identities. Chaincode separately checks certificate MSP, role, subject, assignment or ownership, and asset state. Demo login is not an institutional identity proof; CAs, administrators, key storage, and the host are trusted in this experiment.

A Hospital finalizes its own invoice. The insurer cross-checks the claim and creates an Oracle request that binds claim and appeal version, Hospital verification, registry snapshot ID/version/root, rules version/hash, model version/hash, assigned subjects, quorum, and deadlines. Each worker has a certificate, registry replica, cursor, and retry state. It first submits a salted commitment and then reveals its result. Chaincode permits at most one response per assigned certificate subject and checks bindings before counting reveals. Two identical canonical result hashes finalize a decision: valid majority approves; invalid majority records `NEGATIVE_RESULT`; three distinct complete results record `CONFLICT`; insufficient matching results at deadline record `TIMEOUT`.

Negative, conflict, and timeout outcomes set `ORACLE_FAILED` and can be routed to a four-auditor review. The demonstrated profile needs three approvals or two rejections. Review can approve after a negative Oracle result; this is a governance override, not proof the Oracle was wrong. Settlement requires a current-version approval, insurer authorization, and BankMSP confirmation. Bank balances and transfer references are simulated; no external transfer is established.

Public workflow metadata and hashes are on the channel. Bank details use a Bank–Insurer private data collection; invoice and policy credential details use a Hospital–Insurer–Oracle collection. Fabric collection members hold private values while other channel members receive hashes [3]. Salted Merkle presentations disclose required fields to authorized Oracles, which check proof paths and bind the presentation hash to the claim version. This is selective disclosure, not zero knowledge. Revocation prevents a *new* presentation but does not invalidate an already registered verified presentation before expiry.

All three Oracle subjects and replicas are within one OracleMSP. The demo replicas share a canonical source. Thus the design tolerates one missing or divergent *response* under its model, but does not represent independent institutions or clinical sources. Two compromised Oracle identities or a bad common source can form a wrong quorum.

## 3. Research questions and methods

The protocol in [`docs/phase2-study-plan.md`](../phase2-study-plan.md) was written before controlled runs.

| Question | Prespecified observation |
| --- | --- |
| RQ1: cost | Local computation across five profiles; Fabric Gateway read and committed-write measurements at fixed offered loads. |
| RQ2: fault behavior | Repeated deployed positive, negative, unavailable, conflict, and timeout journeys with ledger assertions. |
| RQ3: controls and residuals | Eight modeled attack outcomes, 64 threshold states, and a common-source counterexample. |
| RQ4: related work | Comparison limited to parts of Tripathi et al. actually available. |

### 3.1 Local protocol comparison

Five deterministic configurations use the same registry record: centralized assessment, 1-of-1, 2-of-2, 2-of-3, and 2-of-3 with three selective-disclosure checks. The alternatives are **protocol computations**, not deployed alternative claim workflows. Each of 30 trials performs 1,000 measured operations per configuration after 200 warm-ups. Order rotates by trial. Operation means, medians, P95s, process CPU, and memory deltas are retained; the 95% interval uses **trial means**, avoiding an operation-level pseudo-replication claim. Paired trial differences and ratios compare 2-of-3 with centralized and private with ordinary 2-of-3. This timer excludes Fabric, network, storage, browser work, and external services.

### 3.2 Live faults and state space

Playwright drives the full application on an isolated Phase 2 channel and separate worker, event, and evidence directories. Five profiles are run three times in cyclic order with unique claim IDs: positive quorum and settlement; matching negative result and auditor settlement; one worker offline and automatic approval; divergent registry/model results and auditor settlement; and quorum loss with timeout and auditor settlement. Assertions inspect ledger assets and final states. Elapsed time covers **startup, fixture creation, calls, worker processing, and assertions**, so it is a whole-test duration, not isolated service latency. Three trials yield observed counts and ranges, not a population reliability estimate.

The protocol evaluator enumerates 64 states over {unavailable, A, B, C} for each of three workers at an expired deadline. It asserts that an automatic decision has at least two matching responses. Ground-truth-labeled scenarios compare 1-of-1, 2-of-2, and 2-of-3. The common-source case passes one anchored fixture through three actual registry-assessment and digest calls, designates the source incorrect externally, and asks whether the quorum detects this. That external label is a test premise, not clinical validation.

### 3.3 Fabric and security measurements

Hyperledger Caliper 0.7.1 supplies fixed-rate Gateway rounds [4]. The generated network profile rejects channel names outside `insurance-phase2-*`. Each run includes schema read, three read-only threshold evaluations, unique registry-commitment writes at 5, 10, and 20 offered TPS, invoice-bound claim submissions at 5–160 offered TPS, and a per-worker 1:1 policy-read/claim-submit mix at the same ramp. A synthetic active policy is issued as a benchmark precondition. Claim submissions reuse one finalized synthetic invoice, which keeps the input stable but is not a realistic billing distribution. Three runs record observed send rate, achieved throughput, success/failure counts, Caliper's mean transaction latency, and sampled Docker CPU/memory for the insurer peer, its chaincode container, orderer, and CouchDB. These rounds do not include premium payment, invoice creation, Oracle processing, or settlement and therefore do not establish complete journey capacity. The maximum offered rate is 160 TPS; saturation is claimed only if the observations show it.

Eight STRIDE-informed cases pair attack simulations with exact Go chaincode tests: one malicious worker, one unavailable worker, corrupted registry root, forged/unassigned identity, replay/stale result, altered privacy proof, late reveal, and appeal substitution. Passing means the declared safe outcome was observed under that fixture. A common-source failure is reported separately because its expected result is unsafe. Source commit, package ID, fixture hashes, raw trial records, Caliper logs, and unchanged preserved-ledger hashes support the evidence chain. All records and bank balances are synthetic.

## 4. Results

### 4.1 Local protocol cost

Table 1 reports 30 trial means per profile, each from 1,000 measured operations. The P95 column pools operation latencies and describes tail observations; its uncertainty is not the trial-mean interval. Full trial and input-hash data are in [`phase2-comparative/latest.json`](../results/phase2-comparative/latest.json).

| Protocol computation | Mean (µs) | Trial-mean 95% CI (µs) | Operation P95 (µs) | Mean ops/s |
| --- | ---: | ---: | ---: | ---: |
| Centralized assessment | 5.056 | 3.964–6.148 | 9.3 | 223,276 |
| 1-of-1 | 17.670 | 13.540–21.800 | 38.9 | 68,390 |
| 2-of-2 | 24.822 | 16.268–33.376 | 49.3 | 51,919 |
| 2-of-3 | 27.934 | 23.139–32.728 | 58.6 | 41,072 |
| 2-of-3 plus selective disclosure | 548.221 | 471.181–625.260 | 1,210.7 | 2,041 |

Within paired trials, 2-of-3 minus centralized assessment averaged **22.878 µs** (95% interval 18.846–26.910 µs); the mean paired ratio was **5.926** (5.152–6.700). The privacy path added **520.287 µs** relative to ordinary 2-of-3 (447.478–593.096 µs), with a mean paired ratio of **20.411** (18.981–21.841). These are local computation costs. The intervals use a normal approximation across 30 trial means and do not account for systematic host load.

### 4.2 Fault decisions and governance

The 64-state threshold enumeration yielded 30 exact-majority decisions, six complete three-way conflicts, and 28 no-quorum timeouts; these are **state counts, not probabilities**. A first-worker divergent result was unsafe for 1-of-1, blocked automatic 2-of-2, and was outvoted by two correct 2-of-3 results. A missing second worker blocked automatic 2-of-2 but allowed the two available 2-of-3 workers to agree. Two divergent workers could make an unsafe 2-of-3 majority. In the shared-source counterexample, all three implemented registry assessments returned `VERIFIED` and agreed on one result hash even though the external test label declared the source incorrect. The full matrix and actual assessment path are archived in [`phase2-protocol/protocol-matrix.json`](../results/phase2-protocol/protocol-matrix.json).

All **15/15** deployed browser trials passed the specified ledger assertions: three per profile. Table 2 reports whole-test elapsed time, including application and worker startup. It is not an estimate of decision or settlement service latency. The per-trial record and logs are in [`phase2-faults.json`](../results/phase2-faults.json) and its referenced artifact directory.

| Profile | Verified live outcome | Passed | Whole-test mean (range), s |
| --- | --- | ---: | ---: |
| Healthy positive | Exact quorum, approved, simulated settlement confirmed | 3/3 | 130.6 (128.4–133.0) |
| Matching negative | Oracle failure, assigned-auditor approval, simulated settlement | 3/3 | 137.5 (136.8–137.8) |
| One unavailable | Two-worker exact quorum, claim approved | 3/3 | 140.2 (129.0–152.7) |
| Conflict | No exact majority, assigned-auditor approval, simulated settlement | 3/3 | 148.8 (140.7–156.2) |
| Timeout | One reveal, explicit timeout, assigned-auditor approval, simulated settlement | 3/3 | 142.6 (137.9–146.2) |

The negative, conflict, and timeout tests explicitly verify review closure with three assigned approval votes. The negative test demonstrates a governance override of an invalid Oracle result; no clinical safety inference is drawn from the synthetic auditors' choices. The security evaluation passed **8/8** expected outcomes, including role/assignment denial, replay and stale-version binding, altered-proof rejection, late submissions, and appeal isolation. Its model retains two high residual risks: a two-Oracle malicious majority and common-source error. Evidence and exact Go test names are in [`phase2-security/latest.json`](../results/phase2-security/latest.json).

### 4.3 Fabric load and resource use

The ledger export yields request-to-finalization and claim-to-observed-final-state intervals that exclude browser startup. Table 3 reports means and the observed three-trial ranges. A review interval is measured only for negative, conflict, and timeout cases; approval or settlement can involve further actions beyond Oracle finalization. The raw filtered assets are in [`phase2-live-ledger.json`](../results/phase2-live-ledger.json).

| Deployed profile | Oracle finalization, s | Claim to observed final state, s | Review closure, s |
| --- | ---: | ---: | ---: |
| Healthy positive | 13.08 (13.01–13.15) | 27.59 (27.32–27.73) | — |
| Matching negative | 12.99 (12.92–13.12) | 36.16 (35.93–36.47) | 6.58 (6.55–6.59) |
| One unavailable | 22.65 (22.34–23.16) | 29.49 (29.01–30.04) | — |
| Conflict | 16.62 (16.03–17.45) | 42.80 (40.03–46.16) | 7.35 (6.50–8.63) |
| Timeout | 16.51 (16.50–16.51) | 39.97 (38.47–41.82) | 6.78 (6.49–7.02) |

All three corrected Caliper repetitions completed 19/19 rounds with zero reported transaction failures. Table 4 gives the rising-load write and mixed-workflow rounds. Values are means across three runs; ranges are the observed run minima and maxima. The send column is **observed send rate**, which falls below the nominal 160 TPS for claim submits as the clients experience backpressure. The mixed workload includes policy reads and claim writes in a 1:1 request mix, so its throughput is not directly comparable to all-write throughput. Full per-run results, read-only rounds, registry writes, and workload latency P95 values are in [`phase2-summary/summary.md`](../results/phase2-summary/summary.md); raw inputs are the three [Caliper logs](../results/phase2-caliper/run1.log) and the matching `run2.log` and `run3.log`, HTML reports, resource JSONL, and per-worker latency samples.

| Round | Nominal TPS | Observed send TPS | Achieved TPS, mean (range) | Mean latency, s | Success/fail |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claim submit | 5 | 5.10 | 4.97 (4.9–5.0) | 1.263 | 300/0 |
| Claim submit | 10 | 10.20 | 9.67 (9.3–9.9) | 0.900 | 300/0 |
| Claim submit | 20 | 20.37 | 18.67 (17.6–19.2) | 0.700 | 300/0 |
| Claim submit | 40 | 40.37 | 24.10 (22.9–25.8) | 1.497 | 300/0 |
| Claim submit | 80 | 68.40 | 23.47 (20.1–29.1) | 2.407 | 300/0 |
| Claim submit | 160 | 135.40 | 20.83 (12.0–25.4) | 3.597 | 300/0 |
| Mixed policy/claim | 5 | 5.10 | 4.60 (4.6–4.6) | 0.837 | 300/0 |
| Mixed policy/claim | 10 | 10.20 | 9.73 (9.5–9.9) | 0.653 | 300/0 |
| Mixed policy/claim | 20 | 20.40 | 19.00 (18.7–19.2) | 0.487 | 300/0 |
| Mixed policy/claim | 40 | 40.77 | 31.33 (26.4–35.2) | 0.423 | 300/0 |
| Mixed policy/claim | 80 | 81.40 | 38.00 (35.0–41.2) | 0.643 | 300/0 |
| Mixed policy/claim | 160 | 151.13 | 48.77 (44.5–53.1) | 0.630 | 300/0 |

The all-write claim curve no longer tracked offered load after 20 TPS; its measured peak was 24.1 TPS at the 40-TPS setting. At the highest setting, mean latency was 3.597 s and the three workload P95 observations ranged from 3.228 to 7.767 s. This is local prototype saturation under the specified fixture and run order, not a general service capacity. Anchored registry writes reached 18.5 TPS mean at 20 offered TPS; read-only schema and threshold rounds each returned about 20.2 TPS at 20 offered TPS.

During the three runs, 216 periodic Docker samples per named container gave insurer-peer mean/max CPU of 11.62/92.99% and mean/max memory of 105.53/120.80 MiB; insurer CouchDB 12.45/226.83% and 32.24/43.24 MiB; insurer chaincode 10.43/268.54% and 193.29/222.30 MiB; and orderer 4.28/111.81% and 76.74/97.48 MiB. Docker CPU can exceed 100% across cores. These aggregate samples are not attributed to individual rounds, and other organizations' containers are not in this resource subset. The excluded invalid-invoice pilot and interrupted corrected attempt are documented in [`phase2-exclusions.md`](../results/phase2-exclusions.md).

## 5. Discussion

Strict-majority matching has a conditional benefit: one divergent response cannot dictate a 2-of-3 result, and two matching available responses can finish with a third offline. A 2-of-2 unanimous design with one missing or divergent response cannot finish automatically. Neither configuration verifies a shared source's truth. Auditor fallback preserves a governed path, while transferring factual responsibility to assigned auditors. The automated result, review votes, and settlement authorization remain distinct ledger actions. The selective-disclosure path limits shared-world-state exposure but costs CPU and reveals required fields to authorized peers. Credential lifecycle and off-chain ciphertext retention remain operational concerns.

The load sweep exposes a second boundary: zero transaction failures did not mean that the all-write workload kept pace with offered load. Higher settings increased observed latency and reduced achieved claim-submit throughput after the 40-TPS setting. That behavior is consistent with client and ledger queueing on this host; the aggregate measurements cannot assign a single bottleneck. The mixed workload retained higher total throughput because half its operations were reads. Before/after channel-head measurements show the development ledger remained at height 2100 and the Phase 1 ledger at height 483, while the isolated Phase 2 channel reached height 875; the full hashes are in the [manifest](../results/phase2-manifest.json).

## 6. Threats to validity

**Construct.** The local CPU benchmark is not network latency; unique Caliper registry writes are not complete claims; browser elapsed time includes startup. Synthetic truth labels and auditor votes do not establish clinical correctness.

**Internal.** This is one workstation and one local Docker network. Background load, runtime warm-up, CouchDB growth, and test order can affect timings. Trial means are the unit for protocol intervals. Three live and Caliper repetitions support descriptive ranges only. Unique IDs prevent key reuse, but the experiment channel accumulates state. The load sweep always rises from low to high rates, so load and ledger growth are confounded. An invalid-invoice pilot and a shell-interrupted corrected run preceded the complete runs; their valid writes remained on the experiment channel, and their timing data were excluded as [documented](../results/phase2-exclusions.md).

**External.** One peer per organization, one orderer, one OracleMSP, common-source replicas, local CA administration, and simulated bank state do not model independent production institutions, real clinical records, a bank rail, or geographic deployment. Two colluding subjects or a bad source majority can make a wrong quorum.

**Related work.** The Tripathi publisher abstract confirms overlapping Fabric-insurance scope; without full text, detailed novelty, performance, or design comparison is unresolved.

## 7. References

1. P. Tripathi, P. Moon, P. Mishra, M. Singh, and J. Sathish Kumar, “[Health insurance system using federated blockchain technology](https://www.inderscience.com/info/inarticle.php?artid=150218),” *International Journal of Ad Hoc and Ubiquitous Computing*, 50(4), 223–239, 2025. DOI: 10.1504/IJAHUC.2025.150218. Publisher abstract inspected; full text unavailable.
2. E. Androulaki et al., “[Hyperledger Fabric: A Distributed Operating System for Permissioned Blockchains](https://arxiv.org/abs/1801.10228),” 2018.
3. Hyperledger Fabric, “[Private Data](https://hyperledger-fabric.readthedocs.io/en/latest/private-data-arch.html),” official documentation.
4. Hyperledger Caliper, “[Benchmark Configuration](https://hyperledger-caliper.github.io/caliper/0.7.1/concepts/bench-config/),” version 0.7.1 documentation.
