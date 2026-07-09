import { describe, expect, it } from 'vitest'
import type { CapabilityToolProvider } from '../adapters/tool/capability-registry.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
import { parentToolProvidersForDelegatedResearch } from './runtime-factory.js'

function tool(name: string): LocalTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object' },
    toolKind: 'tool_call',
    policy: 'auto',
    execute: async () => ({ output: 'ok' })
  }
}

function provider(id: string, tools: string[]): CapabilityToolProvider {
  return {
    id,
    kind: 'mcp',
    enabled: true,
    available: true,
    tools: tools.map(tool)
  }
}

describe('parentToolProvidersForDelegatedResearch', () => {
  it('keeps parent and child catalogs identical when delegation is disabled', () => {
    const providers = [
      provider('mcp:gui_research', ['mcp_gui_research_research_search'])
    ]

    expect(parentToolProvidersForDelegatedResearch(providers, false)).toEqual(providers)
  })

  it('hides research search tools from the parent catalog when delegation is enabled', () => {
    const providers = [
      provider('mcp:gui_research', [
        'mcp_gui_research_research_search',
        'mcp_gui_research_research_search_diagnostics'
      ]),
      provider('mcp:gui_workspace_intel', ['mcp_gui_workspace_read']),
      provider('mcp:other', ['other_research_search', 'other_read'])
    ]

    const filtered = parentToolProvidersForDelegatedResearch(providers, true)
    const names = filtered.flatMap((entry) => entry.tools.map((entryTool) => entryTool.name))

    expect(filtered.map((entry) => entry.id)).not.toContain('mcp:gui_research')
    expect(names).not.toContain('mcp_gui_research_research_search')
    expect(names).not.toContain('mcp_gui_research_research_search_diagnostics')
    expect(names).not.toContain('other_research_search')
    expect(names).toContain('mcp_gui_workspace_read')
    expect(names).toContain('other_read')
  })

  it('removes generic MCP search entry points so the parent cannot discover gui_research indirectly', () => {
    const providers = [
      provider('mcp:search', ['mcp_search', 'mcp_call']),
      provider('mcp:gui_workspace_intel', ['mcp_gui_workspace_read'])
    ]

    const filtered = parentToolProvidersForDelegatedResearch(providers, true)

    expect(filtered.map((entry) => entry.id)).not.toContain('mcp:search')
    expect(filtered.flatMap((entry) => entry.tools.map((entryTool) => entryTool.name))).toEqual([
      'mcp_gui_workspace_read'
    ])
  })
})
