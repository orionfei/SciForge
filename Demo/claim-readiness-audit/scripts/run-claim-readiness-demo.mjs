import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MultiAgentRuntime } from '../../../packages/workers/multi-agent/dist/runtime.js'
import { FileMultiAgentStore } from '../../../packages/workers/multi-agent/dist/store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(__dirname, '..')
const inputDir = path.join(demoRoot, 'input')
const outputDir = path.join(demoRoot, 'output')
const childRunDir = path.join(outputDir, 'child-runs')

async function main() {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(childRunDir, { recursive: true })

  const packet = await loadResearchPacket(inputDir)
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 5, maxChildren: 8, childTimeoutMs: 30_000 },
    store: new FileMultiAgentStore(childRunDir),
    executor: createDeterministicAuditExecutor(packet)
  })

  const parentThreadId = 'claim-readiness-demo'
  const parentTurnId = `turn-${Date.now()}`
  const specialists = [
    ['Result Analyst', 'Quantify metric lift, stability across seeds, and whether significance is justified.'],
    ['Baseline Critic', 'Check whether the baseline comparison is fair and complete.'],
    ['Reproducibility Auditor', 'Check whether another researcher can reproduce this result package.'],
    ['Data Risk Auditor', 'Check data leakage, split quality, imbalance, and distribution shift.'],
    ['Claim Critic', 'Judge whether the proposed manuscript claim is supported by the evidence.']
  ]

  const childRuns = await Promise.all(
    specialists.map(([label, instruction]) =>
      runtime.runChild({
        parentThreadId,
        parentTurnId,
        label,
        workspace: demoRoot,
        prompt: [
          `Role: ${label}`,
          `Instruction: ${instruction}`,
          `Claim: ${packet.claim}`
        ].join('\n')
      })
    )
  )

  const report = renderReport(packet, childRuns)
  await writeFile(path.join(outputDir, 'claim-readiness-report.md'), report, 'utf8')
  await writeFile(path.join(outputDir, 'claim-readiness-summary.json'), JSON.stringify({
    verdict: 'not_ready',
    parentThreadId,
    parentTurnId,
    childRuns: childRuns.map((run) => ({
      id: run.id,
      label: run.label,
      status: run.status,
      summary: run.summary
    }))
  }, null, 2) + '\n', 'utf8')

  console.log(`Demo completed: ${path.join(outputDir, 'claim-readiness-report.md')}`)
  console.log(`Child run records: ${childRunDir}`)
}

async function loadResearchPacket(root) {
  const [claim, resultsCsv, configText, datasetText, trainLog] = await Promise.all([
    readFile(path.join(root, 'claim.txt'), 'utf8'),
    readFile(path.join(root, 'results.csv'), 'utf8'),
    readFile(path.join(root, 'config.json'), 'utf8'),
    readFile(path.join(root, 'dataset_summary.json'), 'utf8'),
    readFile(path.join(root, 'train.log'), 'utf8')
  ])
  return {
    claim: claim.trim(),
    results: parseCsv(resultsCsv),
    config: JSON.parse(configText),
    dataset: JSON.parse(datasetText),
    trainLog
  }
}

function createDeterministicAuditExecutor(packet) {
  return async ({ childId, label, appendTranscript }) => {
    await appendTranscript({
      id: `${childId}-event-load`,
      kind: 'tool',
      text: `Loaded claim.txt, results.csv, config.json, dataset_summary.json, and train.log for ${label}.`,
      createdAt: new Date().toISOString()
    })

    const finding = runSpecialistAudit(label, packet)
    const summary = [
      `Verdict: ${finding.verdict}`,
      `Key finding: ${finding.keyFinding}`,
      `Evidence: ${finding.evidence.join(' | ')}`,
      `Recommendation: ${finding.recommendation}`
    ].join('\n')

    return {
      summary,
      transcript: [{
        id: `${childId}-finding`,
        kind: 'assistant_message',
        text: summary,
        createdAt: new Date().toISOString(),
        metadata: finding
      }],
      usage: {
        promptTokens: 320,
        completionTokens: 180,
        totalTokens: 500,
        turns: 1
      }
    }
  }
}

function runSpecialistAudit(label, packet) {
  const stats = computeResultStats(packet.results)
  switch (label) {
    case 'Result Analyst':
      return {
        verdict: 'weak_support',
        keyFinding: `Mean accuracy lift is ${formatPct(stats.accuracyLift)} and mean macro-F1 lift is ${formatPct(stats.macroF1Lift)}, but no statistical test or confidence interval is present.`,
        evidence: [
          `Baseline-A mean accuracy ${formatPct(stats.baselineAccuracy)}`,
          `SciForgeNet mean accuracy ${formatPct(stats.methodAccuracy)}`,
          `3 seeds available`
        ],
        recommendation: 'Add confidence intervals and a paired or bootstrap significance test before using "significantly outperforms".'
      }
    case 'Baseline Critic':
      return {
        verdict: 'not_fair_yet',
        keyFinding: 'The method and baseline use different preprocessing, image size, and augmentation settings.',
        evidence: [
          `Baseline preprocessing ${packet.config.baseline.preprocessing}, image size ${packet.config.baseline.image_size}`,
          `Method preprocessing ${packet.config.method.preprocessing}, image size ${packet.config.method.image_size}`,
          `Method augmentation ${packet.config.method.augmentation}`
        ],
        recommendation: 'Re-run Baseline-A under the same preprocessing and image-size policy, or narrow the claim to this exact setup.'
      }
    case 'Reproducibility Auditor':
      return {
        verdict: 'partially_reproducible',
        keyFinding: 'Seeds and logs exist, but the environment is under-specified.',
        evidence: [
          `Recorded seeds: ${packet.config.random_seeds.join(', ')}`,
          `CUDA: ${packet.config.environment.cuda}`,
          `Requirements lock: ${packet.config.environment.requirements_lock}`
        ],
        recommendation: 'Add a locked environment file and record CUDA/library versions before treating this as manuscript-grade evidence.'
      }
    case 'Data Risk Auditor':
      return {
        verdict: 'high_risk',
        keyFinding: 'The dataset summary reports train-test duplicate patient IDs and a large positive-rate shift.',
        evidence: [
          `Train-test duplicate patient IDs: ${packet.dataset.patient_overlap.train_test_duplicate_patient_ids}`,
          `Train positive rate ${formatPct(packet.dataset.positive_rate.train)}`,
          `Test positive rate ${formatPct(packet.dataset.positive_rate.test)}`
        ],
        recommendation: 'Remove overlapping patients, regenerate splits, and report class-balanced metrics after the fix.'
      }
    case 'Claim Critic':
      return {
        verdict: 'not_ready',
        keyFinding: 'The current evidence supports "higher observed accuracy in this run package", not "significantly outperforms".',
        evidence: [
          `Observed accuracy lift ${formatPct(stats.accuracyLift)}`,
          'No significance test',
          'Fairness and data-risk agents found blocking issues'
        ],
        recommendation: 'Downgrade the claim or complete the blocking follow-up experiments before writing it into the paper.'
      }
    default:
      return {
        verdict: 'unknown',
        keyFinding: `No deterministic audit rule exists for ${label}.`,
        evidence: [],
        recommendation: 'Add a specialist rule.'
      }
  }
}

function renderReport(packet, childRuns) {
  const rows = childRuns.map((run) => {
    const metadata = run.transcript.find((entry) => entry.metadata)?.metadata ?? {}
    return `| ${run.label} | ${metadata.verdict ?? run.status} | ${metadata.keyFinding ?? run.summary?.split('\n')[0] ?? ''} |`
  }).join('\n')

  const blocking = childRuns
    .map((run) => run.transcript.find((entry) => entry.metadata)?.metadata)
    .filter((metadata) => ['not_ready', 'not_fair_yet', 'high_risk'].includes(metadata?.verdict))

  return `# Claim Readiness Audit

## Proposed Claim

${packet.claim}

## Final Verdict

**Not ready for manuscript use.**

The observed result is promising, but the multi-agent audit found blocking issues in baseline fairness, data split integrity, and claim wording. A single-agent summary could easily overstate the positive metric lift; this workflow forces independent reviewers to check different failure modes before the final claim is accepted.

## Specialist Findings

| Agent | Verdict | Key finding |
| --- | --- | --- |
${rows}

## Blocking Issues

${blocking.map((issue) => `- **${issue.verdict}**: ${issue.keyFinding}`).join('\n')}

## Recommended Next Steps

1. Remove train-test duplicate patients and regenerate the split.
2. Re-run Baseline-A with the same preprocessing, image size, and augmentation policy used by SciForgeNet.
3. Add confidence intervals and an explicit significance test across seeds or bootstrapped samples.
4. Record a locked runtime environment before publishing the result.
5. Until then, rewrite the claim as: "SciForgeNet shows a small observed improvement over Baseline-A in this preliminary run package."

## Demo Artifacts

- Child-run JSON records: \`output/child-runs\`
- Machine-readable summary: \`output/claim-readiness-summary.json\`
`
}

function computeResultStats(rows) {
  const baseline = rows.filter((row) => row.method === 'Baseline-A')
  const method = rows.filter((row) => row.method === 'SciForgeNet')
  const baselineAccuracy = mean(baseline.map((row) => Number(row.accuracy)))
  const methodAccuracy = mean(method.map((row) => Number(row.accuracy)))
  const baselineMacroF1 = mean(baseline.map((row) => Number(row.macro_f1)))
  const methodMacroF1 = mean(method.map((row) => Number(row.macro_f1)))
  return {
    baselineAccuracy,
    methodAccuracy,
    accuracyLift: methodAccuracy - baselineAccuracy,
    baselineMacroF1,
    methodMacroF1,
    macroF1Lift: methodMacroF1 - baselineMacroF1
  }
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const values = line.split(',')
    return Object.fromEntries(header.map((key, index) => [key, values[index]]))
  })
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
