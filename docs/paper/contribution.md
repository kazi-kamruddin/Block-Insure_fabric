# Thesis contribution and evidence

Block-Insure evaluates whether evidence provenance changes medical claim routing when Oracle workers agree on the same computation. Each request pins the issuer keys and feed roots. Authority is scoped per fact. The worker checks signed records and their origin and derivation links, evaluates a deterministic fact vector, and commits to that vector and its policy decision. Two of three distinct subjects must reveal the same result. The [offline Phase 3 experiment](../results/oracle-v2-phase3-2026-11-25.md) pairs the same synthetic cases across the four routing modes and sweeps panel capacity.

The insurer, hospital, claimant and simulated bank supply different kinds of evidence. A contradiction, unavailable proof, lineage dependency, model referral, or missing Oracle quorum can send the case to a governed review. Approval binds the current claim version, episode, issued payout terms and relevant decision evidence to a certificate. The bank checks the effective certificate before simulated BDT settlement. The [R1 journey record](../results/r1-journeys-2026-11-25.md) gives the dated Fabric evidence. The R2 code adds sealed human ballots and a transcript-bound v3 certificate.

## Negative results

Workers can agree on a false fact when they share a source. In the synthetic lineage case all three workers agreed with the signed copies before the provenance gate checked their common origin. The evidence experiment also includes a Hospital payment confirmation derived from its own invoice and an independently signed Bank contradiction. Separate issuer keys do not by themselves establish independent evidence. Consistent in-band Hospital and claimant collusion remained possible where the configured facts contained no independent amount observation.

An earlier commit design admitted an identical commitment copied from another Oracle. Binding the channel, request, claim version and Oracle subject to the commit preimage and refusing identical offers closed this path. Quorum still requires two valid openings from distinct assigned subjects. The synthetic workload separates wrong automatic approvals, legitimate referrals, unresolved overflow and liveness outcomes. Its aggregate rates depend on the scenario mixture.

## Related work

The comparison describes the authority and consensus objects each source studies.

| Work | Per-fact authority | Replicated computation | Consensus object | Human fallback and settlement |
| --- | --- | --- | --- | --- |
| Dong, Berti-Équille and Srivastava, PVLDB 2009 | Estimates source dependence and copying from the claimed values | Truth inference over multiple sources | Inferred value and source relationships | Data integration study. [Paper](https://www.vldb.org/pvldb/vol2/vldb09-pvldb47.pdf) |
| DECO, CCS 2020 | TLS-server provenance for a selected fact | Prover and verifier attest TLS-derived statements | Verifiable proof about TLS data | General proof mechanism. [Authors' paper](https://arxiv.org/abs/1909.00938) |
| DecenTruth, INFOCOM 2023 | Computes estimated truth over sources with different reliability | Off-chain truth discovery and asynchronous BFT | Agreed estimated values | Data feed experiment. [Publisher](https://ieeexplore.ieee.org/abstract/document/10229019) |
| B-SAHIC, JIFS 2023 | Enterprise actors submit claims and related records | Fabric chaincode supports claim processing | Fabric transaction state | Permissioned healthcare claims and processing. [Publisher](https://journals.sagepub.com/doi/10.3233/JIFS-220690) |
| Juntachat et al., APST 2024 | One Oracle integrates external insurance databases with the permissioned network | Corda-based claim workflow | Corda claim transactions and Oracle data updates | Health claims automation. [Article](https://so01.tci-thaijo.org/index.php/APST/article/view/262630) |
| Chainlink OCR 3.0 | Observation sources and aggregation are reporting-plugin choices | A Byzantine-fault-tolerant oracle network aggregates off-chain | Quorum-attested reports | Application-specific downstream use. [Protocol paper](https://research.chain.link/ocr3.pdf) |
| Block-Insure | Signed source policy and independent origins for specific facts | Three exact-agreement Oracle workers | Manifest-pinned fact vector and route | Governed four-auditor panel and version-bound simulated payout |

The frozen XGBoost and challengers are evaluated on authored synthetic labels. The [ML tables](ml-evidence.md) report model and panel-load behavior as supporting results.
