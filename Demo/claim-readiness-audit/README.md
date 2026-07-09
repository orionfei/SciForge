# Claim Readiness Audit Demo

This demo tests whether SciForge's current multi-agent runtime can support a short, valuable research task:

> Given a small experimental result package and a proposed paper claim, decide whether the claim is ready to write into a manuscript.

Run:

```powershell
node .\Demo\claim-readiness-audit\scripts\run-claim-readiness-demo.mjs
```

The runner launches five specialist child runs through `@sciforge/multi-agent`:

- Result Analyst
- Baseline Critic
- Reproducibility Auditor
- Data Risk Auditor
- Claim Critic

It then writes a combined report to `output/claim-readiness-report.md` and child-run records to `output/child-runs`.
