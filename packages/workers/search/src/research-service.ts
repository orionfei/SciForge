import { ArxivResearchProvider } from './providers/arxiv.js';
import { BiorxivResearchProvider } from './providers/biorxiv.js';
import { EuropePmcResearchProvider } from './providers/europe-pmc.js';
import { SemanticScholarResearchProvider } from './providers/semantic-scholar.js';
import { TavilyResearchProvider } from './providers/tavily.js';
import {
  buildInitialGaps,
  buildSuggestedFollowups,
  buildThemeClusters,
  mergeAndRankPapers,
  mergeAndRankWebResults
} from './ranking.js';
import { planResearchQueries } from './query-planner.js';
import type {
  ResearchPaper,
  ResearchProviderDiagnostic,
  ResearchProviderId,
  ResearchSearchConfig,
  ResearchSearchInput,
  ResearchSearchOutput,
  ResearchSearchProvider,
  ResearchSourceKind,
  ResearchWebResult
} from './types.js';

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_QUERY_COUNT = 5;
const DEFAULT_CNS_DOMAINS = ['nature.com', 'science.org', 'cell.com'];
const DEFAULT_BIORXIV_WEB_DOMAINS = ['biorxiv.org'];

type ProviderEntry = {
  source: ResearchSourceKind;
  provider: ResearchSearchProvider;
};

export type ResearchSearchServiceOptions = {
  providers?: Partial<Record<ResearchProviderId, ResearchSearchProvider>>;
};

export class ResearchSearchService {
  private readonly providers: ProviderEntry[];

  constructor(
    readonly config: ResearchSearchConfig,
    options: ResearchSearchServiceOptions = {}
  ) {
    this.providers = buildProviderEntries(config, options.providers ?? {});
  }

  configuredDiagnostics(): ResearchProviderDiagnostic[] {
    return configuredDiagnostics(this.config);
  }

  async search(input: ResearchSearchInput): Promise<ResearchSearchOutput> {
    const query = input.query.trim();
    if (!query) throw new Error('query is required');
    const maxResults = boundedInt(input.maxResults, this.config.maxResults, 1, this.config.maxResults);
    const plan = planResearchQueries({
      query,
      intent: input.intent,
      domain: input.domain,
      maxQueries: MAX_QUERY_COUNT
    });
    const sinceYear = boundedYear(
      input.sinceYear,
      this.config.defaultSinceYear ?? plan.analysis.metadata.earliestYear
    );
    const sources = normalizeSources(input.sources);
    const activeProviders = this.providers.filter((item) => !sources || sources.includes(item.source));
    if (activeProviders.length === 0) {
      throw new Error(`no requested research sources are enabled: ${(sources ?? allSources()).join(', ')}`);
    }

    const diagnostics: ResearchProviderDiagnostic[] = [];
    const papers: ResearchPaper[] = [];
    const webResults: ResearchWebResult[] = [];
    const signal = input.signal ?? new AbortController().signal;
    const searchJobs = activeProviders.flatMap(({ source, provider }) => {
      const sourceQueries = queriesForSource(plan.sourceQueries[source], plan.generatedQueries, MAX_QUERY_COUNT);
      const perQueryLimit = Math.max(1, Math.ceil(maxResults / sourceQueries.length));
      return sourceQueries.map((generatedQuery) =>
        safeProviderSearch(provider, {
          query: generatedQuery,
          intent: plan.interpretedIntent.intent,
          domain: plan.interpretedIntent.domain,
          ...(sinceYear ? { sinceYear } : {}),
          maxResults: perQueryLimit,
          timeoutMs: this.config.timeoutMs || DEFAULT_TIMEOUT_MS,
          signal
        })
      );
    });
    const results = await Promise.all(searchJobs);
    for (const result of results) {
      papers.push(...result.papers);
      webResults.push(...result.webResults);
      diagnostics.push(...(result.diagnostics ?? []));
    }

    const rankedPapers = mergeAndRankPapers({
      papers,
      query: plan.analysis.keywordQuery || plan.normalizedGoal,
      intent: plan.interpretedIntent.intent,
      relevanceCriteria: plan.analysis.relevanceCriteria,
      centrality: plan.analysis.metadata.centrality,
      recency: plan.analysis.metadata.recency,
      maxResults
    });
    const rankedWebResults = mergeAndRankWebResults({
      webResults,
      maxResults
    });

    return {
      answerGuidance: [
        'Use this tool result as internal evidence.',
        'Answer in the user language.',
        'Summarize the main findings, cite titles/URLs where useful, and mention provider issues or gaps.',
        'Do not call research_search again unless a required source failed or the user explicitly asks for a follow-up search.',
        'Do not paste raw structured JSON unless the user explicitly requested raw output.'
      ].join(' '),
      interpretedIntent: plan.interpretedIntent,
      searchPlan: {
        normalizedGoal: plan.normalizedGoal,
        language: plan.language,
        content: plan.analysis.content,
        rewrittenQuery: plan.analysis.rewrittenQuery,
        keywordQuery: plan.analysis.keywordQuery,
        coreConcepts: plan.coreConcepts,
        methods: plan.methods,
        entities: plan.entities,
        metadata: plan.analysis.metadata,
        relevanceCriteria: plan.analysis.relevanceCriteria,
        sourceQueries: plan.sourceQueries
      },
      generatedQueries: plan.generatedQueries,
      papers: rankedPapers,
      webResults: rankedWebResults,
      themes: buildThemeClusters(rankedPapers),
      gaps: buildInitialGaps({ papers: rankedPapers, webResults: rankedWebResults }),
      suggestedFollowups: buildSuggestedFollowups({
        query,
        intent: plan.interpretedIntent.intent,
        papers: rankedPapers
      }),
      diagnostics: summarizeDiagnostics([...this.configuredDiagnostics(), ...diagnostics]),
      citations: citationsFor(rankedPapers, rankedWebResults)
    };
  }
}

export function createResearchSearchService(
  config: ResearchSearchConfig = researchSearchConfigFromEnv(),
  options: ResearchSearchServiceOptions = {}
): ResearchSearchService {
  return new ResearchSearchService(config, options);
}

export function researchSearchConfigFromEnv(env: Record<string, string | undefined> = process.env): ResearchSearchConfig {
  const tavilyApiKey = stringEnv(env, 'SCIFORGE_RESEARCH_TAVILY_API_KEY') || stringEnv(env, 'TAVILY_API_KEY');
  const semanticScholarApiKey = stringEnv(env, 'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_API_KEY');
  return {
    arxivEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_ARXIV_ENABLED', true),
    biorxivEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_BIORXIV_ENABLED', true),
    biorxivWebEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_BIORXIV_WEB_ENABLED', Boolean(tavilyApiKey)),
    europePmcEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_EUROPE_PMC_ENABLED', true),
    semanticScholarEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_ENABLED', true),
    semanticScholarApiKey,
    tavilyEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_TAVILY_ENABLED', Boolean(tavilyApiKey)),
    tavilyApiKey,
    cnsEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_CNS_ENABLED', Boolean(tavilyApiKey)),
    cnsDomains: listEnv(env, 'SCIFORGE_RESEARCH_CNS_DOMAINS', DEFAULT_CNS_DOMAINS),
    defaultSinceYear: numberEnv(env, 'SCIFORGE_RESEARCH_DEFAULT_SINCE_YEAR'),
    maxResults: boundedInt(numberEnv(env, 'SCIFORGE_RESEARCH_MAX_RESULTS'), DEFAULT_MAX_RESULTS, 1, 50),
    timeoutMs: boundedInt(numberEnv(env, 'SCIFORGE_RESEARCH_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS, 1_000, 120_000)
  };
}

function buildProviderEntries(
  config: ResearchSearchConfig,
  providers: Partial<Record<ResearchProviderId, ResearchSearchProvider>>
): ProviderEntry[] {
  const entries: ProviderEntry[] = [];
  if (config.arxivEnabled) entries.push({ source: 'arxiv', provider: providers.arxiv ?? new ArxivResearchProvider() });
  if (config.biorxivEnabled) entries.push({ source: 'biorxiv', provider: providers.biorxiv ?? new BiorxivResearchProvider() });
  if (config.biorxivWebEnabled) {
    entries.push({
      source: 'biorxiv_web',
      provider: providers.biorxiv_web ?? new TavilyResearchProvider(config.tavilyApiKey, {
        id: 'biorxiv_web',
        includeDomains: DEFAULT_BIORXIV_WEB_DOMAINS,
        resultSource: 'biorxiv_web'
      })
    });
  }
  if (config.europePmcEnabled) {
    entries.push({
      source: 'europe_pmc',
      provider: providers.europe_pmc ?? new EuropePmcResearchProvider()
    });
  }
  if (config.semanticScholarEnabled) {
    entries.push({
      source: 'semantic_scholar',
      provider: providers.semantic_scholar ?? new SemanticScholarResearchProvider(config.semanticScholarApiKey)
    });
  }
  if (config.tavilyEnabled) {
    entries.push({ source: 'web', provider: providers.tavily ?? new TavilyResearchProvider(config.tavilyApiKey) });
  }
  if (config.cnsEnabled) {
    entries.push({
      source: 'cns',
      provider: providers.cns ?? new TavilyResearchProvider(config.tavilyApiKey, {
        id: 'cns',
        includeDomains: config.cnsDomains,
        resultSource: 'cns'
      })
    });
  }
  return entries;
}

function configuredDiagnostics(config: ResearchSearchConfig): ResearchProviderDiagnostic[] {
  return [
    {
      id: 'arxiv',
      enabled: config.arxivEnabled,
      available: config.arxivEnabled
    },
    {
      id: 'biorxiv',
      enabled: config.biorxivEnabled,
      available: config.biorxivEnabled
    },
    {
      id: 'biorxiv_web',
      enabled: config.biorxivWebEnabled,
      available: config.biorxivWebEnabled && Boolean(config.tavilyApiKey.trim()),
      ...(config.biorxivWebEnabled && !config.tavilyApiKey.trim()
        ? { reason: 'Tavily API key is required for bioRxiv domain search' }
        : {})
    },
    {
      id: 'europe_pmc',
      enabled: config.europePmcEnabled,
      available: config.europePmcEnabled
    },
    {
      id: 'semantic_scholar',
      enabled: config.semanticScholarEnabled,
      available: config.semanticScholarEnabled
    },
    {
      id: 'tavily',
      enabled: config.tavilyEnabled,
      available: config.tavilyEnabled && Boolean(config.tavilyApiKey.trim()),
      ...(config.tavilyEnabled && !config.tavilyApiKey.trim() ? { reason: 'Tavily API key is required' } : {})
    },
    {
      id: 'cns',
      enabled: config.cnsEnabled,
      available: config.cnsEnabled && Boolean(config.tavilyApiKey.trim()),
      ...(config.cnsEnabled && !config.tavilyApiKey.trim()
        ? { reason: 'Tavily API key is required for CNS official-site search' }
        : {})
    }
  ];
}

function normalizeSources(value: unknown): ResearchSourceKind[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = value.filter((item): item is ResearchSourceKind =>
    item === 'arxiv' ||
    item === 'biorxiv' ||
    item === 'biorxiv_web' ||
    item === 'europe_pmc' ||
    item === 'semantic_scholar' ||
    item === 'web' ||
    item === 'cns'
  );
  return out.length ? [...new Set(out)] : null;
}

function summarizeDiagnostics(diagnostics: ResearchProviderDiagnostic[]): ResearchProviderDiagnostic[] {
  const byId = new Map<ResearchProviderId, ResearchProviderDiagnostic>();
  for (const diagnostic of diagnostics) {
    const current = byId.get(diagnostic.id);
    byId.set(diagnostic.id, {
      id: diagnostic.id,
      enabled: current?.enabled ?? diagnostic.enabled,
      available: (current?.available ?? false) || diagnostic.available,
      resultCount: (current?.resultCount ?? 0) + (diagnostic.resultCount ?? 0),
      ...(diagnostic.reason && !(current?.available) ? { reason: diagnostic.reason } : {})
    });
  }
  return [...byId.values()];
}

function citationsFor(
  papers: ResearchPaper[],
  webResults: Array<{ title: string; url: string; source: string }>
) {
  return [
    ...papers.map((paper) => ({
      title: paper.title,
      url: paper.url ?? paper.pdfUrl ?? '',
      source: paper.source.join(',')
    })),
    ...webResults.map((result) => ({
      title: result.title,
      url: result.url,
      source: result.source
    }))
  ].filter((item) => item.url);
}

function allSources(): ResearchSourceKind[] {
  return ['arxiv', 'biorxiv', 'biorxiv_web', 'europe_pmc', 'semantic_scholar', 'web', 'cns'];
}

function queriesForSource(
  sourceQueries: string[] | undefined,
  fallbackQueries: string[],
  maxQueries: number
): string[] {
  const queries = (sourceQueries?.length ? sourceQueries : fallbackQueries)
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set(queries)].slice(0, Math.max(1, maxQueries));
}

async function safeProviderSearch(
  provider: ResearchSearchProvider,
  request: Parameters<ResearchSearchProvider['search']>[0]
): Promise<Awaited<ReturnType<ResearchSearchProvider['search']>>> {
  try {
    return await provider.search(request);
  } catch (error) {
    return {
      papers: [],
      webResults: [],
      diagnostics: [{
        id: provider.id,
        enabled: true,
        available: false,
        reason: errorMessage(error)
      }]
    };
  }
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function boundedYear(value: unknown, fallback: number | undefined): number | undefined {
  const year = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  if (!year) return undefined;
  return Math.min(3000, Math.max(1991, year));
}

function stringEnv(env: Record<string, string | undefined>, name: string): string {
  return env[name]?.trim() ?? '';
}

function booleanEnv(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(value)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(value)) return false;
  return fallback;
}

function numberEnv(env: Record<string, string | undefined>, name: string): number | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listEnv(env: Record<string, string | undefined>, name: string, fallback: string[]): string[] {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
