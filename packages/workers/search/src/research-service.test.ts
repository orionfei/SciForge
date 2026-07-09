import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createResearchSearchService,
  researchSearchConfigFromEnv
} from './research-service.js';
import { buildArxivQuery } from './providers/arxiv.js';
import {
  buildEuropePmcQuery,
  parseEuropePmcPapers
} from './providers/europe-pmc.js';
import { SemanticScholarResearchProvider } from './providers/semantic-scholar.js';
import { planResearchQueries } from './query-planner.js';
import type {
  ResearchSourceKind,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from './types.js';

class FakeProvider implements ResearchSearchProvider {
  readonly id;

  constructor(
    id: ResearchSearchProvider['id'],
    private readonly handler: (request: ResearchSearchRequest) => ResearchSearchProviderResult
  ) {
    this.id = id;
  }

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    return this.handler(request);
  }
}

describe('research search service', () => {
  it('plans domain and intent query expansions', () => {
    const plan = planResearchQueries({
      query: 'latest protein foundation model benchmark',
      maxQueries: 4
    });

    assert.equal(plan.interpretedIntent.intent, 'latest');
    assert.equal(plan.interpretedIntent.domain, 'biology');
    assert.ok(plan.generatedQueries.some((query) => query.includes('computational biology')));
  });

  it('uses wet-biology query expansions for meiotic entry searches', () => {
    const plan = planResearchQueries({
      query: 'STRA8 MEIOSIN meiosis initiation mammalian germ cells',
      maxQueries: 4
    });

    assert.equal(plan.interpretedIntent.domain, 'biology');
    assert.ok(plan.generatedQueries.some((query) => query.includes('PubMed Europe PMC')));
    assert.ok(plan.generatedQueries.some((query) => query.includes('meiotic entry retinoic acid')));
    assert.ok(!plan.generatedQueries.some((query) => query.includes('protein design')));
  });

  it('builds English source-specific query pack from Chinese research goals', () => {
    const plan = planResearchQueries({
      query: '实现一个用于蛋白结合物设计的扩散模型，找相关工作和开源代码',
      maxQueries: 3
    });

    assert.equal(plan.language, 'zh');
    assert.equal(plan.interpretedIntent.domain, 'biology');
    assert.match(plan.normalizedGoal, /protein binder/i);
    assert.match(plan.normalizedGoal, /diffusion model/i);
    assert.ok(plan.coreConcepts.includes('protein'));
    assert.ok(plan.methods.includes('diffusion model'));
    assert.ok(plan.sourceQueries.semantic_scholar?.every((query) => !/[\u3400-\u9fff]/.test(query)));
    assert.ok(plan.sourceQueries.biorxiv_web?.some((query) => /bioRxiv preprint/i.test(query)));
    assert.ok(plan.sourceQueries.web?.some((query) => /GitHub|implementation/i.test(query)));
  });

  it('expands current RL acronyms for mixed Chinese-English research queries', () => {
    const plan = planResearchQueries({
      query: '帮我调研一下现在社区里面agentic RL大家选择GRPO还是GSPO？',
      maxQueries: 3
    });

    assert.equal(plan.language, 'mixed');
    assert.equal(plan.interpretedIntent.domain, 'ai4s');
    assert.doesNotMatch(plan.normalizedGoal, /[\u3400-\u9fff]/);
    assert.ok(plan.coreConcepts.includes('GSPO'));
    assert.ok(plan.coreConcepts.includes('Group Sequence Policy Optimization'));
    assert.ok(plan.generatedQueries.some((query) => /Group Relative Policy Optimization/i.test(query)));
    assert.ok(plan.sourceQueries.arxiv?.some((query) => /Group Sequence Policy Optimization/i.test(query)));
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /Group Sequence Policy Optimization/i.test(query)));
    assert.ok(plan.sourceQueries.web?.some((query) => /Group Sequence Policy Optimization/i.test(query)));
  });

  it('builds concise English seed queries for Chinese agentic RL algorithm surveys', () => {
    const plan = planResearchQueries({
      query: '现在的agentic RL社区内普遍采用的RL算法有哪些？各自的优势劣势以及适配的任务场景是什么？',
      maxQueries: 5
    });

    assert.equal(plan.language, 'mixed');
    assert.equal(plan.interpretedIntent.intent, 'latest');
    assert.equal(plan.interpretedIntent.domain, 'ai4s');
    assert.equal(plan.analysis.metadata.recency, 'recent');
    assert.equal(plan.analysis.metadata.earliestYear, 2024);
    assert.doesNotMatch(plan.normalizedGoal, /[\u3400-\u9fff]/);
    assert.ok(plan.generatedQueries.some((query) => /LLM agents.*reinforcement learning algorithms|reinforcement learning.*LLM agents/i.test(query)));
    assert.ok(plan.generatedQueries.some((query) => /GSPO|DAPO|Dr\.GRPO|Agent Lightning/i.test(query)));
    assert.ok(plan.generatedQueries.some((query) => /2024 2025 2026|current practice/i.test(query)));
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /language model|LLM agents/i.test(query)));
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /GSPO/i.test(query)));
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /DAPO/i.test(query)));
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /Dr\.GRPO|VAPO|SAPO/i.test(query)));
  });

  it('corrects the common GSPO wrong expansion during query planning', () => {
    const plan = planResearchQueries({
      query: 'GSPO Group Superior Policy Optimization vs GRPO for agentic RL',
      maxQueries: 3
    });

    assert.ok(plan.generatedQueries.some((query) => /Group Sequence Policy Optimization/i.test(query)));
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /GSPO "Group Sequence Policy Optimization"/i.test(query)));
  });

  it('analyzes scholarly metadata and relevance criteria from paper-finder style queries', () => {
    const plan = planResearchQueries({
      query: 'latest Nature papers by Andrew Ng on deep reinforcement learning since 2020',
      maxQueries: 3
    });

    assert.equal(plan.analysis.metadata.recency, 'recent');
    assert.equal(plan.analysis.metadata.earliestYear, 2020);
    assert.deepEqual(plan.analysis.metadata.authors, ['Andrew Ng']);
    assert.deepEqual(plan.analysis.metadata.venues, ['Nature']);
    assert.match(plan.analysis.keywordQuery, /deep reinforcement learning/i);
    assert.ok(plan.analysis.relevanceCriteria.required.length > 0);
    assert.ok(plan.sourceQueries.semantic_scholar?.some((query) => /Nature Andrew Ng/i.test(query)));
  });

  it('builds arXiv queries with date filters', () => {
    assert.match(
      buildArxivQuery('AI for protein design latest 2026', 2024),
      /submittedDate:\[202401010000 TO 299912312359\]/
    );
  });

  it('builds and parses Europe PMC paper results', () => {
    assert.match(
      buildEuropePmcQuery('STRA8 MEIOSIN meiosis initiation', 2024),
      /FIRST_PDATE:\[2024-01-01 TO \d{4}-\d{2}-\d{2}\]/
    );

    const papers = parseEuropePmcPapers({
      resultList: {
        result: [{
          id: '41287933',
          source: 'MED',
          pmid: '41287933',
          doi: '10.1242/dev.205037',
          title: 'MEIOC prevents continued mitotic cycling and promotes meiotic entry during mouse oogenesis.',
          authorString: 'Ushuhuda EG, Nguyen JT.',
          pubYear: '2026',
          journalInfo: { journal: { title: 'Development' } },
          abstractText: '<p>MEIOC promotes meiotic entry.</p>',
          citedByCount: '2'
        }]
      }
    });

    assert.equal(papers.length, 1);
    assert.equal(papers[0]?.source[0], 'europe_pmc');
    assert.equal(papers[0]?.year, 2026);
    assert.equal(papers[0]?.venue, 'Development');
    assert.equal(papers[0]?.citationCount, 2);
    assert.equal(papers[0]?.url, 'https://europepmc.org/article/MED/41287933');
  });

  it('reads provider toggles from environment', () => {
    const config = researchSearchConfigFromEnv({
      SCIFORGE_RESEARCH_ARXIV_ENABLED: 'false',
      SCIFORGE_RESEARCH_TAVILY_API_KEY: 'tvly-key',
      SCIFORGE_RESEARCH_MAX_RESULTS: '7'
    });

    assert.equal(config.arxivEnabled, false);
    assert.equal(config.europePmcEnabled, true);
    assert.equal(config.tavilyEnabled, true);
    assert.equal(config.cnsEnabled, true);
    assert.equal(config.maxResults, 7);
  });

  it('searches selected sources and merges duplicate papers', async () => {
    const service = createResearchSearchService({
      arxivEnabled: true,
      biorxivEnabled: false,
      biorxivWebEnabled: false,
      europePmcEnabled: true,
      semanticScholarEnabled: true,
      semanticScholarApiKey: '',
      tavilyEnabled: true,
      tavilyApiKey: 'key',
      cnsEnabled: false,
      cnsDomains: [],
      maxResults: 5,
      timeoutMs: 1000
    }, {
      providers: {
        arxiv: new FakeProvider('arxiv', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author'],
            year: 2025,
            doi: '10.1234/example',
            abstract: 'molecular generation benchmark',
            url: 'https://arxiv.org/abs/2501.00001',
            source: ['arxiv']
          }],
          webResults: [],
          diagnostics: [{ id: 'arxiv', enabled: true, available: true, resultCount: 1 }]
        })),
        semantic_scholar: new FakeProvider('semantic_scholar', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author', 'B. Author'],
            year: 2025,
            doi: '10.1234/example',
            citationCount: 12,
            abstract: 'molecular generation benchmark and evaluation',
            url: 'https://example.test/paper',
            source: ['semantic_scholar']
          }],
          webResults: [],
          diagnostics: [{ id: 'semantic_scholar', enabled: true, available: true, resultCount: 1 }]
        })),
        europe_pmc: new FakeProvider('europe_pmc', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author', 'C. Curator'],
            year: 2025,
            doi: '10.1234/example',
            citationCount: 2,
            abstract: 'molecular generation benchmark curated in Europe PMC',
            url: 'https://europepmc.org/article/MED/123',
            source: ['europe_pmc']
          }],
          webResults: [],
          diagnostics: [{ id: 'europe_pmc', enabled: true, available: true, resultCount: 1 }]
        })),
        tavily: new FakeProvider('tavily', () => ({
          papers: [],
          webResults: [{
            title: 'Project page',
            url: 'https://example.test/project?utm=1',
            snippet: 'Open source implementation',
            source: 'tavily',
            rank: 1
          }],
          diagnostics: [{ id: 'tavily', enabled: true, available: true, resultCount: 1 }]
        }))
      }
    });

    const result = await service.search({
      query: 'molecular generation benchmark',
      sources: ['arxiv', 'europe_pmc', 'semantic_scholar', 'web'],
      maxResults: 5
    });

    assert.equal(result.papers.length, 1);
    assert.deepEqual(result.papers[0]?.source.sort(), ['arxiv', 'europe_pmc', 'semantic_scholar']);
    assert.equal(result.webResults.length, 1);
    assert.ok(result.citations.some((citation) => citation.source === 'arxiv,europe_pmc,semantic_scholar'));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.id === 'tavily' && diagnostic.available));
  });

  it('routes source-specific queries and searches providers concurrently', async () => {
    const seenQueries = new Map<string, string[]>();
    const delayedProvider = (id: ResearchSearchProvider['id']) => new FakeProvider(id, (request) => {
      const queries = seenQueries.get(id) ?? [];
      queries.push(request.query);
      seenQueries.set(id, queries);
      return {
        papers: [{
          title: `${id} paper`,
          authors: ['A. Author'],
          year: 2026,
          abstract: request.query,
          url: `https://example.test/${id}`,
          source: providerPaperSource(id)
        }],
        webResults: id === 'tavily' || id === 'biorxiv_web'
          ? [{
              title: `${id} web`,
              url: `https://example.test/${id}/web`,
              snippet: request.query,
              source: id === 'biorxiv_web' ? 'biorxiv_web' : 'tavily',
              rank: 1
            }]
          : [],
        diagnostics: [{ id, enabled: true, available: true, resultCount: 1 }]
      };
    });
    const service = createResearchSearchService({
      arxivEnabled: true,
      biorxivEnabled: false,
      biorxivWebEnabled: true,
      europePmcEnabled: false,
      semanticScholarEnabled: true,
      semanticScholarApiKey: '',
      tavilyEnabled: true,
      tavilyApiKey: 'key',
      cnsEnabled: false,
      cnsDomains: [],
      maxResults: 6,
      timeoutMs: 1000
    }, {
      providers: {
        arxiv: delayedProvider('arxiv'),
        biorxiv_web: delayedProvider('biorxiv_web'),
        semantic_scholar: delayedProvider('semantic_scholar'),
        tavily: delayedProvider('tavily')
      }
    });

    const result = await service.search({
      query: '实现一个用于蛋白结合物设计的扩散模型，找相关工作和开源代码',
      sources: ['arxiv', 'biorxiv_web', 'semantic_scholar', 'web'],
      maxResults: 6
    });

    assert.equal(result.searchPlan.language, 'zh');
    assert.ok(seenQueries.get('arxiv')?.every((query) => !/[\u3400-\u9fff]/.test(query)));
    assert.ok(seenQueries.get('biorxiv_web')?.some((query) => /bioRxiv/i.test(query)));
    assert.ok(seenQueries.get('tavily')?.some((query) => /GitHub|implementation/i.test(query)));
    assert.notDeepEqual(seenQueries.get('arxiv'), seenQueries.get('tavily'));
    assert.ok(result.webResults.some((result) => result.source === 'biorxiv_web'));
  });

  it('uses analyzed recent time ranges when caller does not pass sinceYear', async () => {
    const seenSinceYears: Array<number | undefined> = [];
    const service = createResearchSearchService({
      arxivEnabled: true,
      biorxivEnabled: false,
      biorxivWebEnabled: false,
      europePmcEnabled: false,
      semanticScholarEnabled: false,
      semanticScholarApiKey: '',
      tavilyEnabled: false,
      tavilyApiKey: '',
      cnsEnabled: false,
      cnsDomains: [],
      maxResults: 4,
      timeoutMs: 1000
    }, {
      providers: {
        arxiv: new FakeProvider('arxiv', (request) => {
          seenSinceYears.push(request.sinceYear);
          return {
            papers: [],
            webResults: [],
            diagnostics: [{ id: 'arxiv', enabled: true, available: true, resultCount: 0 }]
          };
        })
      }
    });

    const result = await service.search({
      query: 'latest papers on single-cell foundation models',
      sources: ['arxiv'],
      maxResults: 4
    });

    assert.ok(seenSinceYears.every((year) => year === 2024));
    assert.equal(result.searchPlan.metadata.earliestYear, 2024);
    assert.equal(result.searchPlan.metadata.latestYear, 2026);
  });

  it('treats current adoption surveys as recent searches and ranks fresher papers first', async () => {
    const seenSinceYears: Array<number | undefined> = [];
    const service = createResearchSearchService({
      arxivEnabled: false,
      biorxivEnabled: false,
      biorxivWebEnabled: false,
      europePmcEnabled: false,
      semanticScholarEnabled: true,
      semanticScholarApiKey: '',
      tavilyEnabled: false,
      tavilyApiKey: '',
      cnsEnabled: false,
      cnsDomains: [],
      maxResults: 4,
      timeoutMs: 1000
    }, {
      providers: {
        semantic_scholar: new FakeProvider('semantic_scholar', (request) => {
          seenSinceYears.push(request.sinceYear);
          return {
            papers: [
              {
                title: 'Agentic RL Algorithms for Language Model Agents in 2026',
                authors: ['A. Current'],
                year: 2026,
                citationCount: 1,
                abstract: 'GSPO DAPO Dr.GRPO VAPO comparison for LLM agents and current community adoption.',
                url: 'https://example.test/current',
                source: ['semantic_scholar']
              },
              {
                title: 'Classic Reinforcement Learning from Human Feedback for Language Models',
                authors: ['A. Classic'],
                year: 2022,
                citationCount: 5000,
                abstract: 'PPO RLHF language models.',
                url: 'https://example.test/classic',
                source: ['semantic_scholar']
              }
            ],
            webResults: [],
            diagnostics: [{ id: 'semantic_scholar', enabled: true, available: true, resultCount: 2 }]
          };
        })
      }
    });

    const result = await service.search({
      query: '现在的agentic RL社区内普遍采用的RL算法有哪些？各自的优势劣势以及适配的任务场景是什么？',
      sources: ['semantic_scholar'],
      maxResults: 4
    });

    assert.equal(result.interpretedIntent.intent, 'latest');
    assert.ok(seenSinceYears.every((year) => year === 2024));
    assert.match(result.generatedQueries.join(' '), /2024 2025 2026|current practice/i);
    assert.equal(result.papers[0]?.year, 2026);
  });

  it('retries Semantic Scholar HTTP 429 responses before degrading', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return jsonResponse({ message: 'rate limited' }, 429);
      }
      return jsonResponse({
        data: [{
          title: 'Perturbation Prediction with Single-Cell Foundation Models',
          authors: [{ name: 'A. Biologist' }],
          year: 2026,
          citationCount: 7,
          externalIds: { DOI: '10.1101/example' },
          url: 'https://www.semanticscholar.org/paper/example',
          tldr: { text: 'Benchmarks single-cell perturbation prediction.' }
        }]
      });
    };

    try {
      const provider = new SemanticScholarResearchProvider('s2-test', {
        minIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 1
      });
      const result = await provider.search(researchRequest('single cell foundation model'));

      assert.equal(calls.length, 2);
      assert.equal(result.diagnostics?.[0]?.available, true);
      assert.equal(result.papers.length, 1);
      assert.equal(result.papers[0]?.source[0], 'semantic_scholar');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('serializes concurrent Semantic Scholar calls through a global rate limit', async () => {
    const originalFetch = globalThis.fetch;
    const delayCalls: number[] = [];
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return jsonResponse({
        data: [{
          title: `Semantic Scholar Result ${fetchCount}`,
          authors: [{ name: 'A. Author' }],
          year: 2026,
          citationCount: 1,
          externalIds: {},
          url: `https://www.semanticscholar.org/paper/${fetchCount}`
        }]
      });
    };

    try {
      const provider = new SemanticScholarResearchProvider('s2-test', {
        minIntervalMs: 25,
        maxRetries: 0,
        delayImpl: async (ms) => {
          delayCalls.push(ms);
        }
      });

      const [first, second] = await Promise.all([
        provider.search(researchRequest('protein binder design')),
        provider.search(researchRequest('crystal diffusion model'))
      ]);

      assert.equal(fetchCount, 2);
      assert.equal(first.diagnostics?.[0]?.available, true);
      assert.equal(second.diagnostics?.[0]?.available, true);
      assert.equal(delayCalls.some((ms) => ms > 0), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function researchRequest(query: string): ResearchSearchRequest {
  return {
    query,
    intent: 'latest',
    domain: 'biology',
    maxResults: 3,
    timeoutMs: 1000,
    signal: new AbortController().signal
  };
}

function providerPaperSource(id: ResearchSearchProvider['id']): ResearchSourceKind[] {
  if (id === 'tavily') return ['web'];
  if (id === 'cns') return ['cns'];
  if (id === 'biorxiv_web') return ['biorxiv_web'];
  if (id === 'semantic_scholar') return ['semantic_scholar'];
  if (id === 'europe_pmc') return ['europe_pmc'];
  if (id === 'biorxiv') return ['biorxiv'];
  return ['arxiv'];
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
