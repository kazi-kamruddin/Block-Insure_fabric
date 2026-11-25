# Frozen Fabric adapter effects

The deployed synthetic adapter divides amounts in poisha by 10,000,000. One
model amount unit therefore represents BDT 100,000. The older challenger
generator used a BDT 220–1,025 benchmark and case design envelope. Observed
target-case amounts were BDT 300.67–1,025. At that scale, log amount and
bill-to-benchmark ratios can behave differently from the dev-lite medical
demonstration. The adapter passes `observableHistory: {}`, so
`log_prior_claims` is zero. The frozen context builder computes separate
patient and provider features from strictly prior records it receives.

For `invoice_lag_days` the frozen OOD bundle has standardization mean 0,
scale 1, and pooled precision row `[0, 0, 0, 1000, 0, 0, 0]`. That term
contributes about `31.6 × |lag days|` in quadrature when the group lag
center is zero. The warning threshold is approximately 8.80. A one-day lag
alone can dominate the distance. The claimant view labels above-threshold
cases “Outside training range — diagnostic only; routing uses the model
score and evidence rules.”

The OOD warning flag never enters the mandatory review condition. The
continuous distance enters two of the 57 frozen trees. The two split
thresholds are 1.14136791 and 1.15661597 on child node 2 of zero-based trees
51 and 52, reached through the same recent-patient-history branch. The
paired sensitivity grid used at most one prior episode and did not reach
those nodes. A supplemental six-prior-episode fixture reached both. Its
score was 37,995,400 units at the observed OOD and 42,293,772 if that
feature alone was set to zero in the trace. Both cases stayed on the same
side of the review threshold. Changing the OOD input can therefore change
the exact tree path and score. The model uses the integer threshold to
translate any such score change into a routing decision.

The synthetic run covered BDT 500–200,000, zero to 30 lag days, and
complete, empty-prior and incomplete histories. It reported 12 AUTO,
28 REVIEW and 20 unavailable contexts. The unavailable cases are explicit
fail-closed responses. These are mechanism checks on selected synthetic
inputs. A field study would need measured local case distributions and
independent outcomes.

[Sensitivity grid and branch trace](../results/adapter-sensitivity-2026-11-25.md)
