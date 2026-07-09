import { EMPTY_MULTI_AGENT_USAGE, MultiAgentRuntimeError, type MultiAgentRuntime } from '@sciforge/multi-agent'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const DEFAULT_DELEGATE_TIMEOUT_MS = 600_000
const MAX_DELEGATE_TIMEOUT_MS = 1_200_000
const PARALLEL_BUDGET_RETRY_MS = 250
const RESEARCH_CHILD_MAX_TOOL_CALLS = 12
const RESEARCH_CHILD_ALLOWED_TOOL_NAMES = [
  'web_search',
  'web_fetch',
  'mcp_gui_research_research_search'
] as const

const CHILD_AGENT_RUNTIME_GUARDRAILS = [
  'Child-agent runtime guardrails:',
  '- Work only inside the assigned workspace unless a tool explicitly permits otherwise.',
  '- Never read app settings, API key files, tokens, or secrets from paths outside the workspace.',
  '- If local Model Router access is needed, use environment variables only: SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY for the key, SCIFORGE_MODEL_ROUTER_BASE_URL for the base URL, and SCIFORGE_MODEL_ROUTER_MODEL for the model. Never print secret values.',
  '- Treat the delegated prompt as a bounded execution request, not as an interactive consultation. Do not ask the parent or user what to do next.',
  '- For research/source-collection tasks, gather enough evidence and then synthesize. Do not keep searching after 8-12 useful sources, and do not use bash/curl/wget for web research; use web/research tools.',
  '- If the delegated task names deliverables, output paths, or file mutations, create or edit those files with tools before your final response.',
  '- Before declaring completion, verify requested files or observable outputs only when the task asks for files or local outputs. For research tasks, cite fetched sources instead of shell verification.',
  '- If you cannot complete the delegated task, start the final response with CHILD_AGENT_BLOCKED and explain the blocker plus any partial work.',
  '- If you complete the delegated task after initially thinking it was blocked, do not include CHILD_AGENT_BLOCKED anywhere in the final response.',
  '- Before editing an existing file, read that file in this child run first; if a read-before-edit guard blocks an edit, read the file and retry once.',
  '',
  'Delegated task:'
].join('\n')

export function buildDelegationToolProviders(runtime: MultiAgentRuntime | undefined): CapabilityToolProvider[] {
  if (!runtime) return []
  return [{
    id: 'delegation',
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'delegate_task',
        description: 'Run one bounded child agent task and return its summary. For broad research/survey/literature tasks, prefer delegate_tasks so multiple focused child agents can run in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            prompt: { type: 'string' },
            workspace: { type: 'string' },
            model: { type: 'string' },
            timeout_ms: { type: 'number' }
          },
          required: ['prompt'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
          if (!prompt) return { output: { error: 'prompt is required' }, isError: true }
          const spawnIndex = (await runtime.diagnostics(context.threadId)).childRuns.length + 1
          const timeoutMs = normalizeDelegateTimeoutMs(args.timeout_ms, DEFAULT_DELEGATE_TIMEOUT_MS)
          const task = {
            prompt,
            ...(typeof args.label === 'string' ? { label: args.label } : {})
          }
          if (isBroadResearchDelegationPrompt(prompt)) {
            return runDelegateTasksBatch({
              runtime,
              context,
              tasks: researchFanoutTasks(prompt),
              sharedWorkspace: typeof args.workspace === 'string' ? args.workspace.trim() : '',
              sharedModel: normalizeDelegateModel(args.model),
              sharedTimeoutMs: timeoutMs,
              fanoutReason: 'Broad research prompt auto-split into focused parallel child tasks. Use delegate_tasks directly for this workflow.'
            })
          }
          const childToolPolicy = childToolPolicyForPrompt(
            prompt,
            context.explicitAllowedToolNames,
            context.explicitStrictAllowedToolNames === true
          )
          let record: DelegateRecordLike
          try {
            record = await runDelegateChildWithWatchdog({
              parentSignal: context.abortSignal,
              timeoutMs,
              run: (signal) => retryWhileParallelBudgetExhausted(signal, () => runtime.runChild({
                parentThreadId: context.threadId,
                parentTurnId: context.turnId,
                label: typeof args.label === 'string' ? args.label : undefined,
                prompt: withChildRuntimeGuardrails(prompt),
                workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
                model: normalizeDelegateModel(args.model) ?? context.model?.id,
                childTimeoutMs: timeoutMs,
                ...(childToolPolicy.allowedToolNames ? { allowedToolNames: childToolPolicy.allowedToolNames } : {}),
                strictAllowedToolNames: childToolPolicy.strictAllowedToolNames,
                ...(childToolPolicy.maxToolCalls !== undefined ? { maxToolCalls: childToolPolicy.maxToolCalls } : {}),
                ...(context.bashCommandPolicy ? { bashCommandPolicy: context.bashCommandPolicy } : {}),
                ...(context.filePathPolicy ? { filePathPolicy: context.filePathPolicy } : {}),
                signal
              }))
            })
          } catch (error) {
            record = failedDelegateRecord(task, 0, error, context.threadId, context.turnId)
          }
          return {
            output: {
              childId: record.id,
              status: record.status,
              summary: record.summary,
              error: record.error,
              usage: record.usage,
              effective_timeout_ms: timeoutMs,
              ...(spawnIndex > 1
                ? { warning: `This is child agent spawn #${spawnIndex} for the thread. Spawn only when the extra prefix/cache cost is worth it.` }
                : {})
            },
            isError: record.status === 'failed' || record.status === 'aborted'
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'delegate_tasks',
        description: 'Run a batch of bounded child agent tasks concurrently up to the configured subagent parallel budget and return their summaries. Use this by default for research/survey/literature/community-adoption tasks: split into 3-5 evidence-isolated directions such as exact terminology, scholarly papers/citations, code ecosystem adoption, and community discussion.',
        inputSchema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  prompt: { type: 'string' },
                  workspace: { type: 'string' },
                  model: { type: 'string' },
                  timeout_ms: { type: 'number' }
                },
                required: ['prompt'],
                additionalProperties: false
              }
            },
            workspace: { type: 'string' },
            model: { type: 'string' },
            timeout_ms: { type: 'number' }
          },
          required: ['tasks'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const rawTasks = Array.isArray(args.tasks) ? args.tasks : []
          const tasks = rawTasks
            .map((task) => normalizeDelegateTask(task))
            .filter((task): task is NormalizedDelegateTask => task != null)
          if (tasks.length === 0) return { output: { error: 'at least one task with a prompt is required' }, isError: true }

          return runDelegateTasksBatch({
            runtime,
            context,
            tasks,
            sharedWorkspace: typeof args.workspace === 'string' ? args.workspace.trim() : '',
            sharedModel: normalizeDelegateModel(args.model),
            sharedTimeoutMs: normalizeDelegateTimeoutMs(args.timeout_ms, DEFAULT_DELEGATE_TIMEOUT_MS)
          })
        }
      })
    ]
  }]
}

export function withChildRuntimeGuardrails(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.startsWith(CHILD_AGENT_RUNTIME_GUARDRAILS)) return trimmed
  return `${CHILD_AGENT_RUNTIME_GUARDRAILS}\n\n${trimmed}`
}

type NormalizedDelegateTask = {
  prompt: string
  label?: string
  workspace?: string
  model?: string
  timeoutMs?: number
}

function normalizeDelegateTask(value: unknown): NormalizedDelegateTask | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (!prompt) return null
  const label = trimOptional(record.label)
  const workspace = trimOptional(record.workspace)
  const model = normalizeDelegateModel(record.model)
  const timeoutMs = normalizeDelegateTimeoutMs(record.timeout_ms)
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {})
  }
}

function trimOptional(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : undefined
}

function normalizeDelegateModel(value: unknown): string | undefined {
  const model = trimOptional(value)
  if (!model || model.toLowerCase() === 'auto') return undefined
  return model
}

function normalizeDelegateTimeoutMs(value: unknown, defaultMs?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultMs
  const normalized = Math.trunc(value)
  if (normalized <= 0) return defaultMs
  return Math.min(normalized, MAX_DELEGATE_TIMEOUT_MS)
}

type DelegateRecordLike = Awaited<ReturnType<MultiAgentRuntime['runChild']>>

async function runDelegateTasksBatch(input: {
  runtime: MultiAgentRuntime
  context: ToolHostContext
  tasks: NormalizedDelegateTask[]
  sharedWorkspace?: string
  sharedModel?: string
  sharedTimeoutMs?: number
  fanoutReason?: string
}): Promise<{ output: unknown; isError?: boolean }> {
  const diagnostics = await input.runtime.diagnostics(input.context.threadId)
  const availableParallel = Math.max(1, diagnostics.config.maxParallel - diagnostics.active)
  const concurrency = Math.min(input.tasks.length, availableParallel)
  const firstSpawnIndex = diagnostics.childRuns.length + 1
  const sharedTimeoutMs = input.sharedTimeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS
  const records = await runWithConcurrency(input.tasks, concurrency, async (task, index) => {
    const timeoutMs = task.timeoutMs ?? sharedTimeoutMs
    const childToolPolicy = childToolPolicyForPrompt(
      task.prompt,
      input.context.explicitAllowedToolNames,
      input.context.explicitStrictAllowedToolNames === true
    )
    try {
      return await runDelegateChildWithWatchdog({
        parentSignal: input.context.abortSignal,
        timeoutMs,
        run: (signal) => retryWhileParallelBudgetExhausted(signal, () => input.runtime.runChild({
          parentThreadId: input.context.threadId,
          parentTurnId: input.context.turnId,
          label: task.label,
          prompt: withChildRuntimeGuardrails(task.prompt),
          workspace: (task.workspace ?? input.sharedWorkspace) || input.context.workspace,
          model: task.model ?? input.sharedModel ?? input.context.model?.id,
          childTimeoutMs: timeoutMs,
          ...(childToolPolicy.allowedToolNames ? { allowedToolNames: childToolPolicy.allowedToolNames } : {}),
          strictAllowedToolNames: childToolPolicy.strictAllowedToolNames,
          ...(childToolPolicy.maxToolCalls !== undefined ? { maxToolCalls: childToolPolicy.maxToolCalls } : {}),
          ...(input.context.bashCommandPolicy ? { bashCommandPolicy: input.context.bashCommandPolicy } : {}),
          ...(input.context.filePathPolicy ? { filePathPolicy: input.context.filePathPolicy } : {}),
          signal
        }))
      })
    } catch (error) {
      return failedDelegateRecord(task, index, error, input.context.threadId, input.context.turnId)
    }
  })
  const children = records.map((record, index) => ({
    childId: record.id,
    label: record.label,
    status: record.status,
    summary: record.summary,
    error: record.error,
    usage: record.usage,
    effective_timeout_ms: input.tasks[index]?.timeoutMs ?? sharedTimeoutMs
  }))
  const completed = children.filter((child) => child.status === 'completed').length
  const failed = children.filter((child) => child.status === 'failed').length
  const aborted = children.filter((child) => child.status === 'aborted').length
  const terminal = completed + failed + aborted
  const batchStatus = completed === children.length
    ? 'completed'
    : terminal === children.length && completed > 0
      ? 'partial'
      : 'failed'
  return {
    output: {
      children,
      total: children.length,
      status: batchStatus,
      completed,
      failed,
      aborted,
      concurrency,
      configured_concurrency: diagnostics.config.maxParallel,
      effective_timeout_ms: sharedTimeoutMs,
      ...(input.fanoutReason ? { fanout: true, fanout_reason: input.fanoutReason } : {}),
      ...(firstSpawnIndex > 1
        ? { warning: `This batch starts at child agent spawn #${firstSpawnIndex} for the thread. Spawn only when the extra prefix/cache cost is worth it.` }
        : {})
    },
    isError: batchStatus === 'failed'
  }
}

async function retryWhileParallelBudgetExhausted(
  signal: AbortSignal,
  run: () => Promise<DelegateRecordLike>
): Promise<DelegateRecordLike> {
  while (true) {
    try {
      return await run()
    } catch (error) {
      if (!isParallelBudgetExhausted(error) || signal.aborted) throw error
      await delay(PARALLEL_BUDGET_RETRY_MS, signal)
    }
  }
}

function isParallelBudgetExhausted(error: unknown): boolean {
  if (error instanceof MultiAgentRuntimeError) return error.code === 'parallel_budget_exhausted' && error.retryable !== false
  return error instanceof Error && /\bmulti-agent parallel budget exhausted\b/i.test(error.message)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('delegate child run aborted'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timeout)
      reject(signal.reason instanceof Error ? signal.reason : new Error('delegate child run aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function runDelegateChildWithWatchdog(input: {
  parentSignal?: AbortSignal
  timeoutMs?: number
  run: (signal: AbortSignal) => Promise<DelegateRecordLike>
}): Promise<DelegateRecordLike> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: ((error: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  aborted.catch(() => undefined)
  const abort = (error: Error) => {
    if (!controller.signal.aborted) controller.abort(error)
    rejectAbort?.(error)
  }
  const abortFromParent = () => abort(new Error('delegate child run aborted'))
  if (input.parentSignal?.aborted) {
    abortFromParent()
  } else {
    input.parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }
  const timedOut = input.timeoutMs === undefined
    ? undefined
    : new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`delegate child run timed out after ${input.timeoutMs}ms`)
          if (!controller.signal.aborted) controller.abort(error)
          reject(error)
        }, input.timeoutMs)
      })
  try {
    return await Promise.race([
      input.run(controller.signal),
      aborted,
      ...(timedOut ? [timedOut] : [])
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    input.parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function failedDelegateRecord(
  task: NormalizedDelegateTask,
  index: number,
  error: unknown,
  parentThreadId: string,
  parentTurnId: string
): DelegateRecordLike {
  const message = error instanceof Error ? error.message : String(error)
  const aborted = isAbortLikeError(error, message)
  const now = new Date().toISOString()
  return {
    contractVersion: 1,
    id: `delegate_${aborted ? 'aborted' : 'failed'}_${index + 1}`,
    parentThreadId,
    parentTurnId,
    label: task.label,
    prompt: task.prompt,
    status: aborted ? 'aborted' : 'failed',
    summary: `Child agent ${aborted ? 'aborted' : 'failed'} before completion: ${message}`,
    error: {
      code: aborted ? 'child_aborted' : 'child_failed',
      message,
      retryable: !aborted && /\b(timeout|timed out|parallel|budget|unavailable|overloaded|503|502|504)\b/i.test(message)
    },
    usage: EMPTY_MULTI_AGENT_USAGE,
    transcript: [],
    createdAt: now,
    updatedAt: now,
    finishedAt: now
  }
}

function isAbortLikeError(error: unknown, message: string): boolean {
  if (error instanceof MultiAgentRuntimeError) return error.code === 'child_aborted'
  if (error instanceof Error && error.name === 'AbortError') return true
  return /\b(abort|aborted|cancelled|interrupted|user_stop)\b/i.test(message)
}

function childToolPolicyForPrompt(
  prompt: string,
  explicitAllowedToolNames: readonly string[] | undefined,
  explicitStrictAllowedToolNames: boolean
): { allowedToolNames?: string[]; strictAllowedToolNames: boolean; maxToolCalls?: number } {
  if (!isResearchCollectionPrompt(prompt)) {
    return {
      ...(explicitAllowedToolNames ? { allowedToolNames: [...explicitAllowedToolNames] } : {}),
      strictAllowedToolNames: explicitStrictAllowedToolNames
    }
  }

  const researchAllowed = new Set<string>(RESEARCH_CHILD_ALLOWED_TOOL_NAMES)
  if (explicitAllowedToolNames) {
    return {
      allowedToolNames: explicitAllowedToolNames.filter((toolName) => researchAllowed.has(toolName)),
      strictAllowedToolNames: true,
      maxToolCalls: RESEARCH_CHILD_MAX_TOOL_CALLS
    }
  }

  return {
    allowedToolNames: [...RESEARCH_CHILD_ALLOWED_TOOL_NAMES],
    strictAllowedToolNames: true,
    maxToolCalls: RESEARCH_CHILD_MAX_TOOL_CALLS
  }
}

function isResearchCollectionPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  return [
    /\bresearch\b/,
    /\bcollect\b/,
    /\bsources?\b/,
    /\bcitations?\b/,
    /\blatest\b/,
    /\bbenchmark/,
    /\bgithub\b/,
    /\bhuggingface\b/,
    /收集/,
    /调研/,
    /研究/,
    /最新/,
    /来源/,
    /引用/,
    /开源/,
    /基准/,
    /定价/
  ].some((pattern) => pattern.test(normalized))
}

function isBroadResearchDelegationPrompt(prompt: string): boolean {
  if (!isResearchCollectionPrompt(prompt)) return false
  const normalized = prompt.toLowerCase()
  return prompt.length > 220 || [
    /调研.*(?:社区|趋势|选择|对比|相关工作|综述)/,
    /(?:社区|趋势|选择|对比|相关工作|综述).*调研/,
    /请查找以下信息/,
    /(?:^|\n)\s*\d+[.、]/,
    /\b(?:survey|literature review|related work|community adoption|trend|comparison|compare|vs\.?)\b/
  ].some((pattern) => pattern.test(normalized))
}

function researchFanoutTasks(prompt: string): NormalizedDelegateTask[] {
  const taskPrefix = [
    '这是一个并行调研子任务。只完成本方向，不要试图覆盖全部问题。',
    '优先使用可用的 research/search 工具；返回简洁证据：标题、年份、URL/来源覆盖、关键结论和不确定性。',
    '不要使用 bash/curl/wget/浏览器自动化，不要输出长篇背景。',
    '',
    '原始用户问题：',
    prompt
  ].join('\n')
  return [
    {
      label: 'exact-identity-terminology',
      prompt: `${taskPrefix}\n\n方向：精确身份与术语验证。只负责确认关键缩写/方法名的正确全称、是否存在正式论文、是否有误称或缩写冲突。对 GSPO 必须同时搜索 GSPO、"Group Sequence Policy Optimization"、以及常见错误展开；输出可验证来源和结论，不评估社区采用。`
    },
    {
      label: 'scholarly-paper-citations',
      prompt: `${taskPrefix}\n\n方向：论文与引用证据。只查 arXiv、Semantic Scholar、OpenAlex/学术索引、会议/技术报告等学术来源，比较 GRPO、GSPO 及相关方法在论文中的出现时间、引用/提及和代表性工作；不要使用 GitHub star 或社媒作为证据。`
    },
    {
      label: 'code-ecosystem-adoption',
      prompt: `${taskPrefix}\n\n方向：代码生态采用。只查 GitHub、HuggingFace、TRL、verl、OpenRLHF、RLHFFlow、Unsloth、框架文档和实现教程，判断工程社区实际集成/默认支持/使用频率；不要用论文引用作为主要证据。`
    },
    {
      label: 'community-discourse-trends',
      prompt: `${taskPrefix}\n\n方向：社区讨论与趋势。只查博客、论坛、Reddit/X/LinkedIn 摘要、厂商公告、教程文章和社区问答，提取 2024-2026 年大家讨论 GRPO、GSPO、DAPO、SAPO、RLOO 等路线时的偏好和理由；明确区分传闻、教程和正式证据。`
    }
  ]
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await run(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}
