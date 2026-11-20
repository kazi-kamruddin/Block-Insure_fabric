# Fabric shared research workload

Fabric keeps its own copy of the **Healthcare Provider Fraud Detection
Analysis** benchmark and prepared hybrid artifacts here. The existing
medical demo uses its own episode records, state and Oracle snapshot.
[Benchmark dataset](https://www.kaggle.com/datasets/rohitrox/healthcare-provider-fraud-detection-analysis).

| Local contents | Scope |
| --- | --- |
| `raw/` | Four original CSVs. The inpatient and outpatient tables contain 40,474 and 517,737 claims, alongside separate provider and beneficiary tables |
| `processed/` | Retained training, calibration, untouched test and paired controlled-attack test JSONL files |
| `runtime/hybrid-primary.jsonl` | Exact 4,995-row training-derived registry sample |
| `comparison-presets.json` | Five synthetic compatibility cases with original lookup identities and fixed dates |
| `upstream-manifest.json` and `comparison-manifest.json` | Counts, SHA-256 fingerprints, split and label policy, and provenance |

The five synthetic controls retain the fields used for the comparison.
They use fixed reference dates. A live demo reset can shift those dates
to its chain clock. The 4,995 derived rows retain their source bytes.
Provider weak-risk labels, injected scenarios and adjudicated outcomes
describe different kinds of evidence.

## Verify and prepare

Run from the Fabric root.

```powershell
npm --prefix services/oracle-worker run verify:hybrid-archive
npm --prefix services/oracle-worker run build:hybrid-comparison
```

Verification checks all nine data files against the recorded fingerprints.
The second command verifies the runtime and preset inputs and creates a new
`data/research/hybrid-5000-v1-*/` directory with the 5,000-row input, three
valid Fabric registry replicas, one deliberately altered replica and a
comparison receipt. The valid roots must agree and the altered root must
differ. The build uses local files and never contacts Fabric Gateway.

The raw, processed and runtime files are Git-ignored and total about
1.43 GB. Back up this Fabric dataset directory. For a fresh clone,
restore `raw/`, `processed/` and `runtime/` to the same location in Fabric
and run verification. The manifests and five synthetic presets are
tracked artifacts. Generated replicas can be recreated from the prepared
inputs. The verifier checks the retained archive.

## Thesis comparison

Use the 5,000 records as a **matched registry workload**. Give the two
implementations the same 4,995 claim cases and five fixed-date synthetic
controls. Pin the runtime and preset hashes. Select the same positive,
mismatch and missing-record cases. Measure a comparable request-bound
record check separately from dataset preparation and settlement.
Record the host, repetitions, failures, timing boundaries, topology
and quorum. Report the costs of each platform's native commitment and
verification scheme in those terms.

For model accuracy, use a separate held-out cohort and freeze label
definitions, history cutoff and feature normalization for both
implementations. The runtime slice comes from training. The historical
provider-disjoint splits have documented beneficiary overlap. The
benchmark supports controlled comparison and synthetic outcomes.
Independent clinical fraud validation needs independently adjudicated
outcomes.

On 20 November 2026, all nine dataset checks passed. An isolated copy
containing only Fabric code and inputs reproduced the same 5,000-row
input hash and registry root. It refused both missing and altered input
before writing a new research run. Cross-platform latency, throughput
and model effectiveness remain to be measured with a matched run.
