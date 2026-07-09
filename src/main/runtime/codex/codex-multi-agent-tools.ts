import type { AgentRuntimeChild } from '../../../shared/agent-runtime-contract'
import {
  EMPTY_MULTI_AGENT_USAGE,
  FileMultiAgentStore,
  InMemoryMultiAgentStore,
  MultiAgentRuntime,
  type MultiAgentChildEvent,
  type MultiAgentChildRunRecord,
  type MultiAgentExecutor,
  type MultiAgentExecutorResult,
  type MultiAgentStore,
  type MultiAgentUsage
} from '../../../../packages/workers/multi-agent/src'
import type {
  CodexAppServerDynamicToolCallRequest,
  CodexAppServerDynamicToolCallResponse,
  CodexAppServerDynamicToolSpec
} from './codex-dynamic-mcp-tools'

export const CODEX_MULTI_AGENT_NAMESPACE = 'multi_agent_v1'
export const CODEX_MULTI_AGENT_SPAWN_TOOL = 'spawn_agent'
export const CODEX_MULTI_AGENT_FLAT_TOOL_NAME = 'delegate_task'
export const CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME = 'delegate_research'
export const CODEX_RESEARCH_CHILD_ALLOWED_TOOL_NAMES = [
  'research_search',
  'research_search_diagnostics'
] as const
const CODEX_RESEARCH_CHILD_MAX_TOOL_CALLS = 3
const AGENTIC_RL_FINAL_AUDIT_CHECKLIST = [
  'GRPO-family/current policy-gradient variants: GRPO, Dr.GRPO, DAPO, VAPO, SAPO, GSPO',
  'Agent-training systems: Agent Lightning / LightningRL, Flow-GRPO, VSPO',
  'Classic or baseline methods: PPO, REINFORCE/RLOO/REINFORCE++, APPO/IMPALA where relevant',
  'Preference/value/process-reward methods: DPO/KTO/IPO, PRM/ORM, value-based or MCTS+value hybrids',
  'Task fit: verifiable reasoning, code/SWE agents, tool-use/web/computer-use, long-horizon multi-turn environments'
] as const
const AGENTIC_RL_RECENT_ALGORITHMS = [
  'GSPO',
  'DAPO',
  'Dr.GRPO',
  'VAPO',
  'SAPO',
  'Agent Lightning',
  'LightningRL',
  'Flow-GRPO',
  'VSPO'
] as const
const AGENTIC_RL_MANDATORY_SEARCH_QUERY = 'latest LLM agent RL algorithms GSPO DAPO Dr.GRPO VAPO SAPO Agent Lightning LightningRL Flow-GRPO VSPO 2025 2026'

export type CodexMultiAgentToolBridgeOptions = {
  enabled?: boolean
  maxParallel?: number
  maxChildren?: number
  store?: MultiAgentStore
  storeRoot?: string
  executor: MultiAgentExecutor
  onChildEvent?: (event: MultiAgentChildEvent) => Promise<void> | void
}

type ActiveRequest = {
  controller: AbortController
  threadId?: string
  turnId?: string
}

export function createCodexMultiAgentToolBridge(
  options: CodexMultiAgentToolBridgeOptions
): CodexMultiAgentToolBridge {
  return new CodexMultiAgentToolBridge(options)
}

export class CodexMultiAgentToolBridge {
  private readonly runtime: MultiAgentRuntime
  private readonly activeRequests = new Set<ActiveRequest>()
  private readonly maxParallel: number
  private readonly maxChildren: number

  constructor(private readonly options: CodexMultiAgentToolBridgeOptions) {
    this.maxParallel = options.maxParallel ?? 2
    this.maxChildren = options.maxChildren ?? 4
    this.runtime = new MultiAgentRuntime({
      config: {
        enabled: options.enabled ?? true,
        maxParallel: this.maxParallel,
        maxChildren: this.maxChildren
      },
      store: options.store ?? (options.storeRoot
        ? new FileMultiAgentStore(options.storeRoot)
        : new InMemoryMultiAgentStore()),
      executor: options.executor,
      events: options.onChildEvent ? { onChildEvent: options.onChildEvent } : undefined
    })
  }

  dynamicTools(): CodexAppServerDynamicToolSpec[] {
    if (this.options.enabled === false) return []
    return [
      {
        type: 'function',
        name: CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME,
        description: [
          'Plan and run a multi-agent research delegation for a complex research question.',
          'Use this before answering scientific literature research, related-work discovery, survey/report, benchmark/background, community-adoption, or current research requests.',
          'The tool decomposes the query into bounded subtopics, runs child agents under the configured parallel budget, asks each child to call research_search first when available, and returns child reports plus failure diagnostics for parent synthesis.',
          'Prefer this over manually calling delegate_task for broad research questions.'
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The user research question to decompose.' },
            prompt: { type: 'string', description: 'Alias for query.' },
            task: { type: 'string', description: 'Alias for query.' },
            focusAreas: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 6,
              description: 'Optional user-specified subtopics to assign to child agents.'
            },
            maxSubtasks: {
              type: 'integer',
              minimum: 1,
              maximum: 6,
              description: 'Maximum child tasks to launch.'
            },
            workspace: { type: 'string', description: 'Workspace root for child tasks.' },
            cwd: { type: 'string', description: 'Alias for workspace.' }
          },
          additionalProperties: false
        }
      },
      {
        type: 'function',
        name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
        description: [
          'Delegate one bounded child-agent task and return the child output.',
          'For broad research questions, use delegate_research instead so SciForge can decompose the query and run child agents under the parallel budget.',
          'For narrow research delegation, tell the child to call research_search first when available, then summarize paper/web evidence with titles, years, URLs, and source coverage.'
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The child agent task prompt.' },
            task: { type: 'string', description: 'Alias for prompt.' },
            instructions: { type: 'string', description: 'Alias for prompt.' },
            label: { type: 'string', description: 'Short label for the child agent.' },
            name: { type: 'string', description: 'Alias for label.' },
            workspace: { type: 'string', description: 'Workspace root for the child task.' },
            cwd: { type: 'string', description: 'Alias for workspace.' }
          },
          additionalProperties: false
        }
      }
    ]
  }

  canHandle(request: CodexAppServerDynamicToolCallRequest): boolean {
    const name = normalizedToolName(request)
    return name === CODEX_MULTI_AGENT_FLAT_TOOL_NAME ||
      name === CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME ||
      name === `${CODEX_MULTI_AGENT_NAMESPACE}.${CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME}` ||
      name === `${CODEX_MULTI_AGENT_NAMESPACE}.${CODEX_MULTI_AGENT_SPAWN_TOOL}` ||
      name === 'multi_agent_v1_spawn_agent'
  }

  async callTool(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    if (!this.canHandle(request)) {
      return failedMultiAgentResponse(`Unsupported multi-agent tool: ${displayToolName(request)}.`)
    }
    if (isResearchDelegationRequest(request)) {
      return this.callResearchDelegationTool(request)
    }
    const input = parseSpawnAgentArguments(request.arguments)
    if (!input.prompt) return failedMultiAgentResponse('delegate_task requires a prompt, task, or instructions string.')
    if (!request.threadId) return failedMultiAgentResponse('delegate_task requires threadId.')
    if (!request.turnId) return failedMultiAgentResponse('delegate_task requires turnId.')
    const researchChild = isResearchLikeChildTask(input.prompt)
    const childPrompt = researchChild ? enrichResearchChildPrompt(input.prompt) : input.prompt

    const active = { controller: new AbortController(), threadId: request.threadId, turnId: request.turnId }
    this.activeRequests.add(active)
    try {
      const record = await this.runtime.runChild({
        parentThreadId: request.threadId,
        parentTurnId: request.turnId,
        label: input.label,
        prompt: childPrompt,
        workspace: input.workspace,
        model: input.model,
        ...(researchChild ? researchChildToolPolicy() : {}),
        signal: active.controller.signal
      })
      return responseFromChildRecord(record, { parentPrompt: input.prompt })
    } finally {
      this.activeRequests.delete(active)
    }
  }

  private async callResearchDelegationTool(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    const input = parseResearchDelegationArguments(request.arguments)
    if (!input.query) return failedMultiAgentResponse('delegate_research requires a query, prompt, or task string.')
    if (!request.threadId) return failedMultiAgentResponse('delegate_research requires threadId.')
    if (!request.turnId) return failedMultiAgentResponse('delegate_research requires turnId.')

    const active = { controller: new AbortController(), threadId: request.threadId, turnId: request.turnId }
    this.activeRequests.add(active)
    try {
      const subtasks = planResearchDelegationSubtasks({
        query: input.query,
        focusAreas: input.focusAreas,
        maxSubtasks: input.maxSubtasks ?? this.maxChildren
      })
      const records = await runWithConcurrency(
        subtasks,
        Math.max(1, Math.min(this.maxParallel, subtasks.length)),
        async (subtask) => {
          try {
            return await this.runtime.runChild({
              parentThreadId: request.threadId!,
              parentTurnId: request.turnId!,
              label: subtask.label,
              prompt: subtask.prompt,
              workspace: input.workspace,
              ...researchChildToolPolicy(),
              signal: active.controller.signal
            })
          } catch (error) {
            return syntheticFailedChildRecord({
              parentThreadId: request.threadId!,
              parentTurnId: request.turnId!,
              label: subtask.label,
              prompt: subtask.prompt,
              message: errorMessage(error)
            })
          }
        }
      )
      return {
        success: true,
        contentItems: [{
          type: 'inputText',
          text: renderResearchDelegationResult({
            query: input.query,
            subtasks,
            records,
            maxParallel: this.maxParallel
          })
        }]
      }
    } catch (error) {
      return {
        success: true,
        contentItems: [{
          type: 'inputText',
          text: [
            'delegate_research could not complete the multi-agent orchestration.',
            `Failure: ${errorMessage(error)}`,
            'Continue from available context or use another available tool; do not let this tool failure abort the answer.'
          ].join(' ')
        }]
      }
    } finally {
      this.activeRequests.delete(active)
    }
  }

  abortRequestsForTurn(threadId: string, turnId: string): number {
    let aborted = 0
    for (const request of this.activeRequests) {
      if (request.threadId !== threadId || request.turnId !== turnId) continue
      if (request.controller.signal.aborted) continue
      request.controller.abort(new Error('multi-agent request aborted by parent turn interrupt'))
      aborted += 1
    }
    return aborted
  }

  async child(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    return this.runtime.child(parentThreadId, childId)
  }
}

export function codexChildFromMultiAgentRecord(
  record: MultiAgentChildRunRecord,
  event?: MultiAgentChildEvent
): AgentRuntimeChild {
  const usage = agentUsageFromMultiAgentUsage(record.usage)
  return {
    id: record.id,
    runtimeId: 'codex',
    parentThreadId: record.parentThreadId,
    parentTurnId: record.parentTurnId,
    kind: 'agent',
    status: record.status,
    ...(record.label ? { label: record.label, name: record.label } : {}),
    prompt: record.prompt,
    ...(record.summary ? { summary: record.summary } : {}),
    ...(usage ? { usage } : {}),
    transcriptRef: {
      runtimeId: 'codex',
      childId: record.id,
      transcriptId: record.threadRef?.threadId ?? record.id,
      source: 'codex-multi-agent',
      kind: record.threadRef?.threadId ? 'runtime' : 'remote'
    },
    ...(record.threadRef?.threadId
      ? {
          openAsThreadRef: {
            runtimeId: 'codex',
            threadId: record.threadRef.threadId,
            relation: 'side' as const,
            ...(record.threadRef.url ? { url: record.threadRef.url } : {})
          }
        }
      : {}),
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    updatedAt: record.updatedAt,
    ...(record.finishedAt ? { completedAt: record.finishedAt } : {}),
    metadata: {
      source: 'codex.multi_agent_v1.spawn_agent',
      ...(record.threadRef?.turnId ? { childTurnId: record.threadRef.turnId } : {}),
      ...(event?.seq !== undefined ? { childSeq: event.seq } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }
}

function responseFromChildRecord(
  record: MultiAgentChildRunRecord,
  options: { parentPrompt?: string } = {}
): CodexAppServerDynamicToolCallResponse {
  const ok = record.status !== 'failed' && record.status !== 'aborted'
  const baseText = ok
    ? record.summary?.trim() || 'Child agent completed without textual output.'
    : record.error?.message || record.summary?.trim() || 'Child agent failed.'
  const text = ok && options.parentPrompt && isAgenticRlPrompt(options.parentPrompt)
    ? appendAgenticRlParentSynthesisGuardrail(baseText)
    : baseText
  return {
    success: ok,
    contentItems: [{
      type: 'inputText',
      text
    }]
  }
}

type ResearchDelegationSubtask = {
  label: string
  focus: string
  prompt: string
}

type ResearchDelegationRecord = Pick<
  MultiAgentChildRunRecord,
  'id' | 'parentThreadId' | 'parentTurnId' | 'label' | 'prompt' | 'status' | 'summary' | 'error' | 'usage' | 'createdAt' | 'updatedAt'
>

export function planResearchDelegationSubtasks(input: {
  query: string
  focusAreas?: readonly string[]
  maxSubtasks?: number
}): ResearchDelegationSubtask[] {
  const query = input.query.trim()
  const maxSubtasks = clampInt(input.maxSubtasks, 1, 6, 4)
  const explicit = uniqueStrings(input.focusAreas ?? [])
    .slice(0, maxSubtasks)
    .map((focus, index) => researchSubtask({
      label: `Research ${index + 1}`,
      focus,
      query
    }))
  if (explicit.length > 0) return explicit

  const candidates: Array<{ label: string; focus: string; include: boolean; fallback?: boolean }> = [
    {
      label: 'Evidence',
      focus: 'Find current community or literature evidence for which approaches are actually used, emphasized, or declining.',
      include: isCurrentOrAdoptionQuery(query)
    },
    {
      label: 'Methods',
      focus: 'Identify concrete algorithms, baselines, variants, and representative papers or systems relevant to the query.',
      include: isAlgorithmOrMethodQuery(query)
    },
    {
      label: 'Tradeoffs',
      focus: 'Compare advantages, disadvantages, failure modes, and engineering constraints across the main alternatives.',
      include: isComparisonQuery(query)
    },
    {
      label: 'Task Fit',
      focus: 'Map each major approach to task scenarios, reward/evaluation assumptions, data requirements, and when not to use it.',
      include: isScenarioQuery(query)
    },
    {
      label: 'Implementation',
      focus: 'Look for benchmark, code, framework, dataset, and reproducibility signals that affect practical adoption.',
      include: isImplementationQuery(query)
    },
    {
      label: 'Landscape',
      focus: 'Build a taxonomy of the main concepts, method families, and important terms needed to answer the query.',
      include: true,
      fallback: true
    },
    {
      label: 'Gaps',
      focus: 'Surface unresolved disagreements, weak evidence, missing evaluations, and follow-up searches needed for confidence.',
      include: true,
      fallback: true
    }
  ]
  const selected = candidates.filter((candidate) => candidate.include)
  const balanced = ensureMinimumSubtasks(selected, candidates, 3).slice(0, maxSubtasks)
  return balanced.map((candidate) => researchSubtask({
    label: candidate.label,
    focus: candidate.focus,
    query
  }))
}

function researchSubtask(input: { label: string; focus: string; query: string }): ResearchDelegationSubtask {
  const seedQueries = researchSeedQueries(input.query, input.focus)
  return {
    label: input.label,
    focus: input.focus,
    prompt: [
      `User research question: ${input.query}`,
      `Your assigned focus: ${input.focus}`,
      `Suggested concise search queries: ${seedQueries.join(' | ')}`,
      'Call research_search first if it is available. Use source-specific queries when helpful, and do not fail the task just because one source or tool call fails.',
      'Start with the first concise query above. Run a second query only if the first result set is thin, off-topic, or misses the assigned focus. Do not paste this entire child prompt or the long focus sentence into the search box.',
      'Return a concise evidence report for the parent agent: key findings, titles/years/URLs for important papers or web evidence, source coverage, disagreements, limitations, and confidence.',
      'Do not write the final user answer; the parent agent will synthesize all child reports.'
    ].join('\n')
  }
}

function researchSeedQueries(query: string, focus: string): string[] {
  const normalizedFocus = focus.toLowerCase()
  const agenticRl = /\bagentic\s*rl\b|\brl\s*for\s*llm\b|\brlvr\b|\brlhf\b|强化学习.*(?:大模型|语言模型|智能体)|(?:大模型|语言模型|智能体).*强化学习/i.test(query)
  if (agenticRl) {
    const focusSeeds: string[] = []
    if (/\b(evidence|community|adoption|used|declining)\b/i.test(normalizedFocus)) {
      focusSeeds.push('agentic RL community adoption GSPO DAPO Dr.GRPO VAPO Agent Lightning 2025 2026')
    }
    if (/\b(tradeoffs?|compare|advantages?|disadvantages?|failure|constraints?)\b/i.test(normalizedFocus)) {
      focusSeeds.push('GSPO DAPO Dr.GRPO VAPO SAPO vs GRPO PPO comparison language models 2025 2026')
    }
    if (/\b(task|scenario|suitability|fit|application|reward|evaluation)\b/i.test(normalizedFocus)) {
      focusSeeds.push('multi-turn agentic RL Agent Lightning LightningRL Flow-GRPO VSPO tool-use agents')
    }
    if (/\b(methods?|algorithms?|baselines?|variants?)\b/i.test(normalizedFocus)) {
      focusSeeds.push('latest LLM agent RL algorithms GSPO DAPO Dr.GRPO VAPO SAPO LightningRL')
    }
    const coreSeeds = [
      '2025 2026 agentic reinforcement learning language model agents algorithms',
      'LLM agent reinforcement learning GSPO DAPO Dr.GRPO VAPO SAPO',
      'Agent Lightning LightningRL multi-turn tool-use agents reinforcement learning'
    ]
    return uniqueStrings([...focusSeeds, ...coreSeeds]).slice(0, 5)
  }
  const compact = compactResearchQuery(query)
  return uniqueStrings([
    compact,
    `${compact} survey`,
    `${compact} benchmark comparison`,
    `${compact} limitations applications`
  ]).slice(0, 4)
}

function compactResearchQuery(query: string): string {
  const latin = query.match(/[A-Za-z][A-Za-z0-9+./-]*(?:\s+[A-Za-z][A-Za-z0-9+./-]*)*/g)
    ?.map((term) => term.trim())
    .filter((term) => term.length > 1) ?? []
  const mapped: string[] = []
  if (/强化学习/i.test(query)) mapped.push('reinforcement learning')
  if (/智能体|代理/i.test(query)) mapped.push('agent')
  if (/算法|方法|策略优化/i.test(query)) mapped.push('algorithm')
  if (/优势|劣势|优劣|不足|限制/i.test(query)) mapped.push('advantages disadvantages limitations')
  if (/任务|场景|适配|适用/i.test(query)) mapped.push('task scenario suitability')
  const terms = uniqueStrings([...latin, ...mapped])
  return terms.length ? terms.join(' ') : query.trim().replace(/\s+/g, ' ')
}

function ensureMinimumSubtasks<T extends { label: string }>(
  selected: T[],
  candidates: Array<T & { fallback?: boolean }>,
  minimum: number
): T[] {
  if (selected.length >= minimum) return selected
  const out = [...selected]
  const seen = new Set(out.map((item) => item.label))
  for (const candidate of candidates.filter((item) => item.fallback)) {
    if (out.length >= minimum) break
    if (seen.has(candidate.label)) continue
    seen.add(candidate.label)
    out.push(candidate)
  }
  return out
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      out[index] = await run(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return out
}

function renderResearchDelegationResult(input: {
  query: string
  subtasks: readonly ResearchDelegationSubtask[]
  records: readonly ResearchDelegationRecord[]
  maxParallel: number
}): string {
  const completed = input.records.filter((record) => record.status === 'completed').length
  const failed = input.records.filter((record) => record.status === 'failed' || record.status === 'aborted').length
  const lines = [
    'Multi-agent research delegation completed.',
    `Query: ${input.query}`,
    `Child tasks: ${input.records.length}; completed: ${completed}; failed_or_aborted: ${failed}; configured_parallelism: ${input.maxParallel}.`,
    '',
    'Subtask plan:',
    ...input.subtasks.map((subtask, index) => `${index + 1}. ${subtask.label}: ${subtask.focus}`),
    '',
    'Child reports:'
  ]
  input.records.forEach((record, index) => {
    lines.push(
      '',
      `### ${record.label ?? input.subtasks[index]?.label ?? `Child ${index + 1}`}`,
      `status: ${record.status}`,
      record.error ? `error: ${record.error.message}` : '',
      record.summary?.trim() || 'No textual child output.'
    )
  })
  if (isAgenticRlPrompt(input.query)) {
    lines.push(
      '',
      'Agentic RL freshness constraint:',
      `The final parent answer must explicitly audit recent 2025-2026 methods/systems: ${AGENTIC_RL_RECENT_ALGORITHMS.join(', ')}. Do not present PPO/GRPO/DPO/RLOO-only coverage as comprehensive. If a method was not found by child searches, say it was searched for but not substantiated by the configured sources.`,
      '',
      'Required final-answer checklist:',
      ...AGENTIC_RL_FINAL_AUDIT_CHECKLIST.map((item) => `- ${item}`)
    )
  }
  lines.push(
    '',
    'Parent synthesis guidance: synthesize the completed child reports, deduplicate repeated papers or claims, cite titles/URLs when useful, and explicitly mention any failed child focus areas as evidence gaps rather than retrying the same failed tool.'
  )
  return lines.filter((line) => line !== '').join('\n')
}

function syntheticFailedChildRecord(input: {
  parentThreadId: string
  parentTurnId: string
  label: string
  prompt: string
  message: string
}): ResearchDelegationRecord {
  const now = new Date().toISOString()
  return {
    id: `synthetic-failed-${Math.random().toString(36).slice(2, 8)}`,
    parentThreadId: input.parentThreadId,
    parentTurnId: input.parentTurnId,
    label: input.label,
    prompt: input.prompt,
    status: 'failed',
    error: {
      code: 'child_failed',
      message: input.message || 'child run failed before it could start'
    },
    usage: EMPTY_MULTI_AGENT_USAGE,
    createdAt: now,
    updatedAt: now
  }
}

function parseSpawnAgentArguments(value: unknown): {
  prompt: string
  label?: string
  workspace?: string
  model?: string
} {
  const args = recordArguments(value)
  const prompt = firstString(args.prompt, args.task, args.instructions, args.input, args.message)
  const label = firstString(args.label, args.name, args.agentName, args.agent)
  const workspace = firstString(args.workspace, args.cwd, args.workspaceRoot)
  const model = firstString(args.model)
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {})
  }
}

function parseResearchDelegationArguments(value: unknown): {
  query: string
  focusAreas?: string[]
  maxSubtasks?: number
  workspace?: string
} {
  const args = recordArguments(value)
  const query = firstString(args.query, args.prompt, args.task, args.instructions, args.input, args.message)
  const focusAreas = arrayValue(args.focusAreas)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
  const maxSubtasks = numberValue(args.maxSubtasks)
  const workspace = firstString(args.workspace, args.cwd, args.workspaceRoot)
  return {
    query,
    ...(focusAreas.length ? { focusAreas } : {}),
    ...(maxSubtasks !== undefined ? { maxSubtasks } : {}),
    ...(workspace ? { workspace } : {})
  }
}

function normalizedToolName(request: CodexAppServerDynamicToolCallRequest): string {
  if (request.namespace) return `${request.namespace}.${request.tool}`.trim()
  return request.tool.trim()
}

function isResearchDelegationRequest(request: CodexAppServerDynamicToolCallRequest): boolean {
  const name = normalizedToolName(request)
  return name === CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME ||
    name === `${CODEX_MULTI_AGENT_NAMESPACE}.${CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME}`
}

function researchChildToolPolicy(): {
  allowedToolNames: readonly string[]
  strictAllowedToolNames: true
  maxToolCalls: number
} {
  return {
    allowedToolNames: CODEX_RESEARCH_CHILD_ALLOWED_TOOL_NAMES,
    strictAllowedToolNames: true,
    maxToolCalls: CODEX_RESEARCH_CHILD_MAX_TOOL_CALLS
  }
}

function isResearchLikeChildTask(prompt: string): boolean {
  return /\b(research|survey|literature|papers?|related[- ]work|benchmark|background|adoption|community|current|recent|state of the art|SOTA|github|open[- ]source|implementation|algorithm|tradeoff|comparison)\b/i.test(prompt) ||
    /调研|研究|论文|文献|综述|相关工作|社区|普遍采用|采用|当前|最新|算法|方法|优劣|优势|劣势|适配|场景|开源|实现|基准|评测/u.test(prompt)
}

function enrichResearchChildPrompt(prompt: string): string {
  if (!isAgenticRlPrompt(prompt)) return prompt
  const algorithms = AGENTIC_RL_RECENT_ALGORITHMS.join(', ')
  return [
    prompt,
    '',
    'SciForge research guardrail for current agentic RL:',
    `Do not stop at legacy PPO/GRPO/DPO/RLOO/RLHF coverage. Explicitly search recent 2025-2026 agentic/LLM RL algorithm variants and systems such as ${algorithms}, plus task-specific variants for multi-turn, tool-use, code, web, and computer-use agents.`,
    `Your first research_search query must be exactly: ${AGENTIC_RL_MANDATORY_SEARCH_QUERY}`,
    'Report which recent variants were found or not found. If the assigned focus is a legacy family such as PPO, still include how newer variants relate to or replace it.'
  ].join('\n')
}

function appendAgenticRlParentSynthesisGuardrail(text: string): string {
  return [
    text,
    '',
    'Parent synthesis constraint: this was an agentic RL research child. The final answer must include a freshness audit for GSPO, DAPO, Dr.GRPO, VAPO, SAPO, Agent Lightning/LightningRL, Flow-GRPO, and VSPO. Do not write a PPO/GRPO/DPO/RLOO-only answer as if it is comprehensive.',
    'Required final-answer checklist:',
    ...AGENTIC_RL_FINAL_AUDIT_CHECKLIST.map((item) => `- ${item}`)
  ].join('\n')
}

function isAgenticRlPrompt(prompt: string): boolean {
  return /\bagentic\s*rl\b|\bagentic reinforcement learning\b|\brl\s*for\s*(?:llm|language model|agents?)\b|\bllm agents?.*\brl\b|\brlvr\b|\brlhf\b|强化学习.*(?:大模型|语言模型|智能体)|(?:大模型|语言模型|智能体).*强化学习/i.test(prompt)
}

function displayToolName(request: CodexAppServerDynamicToolCallRequest): string {
  return request.namespace ? `${request.namespace}.${request.tool}` : request.tool
}

function recordArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.trunc(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ')
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function isCurrentOrAdoptionQuery(query: string): boolean {
  return /\b(current|latest|recent|adopt|adoption|community|popular|trend|practice|commonly|widely)\b/i.test(query) ||
    /[\u793e\u533a\u666e\u904d\u91c7\u7528\u9009\u62e9]/u.test(query)
}

function isAlgorithmOrMethodQuery(query: string): boolean {
  return /\b(algorithms?|methods?|approaches|baselines?|variants?|famil(?:y|ies)|techniques?)\b/i.test(query) ||
    /[\u7b97\u6cd5\u65b9\u6cd5\u8def\u7ebf]/u.test(query)
}

function isComparisonQuery(query: string): boolean {
  return /\b(compare|comparison|versus|vs\.?|tradeoff|pros?|cons?|advantage|disadvantage|strength|weakness)\b/i.test(query) ||
    /[\u4f18\u52bf\u52a3\u52bf\u5bf9\u6bd4\u6bd4\u8f83]/u.test(query)
}

function isScenarioQuery(query: string): boolean {
  return /\b(task|scenario|fit|suitable|when to use|application|use case)\b/i.test(query) ||
    /[\u4efb\u52a1\u573a\u666f\u9002\u914d\u5e94\u7528]/u.test(query)
}

function isImplementationQuery(query: string): boolean {
  return /\b(code|github|implementation|framework|benchmark|dataset|leaderboard|reproducible)\b/i.test(query) ||
    /[\u4ee3\u7801\u5b9e\u73b0\u5f00\u6e90\u57fa\u51c6\u8bc4\u6d4b\u6570\u636e]/u.test(query)
}

function agentUsageFromMultiAgentUsage(usage: MultiAgentUsage = EMPTY_MULTI_AGENT_USAGE): AgentRuntimeChild['usage'] | undefined {
  const normalized = {
    ...(usage.promptTokens ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.totalTokens ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cachedTokens ? { cacheReadTokens: usage.cachedTokens } : {})
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function failedMultiAgentResponse(message: string): CodexAppServerDynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: message }]
  }
}
