import { describe, expect, it, vi } from 'vitest'
import { InMemoryMultiAgentStore } from '../../../../packages/workers/multi-agent/src'
import {
  CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
  CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME,
  CODEX_RESEARCH_CHILD_ALLOWED_TOOL_NAMES,
  planResearchDelegationSubtasks,
  createCodexMultiAgentToolBridge
} from './codex-multi-agent-tools'

describe('Codex multi-agent dynamic tools', () => {
  it('advertises the flat spawn tool expected by Codex app-server', () => {
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor: async () => ({ summary: 'unused' })
    })

    expect(bridge.dynamicTools()).toEqual([
      expect.objectContaining({
        type: 'function',
        name: CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME,
        description: expect.stringContaining('multi-agent research delegation'),
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            query: expect.objectContaining({ type: 'string' }),
            maxSubtasks: expect.objectContaining({ type: 'integer' })
          })
        })
      }),
      expect.objectContaining({
        type: 'function',
        name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
        description: expect.stringContaining('delegate_research'),
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            prompt: expect.objectContaining({ type: 'string' }),
            task: expect.objectContaining({ type: 'string' }),
            instructions: expect.objectContaining({ type: 'string' })
          })
        })
      })
    ])
  })

  it('plans broad research questions into reusable subagent facets', () => {
    const subtasks = planResearchDelegationSubtasks({
      query: '现在的agentic RL社区内普遍采用的RL算法有哪些？各自的优势劣势以及适配的任务场景是什么？',
      maxSubtasks: 4
    })

    expect(subtasks.length).toBe(4)
    expect(subtasks.map((task) => task.label)).toEqual([
      'Evidence',
      'Methods',
      'Tradeoffs',
      'Task Fit'
    ])
    expect(subtasks.every((task) => task.prompt.includes('Call research_search first'))).toBe(true)
    expect(subtasks.every((task) => task.prompt.includes('Start with the first concise query'))).toBe(true)
    expect(subtasks.every((task) => task.prompt.includes('Run a second query only if'))).toBe(true)
    expect(subtasks.find((task) => task.label === 'Evidence')?.prompt).toContain('GSPO DAPO Dr.GRPO VAPO')
    expect(subtasks.find((task) => task.label === 'Tradeoffs')?.prompt).toContain('GSPO DAPO Dr.GRPO VAPO SAPO')
    expect(subtasks.find((task) => task.label === 'Task Fit')?.prompt).toContain('Agent Lightning LightningRL')
  })

  it('runs research subtasks under the parallel budget and reports child failures without failing the tool', async () => {
    let active = 0
    let maxActive = 0
    const executor = vi.fn(async ({ label }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      if (label === 'Methods') throw new Error('provider failed')
      return { summary: `report:${label}` }
    })
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      maxParallel: 2,
      maxChildren: 4,
      executor
    })

    await expect(bridge.callTool({
      requestId: 'research',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_RESEARCH_TOOL_NAME,
      arguments: {
        query: 'agentic RL algorithms adopted by the community, tradeoffs, and task fit',
        maxSubtasks: 4
      }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [expect.objectContaining({
        type: 'inputText',
        text: expect.stringContaining('failed_or_aborted: 1')
      })]
    })
    expect(executor).toHaveBeenCalledTimes(4)
    for (const call of executor.mock.calls) {
      expect(call[0]).toMatchObject({
        allowedToolNames: CODEX_RESEARCH_CHILD_ALLOWED_TOOL_NAMES,
        strictAllowedToolNames: true,
        maxToolCalls: 3
      })
    }
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('constrains research-like delegate_task children to research tools', async () => {
    const executor = vi.fn(async () => ({ summary: 'research-child-ok' }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'manual-research-child',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: {
        label: 'code_ecosystem',
        prompt: 'Research the code ecosystem and open-source implementations for agentic RL algorithms.'
      }
    })).resolves.toEqual({
      success: true,
      contentItems: [{
        type: 'inputText',
        text: expect.stringContaining('Parent synthesis constraint')
      }]
    })

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      allowedToolNames: CODEX_RESEARCH_CHILD_ALLOWED_TOOL_NAMES,
      strictAllowedToolNames: true,
      maxToolCalls: 3,
      prompt: expect.stringContaining('Do not stop at legacy PPO/GRPO/DPO/RLOO/RLHF coverage')
    }))
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('GSPO, DAPO, Dr.GRPO, VAPO')
    }))
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Your first research_search query must be exactly: latest LLM agent RL algorithms GSPO DAPO Dr.GRPO VAPO SAPO Agent Lightning LightningRL Flow-GRPO VSPO 2025 2026')
    }))
  })

  it('handles flat and namespace spawn calls through the shared runtime', async () => {
    const executor = vi.fn(async ({ prompt }) => ({
      summary: `done: ${prompt}`,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
    }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'flat',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'A', prompt: 'first' }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText', text: 'done: first' }]
    })

    await expect(bridge.callTool({
      requestId: 'namespaced',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      namespace: 'multi_agent_v1',
      tool: 'spawn_agent',
      arguments: { name: 'B', task: 'second' }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText', text: 'done: second' }]
    })
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('rejects empty prompts without starting a child run', async () => {
    const executor = vi.fn(async () => ({ summary: 'unreachable' }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'empty',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'A' }
    })).resolves.toEqual({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: 'delegate_task requires a prompt, task, or instructions string.'
      }]
    })
    expect(executor).not.toHaveBeenCalled()
  })
})
