# Claim Readiness Audit

## Proposed Claim

Our method significantly outperforms Baseline-A on the retinal lesion classification benchmark and is ready to support the main paper claim.

## Final Verdict

**Not ready for manuscript use.**

The observed result is promising, but the multi-agent audit found blocking issues in baseline fairness, data split integrity, and claim wording. A single-agent summary could easily overstate the positive metric lift; this workflow forces independent reviewers to check different failure modes before the final claim is accepted.

## Specialist Findings

| Agent | Verdict | Key finding |
| --- | --- | --- |
| Result Analyst | weak_support | Mean accuracy lift is 1.9% and mean macro-F1 lift is 1.2%, but no statistical test or confidence interval is present. |
| Baseline Critic | not_fair_yet | The method and baseline use different preprocessing, image size, and augmentation settings. |
| Reproducibility Auditor | partially_reproducible | Seeds and logs exist, but the environment is under-specified. |
| Data Risk Auditor | high_risk | The dataset summary reports train-test duplicate patient IDs and a large positive-rate shift. |
| Claim Critic | not_ready | The current evidence supports "higher observed accuracy in this run package", not "significantly outperforms". |

## Blocking Issues

- **not_fair_yet**: The method and baseline use different preprocessing, image size, and augmentation settings.
- **high_risk**: The dataset summary reports train-test duplicate patient IDs and a large positive-rate shift.
- **not_ready**: The current evidence supports "higher observed accuracy in this run package", not "significantly outperforms".

## Recommended Next Steps

1. Remove train-test duplicate patients and regenerate the split.
2. Re-run Baseline-A with the same preprocessing, image size, and augmentation policy used by SciForgeNet.
3. Add confidence intervals and an explicit significance test across seeds or bootstrapped samples.
4. Record a locked runtime environment before publishing the result.
5. Until then, rewrite the claim as: "SciForgeNet shows a small observed improvement over Baseline-A in this preliminary run package."

## Demo Artifacts

- Child-run JSON records: `output/child-runs`
- Machine-readable summary: `output/claim-readiness-summary.json`
