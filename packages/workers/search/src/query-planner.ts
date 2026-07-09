import type { ResearchDomain, ResearchIntent, ResearchSourceKind } from './types.js';
import { analyzeAcademicQuery, type AcademicQueryAnalysis } from './query-analysis.js';

export type ResearchQueryPlan = {
  interpretedIntent: {
    intent: ResearchIntent;
    domain: ResearchDomain;
    rationale: string;
  };
  normalizedGoal: string;
  language: 'zh' | 'en' | 'mixed';
  coreConcepts: string[];
  methods: string[];
  entities: string[];
  analysis: AcademicQueryAnalysis;
  sourceQueries: Partial<Record<ResearchSourceKind, string[]>>;
  generatedQueries: string[];
};

const INTENT_KEYWORDS: Array<[ResearchIntent, RegExp]> = [
  ['latest', /(?:\b(?:latest|recent|new|current|progress|advance|trend|202[4-9])\b|最新|最近|近期|近年|今年|当前|现在|当下|进展|趋势|普遍采用|主流|流行|常用)/i],
  ['baseline', /\b(baseline|benchmark|compare|comparison|基线|对比)\b/i],
  ['sota', /\b(sota|state[- ]of[- ]the[- ]art|best|leaderboard|最优|前沿)\b/i],
  ['dataset', /\b(dataset|data set|benchmark data|corpus|数据集)\b/i],
  ['code', /\b(code|github|implementation|repo|repository|开源|代码|实现)\b/i],
  ['gap', /\b(gap|limitation|open problem|future work|机会|缺口|不足|问题)\b/i]
];

const DOMAIN_KEYWORDS: Array<[ResearchDomain, RegExp]> = [
  ['ai4s', /\b(agentic\s*rl|rlvr|rlhf|grpo|gspo|policy optimization|post[- ]training|reinforcement learning|language model|llm|large language model)\b/i],
  ['biology', /\b(protein|genom|rna|dna|cell|bio|enzyme|antibody|biology|meiosis|meiotic|germ\s*cell|gametogenesis|spermatogenesis|oogenesis|retinoic\s+acid|stra8|meiosin|生物|蛋白)\b/i],
  ['chemistry', /\b(molecule|molecular|chemical|chemistry|reaction|drug|ligand|分子|化学|药物)\b/i],
  ['materials', /\b(material|crystal|catalyst|battery|polymer|alloy|材料|晶体|催化)\b/i],
  ['physics', /\b(physics|pde|fluid|quantum|turbulence|simulation|物理|偏微分|流体|量子)\b/i],
  ['climate', /\b(climate|weather|earth system|atmosphere|forecast|气候|天气|地球系统)\b/i]
];

const DOMAIN_EXPANSIONS: Record<ResearchDomain, string[]> = {
  ai4s: ['AI for Science', 'scientific machine learning'],
  biology: ['computational biology', 'protein design', 'foundation model biology'],
  chemistry: ['molecular generation', 'reaction prediction', 'AI chemistry'],
  materials: ['materials discovery', 'crystal generation', 'materials informatics'],
  physics: ['scientific machine learning', 'physics-informed learning', 'surrogate modeling'],
  climate: ['climate modeling', 'weather forecasting', 'earth system AI'],
  general: []
};

const INTENT_EXPANSIONS: Record<ResearchIntent, string[]> = {
  overview: ['survey', 'review'],
  latest: ['2024 2025 2026', 'recent advances', 'current practice'],
  baseline: ['benchmark', 'baseline comparison'],
  sota: ['state of the art', 'leaderboard'],
  dataset: ['dataset', 'benchmark dataset'],
  code: ['GitHub', 'open source implementation'],
  gap: ['limitations', 'open problems']
};

const SOURCE_LIMITS: Record<ResearchSourceKind, number> = {
  arxiv: 5,
  biorxiv: 2,
  biorxiv_web: 2,
  europe_pmc: 2,
  semantic_scholar: 5,
  web: 3,
  cns: 2
};

const CHINESE_TERM_MAP: Array<[RegExp, string[]]> = [
  [/蛋白质?结合(物|蛋白)?|结合蛋白|蛋白binder/i, ['protein binder']],
  [/蛋白质?|多肽/i, ['protein']],
  [/抗体/i, ['antibody']],
  [/酶/i, ['enzyme']],
  [/基因组|基因/i, ['genomics', 'gene']],
  [/单细胞/i, ['single-cell']],
  [/空间转录组/i, ['spatial transcriptomics']],
  [/转录组/i, ['transcriptomics']],
  [/扰动/i, ['perturbation']],
  [/细胞/i, ['cell']],
  [/基础模型|大模型/i, ['foundation model']],
  [/语言模型/i, ['language model']],
  [/强化学习/i, ['reinforcement learning']],
  [/算法|策略优化/i, ['algorithm', 'policy optimization']],
  [/智能体|代理/i, ['agentic']],
  [/多轮/i, ['multi-turn']],
  [/社区/i, ['community adoption']],
  [/普遍采用|采用|选择|更倾向/i, ['adoption preference']],
  [/优势|劣势|优劣|不足|限制/i, ['advantages disadvantages limitations']],
  [/场景|适配|适用|任务/i, ['task scenario suitability']],
  [/扩散模型|扩散/i, ['diffusion model']],
  [/生成模型|生成/i, ['generative model', 'generation']],
  [/流匹配/i, ['flow matching']],
  [/图神经网络|GNN/i, ['graph neural network']],
  [/transformer/i, ['transformer']],
  [/逆向设计/i, ['inverse design']],
  [/设计/i, ['design']],
  [/预测/i, ['prediction']],
  [/基准|评测|评价/i, ['benchmark', 'evaluation']],
  [/数据集/i, ['dataset']],
  [/开源|代码|实现/i, ['open source', 'GitHub', 'implementation']],
  [/材料/i, ['materials']],
  [/晶体/i, ['crystal']],
  [/催化/i, ['catalyst']],
  [/电池/i, ['battery']],
  [/分子/i, ['molecule', 'molecular']],
  [/配体/i, ['ligand']],
  [/药物/i, ['drug discovery']],
  [/反应/i, ['reaction']],
  [/气候/i, ['climate']],
  [/天气/i, ['weather']],
  [/偏微分|PDE/i, ['partial differential equation', 'PDE']],
  [/流体/i, ['fluid dynamics']],
  [/量子/i, ['quantum']]
];

const METHOD_PATTERNS: Array<[RegExp, string]> = [
  [/\bGRPO\b|group relative policy optimization/i, 'GRPO'],
  [/\bPPO\b|proximal policy optimization/i, 'PPO'],
  [/\bDPO\b|direct preference optimization/i, 'DPO'],
  [/\bGSPO\b|group sequence policy optimization|group superior policy optimization/i, 'GSPO'],
  [/\bDAPO\b|decoupled clip and dynamic sampling policy optimization/i, 'DAPO'],
  [/\bDr\.?\s*GRPO\b|dr grpo/i, 'Dr.GRPO'],
  [/\bVAPO\b/i, 'VAPO'],
  [/\bSAPO\b/i, 'SAPO'],
  [/\bAgent Lightning\b|\bLightningRL\b/i, 'Agent Lightning'],
  [/\bFlow-GRPO\b/i, 'Flow-GRPO'],
  [/\bVSPO\b/i, 'VSPO'],
  [/\bRLVR\b|reinforcement learning with verifiable rewards/i, 'RLVR'],
  [/\bRLHF\b|reinforcement learning from human feedback/i, 'RLHF'],
  [/\b(diffusion|diffusion model)\b/i, 'diffusion model'],
  [/\b(flow matching)\b/i, 'flow matching'],
  [/\b(transformer)\b/i, 'transformer'],
  [/\b(foundation model|language model)\b/i, 'foundation model'],
  [/\b(graph neural network|gnn)\b/i, 'graph neural network'],
  [/\b(benchmark|evaluation)\b/i, 'benchmark']
];

const ENTITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(protein binder)\b/i, 'protein binder'],
  [/\b(protein design|protein)\b/i, 'protein'],
  [/\b(single-cell)\b/i, 'single-cell'],
  [/\b(cell)\b/i, 'cell'],
  [/\b(crystal materials?|crystal)\b/i, 'crystal materials'],
  [/\b(materials?)\b/i, 'materials'],
  [/\b(molecule|molecular|ligand|drug)\b/i, 'molecule'],
  [/\b(climate|weather)\b/i, 'climate']
];

const KNOWN_PHRASES = [
  'Group Relative Policy Optimization',
  'Group Sequence Policy Optimization',
  'Decoupled Clip and Dynamic sAmpling Policy Optimization',
  'Dr.GRPO',
  'VAPO',
  'SAPO',
  'Agent Lightning',
  'LightningRL',
  'Flow-GRPO',
  'VSPO',
  'reinforcement learning for language models',
  'reinforcement learning with verifiable rewards',
  'agentic RL',
  'RL for LLM',
  'protein binder',
  'protein design',
  'single-cell',
  'foundation model',
  'diffusion model',
  'flow matching',
  'graph neural network',
  'inverse design',
  'crystal materials',
  'drug discovery',
  'molecular generation',
  'perturbation prediction'
];

export function planResearchQueries(input: {
  query: string;
  intent?: string;
  domain?: string;
  maxQueries?: number;
}): ResearchQueryPlan {
  const query = normalizeQuery(input.query);
  const language = detectLanguage(query);
  const knownSearch = knownResearchSearchTerms(query);
  const normalizedGoal = normalizeScholarlyGoal(query, knownSearch.terms);
  const intent = normalizeIntent(input.intent) ?? inferIntent(query);
  const domain = normalizeDomain(input.domain) ?? inferDomain(`${query} ${normalizedGoal}`);
  const domainExpansions = domain === 'biology' && isWetBiologyQuery(`${query} ${normalizedGoal}`)
    ? wetBiologyExpansions(`${query} ${normalizedGoal}`)
    : DOMAIN_EXPANSIONS[domain];
  const coreConcepts = uniqueQueries([
    ...knownSearch.concepts,
    ...extractConcepts(normalizedGoal)
  ]).slice(0, 10);
  const methods = extractMatches(normalizedGoal, METHOD_PATTERNS);
  const entities = extractMatches(normalizedGoal, ENTITY_PATTERNS);
  const analysis = analyzeAcademicQuery({
    originalQuery: query,
    normalizedGoal,
    intent,
    domain,
    coreConcepts,
    methods,
    entities
  });
  const candidates = new Set<string>();
  candidates.add(analysis.rewrittenQuery || normalizedGoal);
  candidates.add(analysis.keywordQuery || normalizedGoal);
  if (intent === 'latest' || analysis.metadata.recency === 'recent') {
    candidates.add(`${normalizedGoal} 2024 2025 2026 current practice`);
  }
  for (const exactQuery of knownSearch.exactQueries) {
    candidates.add(exactQuery);
  }
  for (const expansion of domainExpansions) {
    candidates.add(`${normalizedGoal} ${expansion}`);
  }
  for (const expansion of INTENT_EXPANSIONS[intent]) {
    candidates.add(`${normalizedGoal} ${expansion}`);
  }
  if (domain !== 'ai4s' && domain !== 'general') {
    candidates.add(`${normalizedGoal} AI for Science ${domain}`);
  }
  const broadQueries = [...candidates]
    .map((candidate) => normalizeQuery(candidate))
    .filter(Boolean)
    .slice(0, input.maxQueries ?? 8);
  const sourceQueries = buildSourceQueries({
    baseQuery: normalizedGoal,
    broadQueries,
    intent,
    domain,
    coreConcepts,
    methods,
    entities,
    analysis,
    exactQueries: knownSearch.exactQueries,
    maxQueries: input.maxQueries ?? 8
  });
  const generatedQueries = uniqueQueries([
    ...broadQueries,
    ...Object.values(sourceQueries).flat()
  ]).slice(0, input.maxQueries ?? 8);
  return {
    interpretedIntent: {
      intent,
      domain,
      rationale: `Inferred ${intent} intent for ${domain} research search from the user query and generated source-specific scholarly queries.`
    },
    normalizedGoal,
    language,
    coreConcepts,
    methods,
    entities,
    analysis,
    sourceQueries,
    generatedQueries
  };
}

function buildSourceQueries(input: {
  baseQuery: string;
  broadQueries: string[];
  intent: ResearchIntent;
  domain: ResearchDomain;
  coreConcepts: string[];
  methods: string[];
  entities: string[];
  analysis: AcademicQueryAnalysis;
  exactQueries: string[];
  maxQueries: number;
}): Partial<Record<ResearchSourceKind, string[]>> {
  const concepts = input.coreConcepts.slice(0, 5).join(' ');
  const keywordCore = input.analysis.keywordQuery || input.baseQuery;
  const scholarlyCore = compactTerms([
    ...input.entities,
    ...input.methods,
    ...input.coreConcepts,
    ...concepts.split(/\s+/),
    ...keywordCore.split(/\s+/)
  ]).join(' ') || keywordCore;
  const latest = input.intent === 'latest' || input.analysis.metadata.recency === 'recent'
    ? '2024 2025 2026 current recent'
    : '';
  const recentQueries = latest
    ? uniqueQueries([
        ...input.exactQueries,
        `${scholarlyCore} ${latest}`,
        `${input.baseQuery} recent advances 2026`
      ])
    : [];
  const venueSuffix = input.analysis.metadata.venues.length
    ? input.analysis.metadata.venues.join(' ')
    : '';
  const authorSuffix = input.analysis.metadata.authors.length
    ? input.analysis.metadata.authors.join(' ')
    : '';
  const sourceQueries: Partial<Record<ResearchSourceKind, string[]>> = {
    arxiv: boundedSourceQueries('arxiv', [
      ...recentQueries,
      ...input.exactQueries,
      scholarlyCore,
      ...input.broadQueries
    ], input.maxQueries),
    semantic_scholar: boundedSourceQueries('semantic_scholar', [
      [scholarlyCore, venueSuffix, authorSuffix].filter(Boolean).join(' '),
      ...recentQueries,
      ...input.exactQueries,
      scholarlyCore,
      `${scholarlyCore} related work`,
      ...input.broadQueries
    ], input.maxQueries),
    europe_pmc: boundedSourceQueries('europe_pmc', [
      input.domain === 'biology' ? `${scholarlyCore} PubMed` : scholarlyCore,
      `${scholarlyCore} review`
    ], input.maxQueries),
    biorxiv: boundedSourceQueries('biorxiv', [
      scholarlyCore,
      `${scholarlyCore} preprint`
    ], input.maxQueries),
    biorxiv_web: boundedSourceQueries('biorxiv_web', [
      `${scholarlyCore} bioRxiv preprint`,
      `${input.baseQuery} bioRxiv`
    ], input.maxQueries),
    web: boundedSourceQueries('web', [
      ...recentQueries.map((query) => `${query} papers community GitHub`),
      ...input.exactQueries.map((query) => `${query} papers community GitHub`),
      `${input.baseQuery} related work papers`,
      `${input.baseQuery} GitHub benchmark implementation`
    ], input.maxQueries),
    cns: boundedSourceQueries('cns', [
      `${scholarlyCore} ${venueSuffix || 'Nature Science Cell'}`.trim(),
      `${input.baseQuery} latest research`
    ], input.maxQueries)
  };
  return sourceQueries;
}

function boundedSourceQueries(
  source: ResearchSourceKind,
  queries: string[],
  maxQueries: number
): string[] {
  const limit = Math.max(1, Math.min(SOURCE_LIMITS[source], maxQueries));
  return uniqueQueries(queries).slice(0, limit);
}

function isWetBiologyQuery(query: string): boolean {
  return /\b(meiosis|meiotic|germ\s*cell|gametogenesis|spermatogenesis|oogenesis|retinoic\s+acid|stra8|meiosin|dmrt1|synaptonemal|chromatin|transcription factor|rna-binding|pubmed)\b/i
    .test(query);
}

function wetBiologyExpansions(query: string): string[] {
  const expansions = ['PubMed Europe PMC', 'germ cell development'];
  if (/\b(meiosis|meiotic|stra8|meiosin|retinoic\s+acid)\b/i.test(query)) {
    expansions.unshift('meiotic entry retinoic acid');
  }
  if (/\b(spermatogenesis|male|testis|spermatogonial)\b/i.test(query)) {
    expansions.unshift('spermatogenesis meiotic initiation');
  }
  return [...new Set(expansions)];
}

function inferIntent(query: string): ResearchIntent {
  for (const [intent, pattern] of INTENT_KEYWORDS) {
    if (pattern.test(query)) return intent;
  }
  return 'overview';
}

function inferDomain(query: string): ResearchDomain {
  for (const [domain, pattern] of DOMAIN_KEYWORDS) {
    if (pattern.test(query)) return domain;
  }
  return /\b(ai4s|ai for science|scientific machine learning)\b/i.test(query)
    ? 'ai4s'
    : 'general';
}

function normalizeScholarlyGoal(query: string, knownTerms: string[] = []): string {
  const englishTokens = query.match(/[A-Za-z][A-Za-z0-9+./-]*(?:\s+[A-Za-z][A-Za-z0-9+./-]*)*/g)
    ?.map((token) => token.trim())
    .filter((token) => token.length > 1) ?? [];
  const mappedTerms = chineseTerms(query);
  if (containsCjk(query) && (mappedTerms.length > 0 || englishTokens.length > 0 || knownTerms.length > 0)) {
    return compactTerms([...mappedTerms, ...englishTokens, ...knownTerms])
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return normalizeQuery([...knownTerms, query].join(' '));
}

function knownResearchSearchTerms(query: string): {
  terms: string[];
  concepts: string[];
  exactQueries: string[];
} {
  const terms: string[] = [];
  const concepts: string[] = [];
  const exactQueries: string[] = [];
  const hasGrpo = /\bGRPO\b|group relative policy optimization/i.test(query);
  const hasGspo = /\bGSPO\b|group sequence policy optimization|group superior policy optimization/i.test(query);
  const hasAgenticRl = /\bagentic\s*rl\b|\brl\s*for\s*llm\b|\brlvr\b|\brlhf\b|post[- ]training|强化学习.*(?:大模型|语言模型|智能体)|(?:大模型|语言模型|智能体).*强化学习/i.test(query);
  const asksAlgorithms = /\b(algorithm|method|policy optimization|baseline|approach)\b|算法|方法|策略优化|基线|路线/i.test(query);
  const asksTradeoffs = /\b(advantage|disadvantage|tradeoff|limitation|compare|comparison)\b|优势|劣势|优劣|不足|限制|对比|比较/i.test(query);
  const asksTaskFit = /\b(task|scenario|suitable|use case|application)\b|任务|场景|适配|适用|应用/i.test(query);

  if (hasGrpo) {
    terms.push('GRPO', 'Group Relative Policy Optimization');
    concepts.push('GRPO', 'Group Relative Policy Optimization');
    exactQueries.push('GRPO "Group Relative Policy Optimization"');
  }
  if (hasGspo) {
    terms.push('GSPO', 'Group Sequence Policy Optimization');
    concepts.push('GSPO', 'Group Sequence Policy Optimization');
    exactQueries.push('GSPO "Group Sequence Policy Optimization"', '"Group Sequence Policy Optimization"');
    if (hasGrpo) {
      exactQueries.push('GRPO GSPO "Group Sequence Policy Optimization"');
    }
  }
  if (hasAgenticRl) {
    terms.push(
      'agentic RL',
      'RL for LLM',
      'LLM agent reinforcement learning',
      'reinforcement learning for language models',
      'reinforcement learning for LLM agents',
      'RLVR',
      'policy optimization'
    );
    concepts.push(
      'agentic RL',
      'RL for LLM',
      'LLM agents',
      'RLVR',
      'policy optimization'
    );
    if (asksAlgorithms) {
      exactQueries.push('GSPO');
      exactQueries.push('DAPO');
      exactQueries.push('Dr.GRPO DAPO');
      exactQueries.push('Agent Lightning LightningRL');
      exactQueries.push('VAPO SAPO');
      exactQueries.push('Flow-GRPO VSPO agents');
      exactQueries.push('GRPO PPO DPO RLHF RLVR "language model" agents');
    }
    if (asksTradeoffs) {
      exactQueries.push('GSPO DAPO Dr.GRPO VAPO SAPO comparison "language models"');
      exactQueries.push('GRPO PPO DPO RLHF RLVR comparison "language models"');
    }
    if (asksTaskFit) {
      exactQueries.push('Agent Lightning LightningRL multi-turn agents');
      exactQueries.push('RLVR agent tasks verifiable rewards software engineering agents');
    }
    exactQueries.push(
      '2025 2026 agentic reinforcement learning algorithms LLM agents',
      'multi-turn agentic RL Agent Lightning LightningRL Flow-GRPO VSPO',
      '"LLM agents" reinforcement learning algorithms',
      '"agentic reinforcement learning" "language model"',
      '"reinforcement learning" "LLM agents"',
      '"reinforcement learning with verifiable rewards" agents'
    );
  }

  return {
    terms: uniqueQueries(terms),
    concepts: uniqueQueries(concepts),
    exactQueries: uniqueQueries(exactQueries)
  };
}

function chineseTerms(query: string): string[] {
  const terms: string[] = [];
  for (const [pattern, mapped] of CHINESE_TERM_MAP) {
    if (pattern.test(query)) terms.push(...mapped);
  }
  return uniqueQueries(terms);
}

function detectLanguage(query: string): 'zh' | 'en' | 'mixed' {
  const hasCjk = containsCjk(query);
  const hasLatin = /[A-Za-z]/.test(query);
  if (hasCjk && hasLatin) return 'mixed';
  if (hasCjk) return 'zh';
  return 'en';
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function extractConcepts(query: string): string[] {
  const phrases = [
    ...KNOWN_PHRASES.filter((phrase) => query.toLowerCase().includes(phrase)),
    ...extractMatches(query, METHOD_PATTERNS),
    ...extractMatches(query, ENTITY_PATTERNS)
  ];
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9+.-]+/)
    .filter((token) => token.length > 2 && !SEARCH_STOP_WORDS.has(token));
  return uniqueQueries([...phrases, ...tokens]).slice(0, 8);
}

function compactTerms(values: string[]): string[] {
  const terms = uniqueQueries(values)
    .map((value) => value.toLowerCase())
    .filter((value) => !SEARCH_STOP_WORDS.has(value));
  return terms.filter((term, index) => {
    if (term.length <= 2) return false;
    return !terms.some((other, otherIndex) =>
      otherIndex !== index &&
      other.includes(' ') &&
      other !== term &&
      other.split(/\s+/).includes(term)
    );
  });
}

function extractMatches(query: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns
    .filter(([pattern]) => pattern.test(query))
    .map(([, value]) => value)
    .filter(Boolean);
}

const SEARCH_STOP_WORDS = new Set([
  'and',
  'for',
  'from',
  'github',
  'implementation',
  'into',
  'latest',
  'model',
  'models',
  'new',
  'of',
  'on',
  'open',
  'paper',
  'papers',
  'recent',
  'related',
  'research',
  'review',
  'science',
  'source',
  'survey',
  'the',
  'to',
  'using',
  'with'
]);

function normalizeIntent(value: string | undefined): ResearchIntent | null {
  if (
    value === 'overview' ||
    value === 'latest' ||
    value === 'baseline' ||
    value === 'sota' ||
    value === 'dataset' ||
    value === 'code' ||
    value === 'gap'
  ) {
    return value;
  }
  return null;
}

function normalizeDomain(value: string | undefined): ResearchDomain | null {
  if (
    value === 'ai4s' ||
    value === 'biology' ||
    value === 'chemistry' ||
    value === 'materials' ||
    value === 'physics' ||
    value === 'climate' ||
    value === 'general'
  ) {
    return value;
  }
  return null;
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeQuery(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
