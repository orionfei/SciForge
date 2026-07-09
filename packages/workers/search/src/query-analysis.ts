import type { ResearchDomain, ResearchIntent } from './types.js';

export type AcademicQueryAnalysis = {
  content: string;
  rewrittenQuery: string;
  keywordQuery: string;
  metadata: {
    earliestYear?: number;
    latestYear?: number;
    authors: string[];
    venues: string[];
    fieldsOfStudy: string[];
    recency: 'recent' | 'early' | null;
    centrality: 'central' | 'less_cited' | null;
    queryType: 'specific' | 'broad';
  };
  relevanceCriteria: {
    required: Array<{ name: string; description: string; weight: number }>;
    niceToHave: Array<{ name: string; description: string; weight: number }>;
  };
};

const CURRENT_YEAR = 2026;
const RECENT_QUERY_PATTERN = /(?:\b(?:latest|recent|new|current|state[- ]of[- ]the[- ]art|sota)\b|最新|最近|近期|近年|今年|当前|现在|当下|进展|前沿|趋势|普遍采用|主流|流行|常用)/i;

const VENUE_ALIASES: Array<[RegExp, string[]]> = [
  [/\b(?:nature|nature biotechnology|nature methods|nature machine intelligence)\b/i, ['Nature']],
  [/\bscience\b/i, ['Science']],
  [/\bcell\b/i, ['Cell']],
  [/\biclr\b/i, ['ICLR']],
  [/\bneurips|nips\b/i, ['NeurIPS']],
  [/\bicml\b/i, ['ICML']],
  [/\bacl\b/i, ['ACL']],
  [/\bemnlp\b/i, ['EMNLP']],
  [/\bcvpr\b/i, ['CVPR']],
  [/\baaai\b/i, ['AAAI']]
];

const FIELD_ALIASES: Array<[ResearchDomain, string[]]> = [
  ['biology', ['Biology', 'Medicine']],
  ['chemistry', ['Chemistry']],
  ['materials', ['Materials Science', 'Engineering']],
  ['physics', ['Physics', 'Mathematics']],
  ['climate', ['Environmental Science', 'Geology']],
  ['ai4s', ['Computer Science', 'Engineering']],
  ['general', []]
];

const METADATA_PATTERNS = [
  /\b(?:latest|recent|new|current|state[- ]of[- ]the[- ]art|sota|seminal|classic|highly cited|influential|central)\b/gi,
  /\b(?:papers?|research|articles?|studies|survey|review|related work)\s+(?:about|on|for|in|using|of)\b/gi,
  /\b(?:from|since|between|after|before|published in|last)\b/gi,
  /\b20\d{2}\b/g,
  /最新|最近|进展|前沿|论文|相关工作|综述|调研|开源代码|代码|实现/g
];

const AUTHOR_PATTERN = /\bby\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})(?:\s+and\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}))?/g;

export function analyzeAcademicQuery(input: {
  originalQuery: string;
  normalizedGoal: string;
  intent: ResearchIntent;
  domain: ResearchDomain;
  coreConcepts: string[];
  methods: string[];
  entities: string[];
}): AcademicQueryAnalysis {
  const combined = `${input.originalQuery} ${input.normalizedGoal}`;
  const metadata = {
    ...extractTimeRange(combined, input.intent),
    authors: extractAuthors(combined),
    venues: extractVenues(combined),
    fieldsOfStudy: fieldsForDomain(input.domain),
    recency: extractRecency(combined, input.intent),
    centrality: extractCentrality(combined, input.intent),
    queryType: inferQueryType(input.originalQuery, input.normalizedGoal)
  };
  const content = cleanContent(input.normalizedGoal);
  const keywordQuery = keywordize(content, input.coreConcepts, input.methods, input.entities);
  const rewrittenQuery = sentenceCase(content || input.normalizedGoal);
  const relevanceCriteria = buildRelevanceCriteria({
    keywordQuery,
    concepts: input.coreConcepts,
    methods: input.methods,
    entities: input.entities,
    intent: input.intent
  });

  return {
    content,
    rewrittenQuery,
    keywordQuery,
    metadata,
    relevanceCriteria
  };
}

function extractTimeRange(query: string, intent: ResearchIntent): { earliestYear?: number; latestYear?: number } {
  const years = [...query.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => Number.isFinite(year));
  if (years.length > 0) {
    const start = Math.min(...years);
    const end = /\b(?:since|after|from)\b/i.test(query)
      ? CURRENT_YEAR
      : Math.max(...years);
    return {
      earliestYear: start,
      latestYear: end
    };
  }
  if (/\b(?:last|past)\s+(\d+)\s+years?\b/i.test(query)) {
    const count = Number(query.match(/\b(?:last|past)\s+(\d+)\s+years?\b/i)?.[1]);
    if (Number.isFinite(count) && count > 0) {
      return {
        earliestYear: CURRENT_YEAR - count + 1,
        latestYear: CURRENT_YEAR
      };
    }
  }
  if (intent === 'latest' || RECENT_QUERY_PATTERN.test(query)) {
    return {
      earliestYear: CURRENT_YEAR - 2,
      latestYear: CURRENT_YEAR
    };
  }
  return {};
}

function extractAuthors(query: string): string[] {
  const authors: string[] = [];
  for (const match of query.matchAll(AUTHOR_PATTERN)) {
    if (match[1]) authors.push(match[1]);
    if (match[2]) authors.push(match[2]);
  }
  return unique(authors);
}

function extractVenues(query: string): string[] {
  const venues: string[] = [];
  for (const [pattern, mapped] of VENUE_ALIASES) {
    if (pattern.test(query)) venues.push(...mapped);
  }
  return unique(venues);
}

function fieldsForDomain(domain: ResearchDomain): string[] {
  return FIELD_ALIASES.find(([candidate]) => candidate === domain)?.[1] ?? [];
}

function extractRecency(query: string, intent: ResearchIntent): 'recent' | 'early' | null {
  if (/\b(?:classic|early|first|foundational)\b|经典|早期|奠基/i.test(query)) return 'early';
  if (intent === 'latest' || RECENT_QUERY_PATTERN.test(query)) return 'recent';
  return null;
}

function extractCentrality(query: string, intent: ResearchIntent): 'central' | 'less_cited' | null {
  if (/\b(?:less cited|lesser known|underrated)\b|低引用|冷门/i.test(query)) return 'less_cited';
  if (intent === 'sota' || /\b(?:central|seminal|influential|important|highly cited|top)\b|重要|高引用|核心/i.test(query)) {
    return 'central';
  }
  return null;
}

function inferQueryType(originalQuery: string, normalizedGoal: string): 'specific' | 'broad' {
  if (/\b(?:paper titled|called|entitled)\b/i.test(originalQuery)) return 'specific';
  if (/^[A-Z][A-Za-z0-9: -]{12,180}$/.test(originalQuery) && !/\b(?:related work|papers|survey|review)\b/i.test(originalQuery)) {
    return 'specific';
  }
  if (/^[A-Za-z0-9: -]{6,120}$/.test(normalizedGoal) && /\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/.test(normalizedGoal)) {
    return 'specific';
  }
  return 'broad';
}

function cleanContent(query: string): string {
  let content = query;
  for (const pattern of METADATA_PATTERNS) {
    content = content.replace(pattern, ' ');
  }
  content = content.replace(/\b(?:by\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})\b/g, ' ');
  return normalize(content);
}

function keywordize(
  content: string,
  concepts: string[],
  methods: string[],
  entities: string[]
): string {
  const words = [...entities, ...methods, ...concepts, ...content.split(/\s+/)]
    .map((word) => word.replace(/[-_/]+/g, ' '))
    .flatMap((word) => word.split(/\s+/))
    .filter((word) => word.length > 2 && !KEYWORD_STOP_WORDS.has(word.toLowerCase()));
  return unique(words).join(' ');
}

function buildRelevanceCriteria(input: {
  keywordQuery: string;
  concepts: string[];
  methods: string[];
  entities: string[];
  intent: ResearchIntent;
}): AcademicQueryAnalysis['relevanceCriteria'] {
  const requiredNames = unique([
    ...input.entities.slice(0, 2),
    ...input.methods.slice(0, 2),
    ...input.concepts.slice(0, 3)
  ]).slice(0, 4);
  const required = requiredNames.map((name, index) => ({
    name,
    description: index === 0
      ? `Paper must address ${name} in relation to the main query: ${input.keywordQuery}.`
      : `Paper should materially discuss ${name}, not only mention it incidentally.`,
    weight: 0
  }));
  const normalizedRequired = normalizeWeights(required);
  const niceToHave = normalizeWeights([
    ...(input.intent === 'code'
      ? [{ name: 'implementation', description: 'Mentions software, code, benchmark, or reproducible implementation.', weight: 0 }]
      : []),
    ...(input.intent === 'baseline' || input.intent === 'sota'
      ? [{ name: 'evaluation', description: 'Includes benchmark, comparison, or empirical evaluation.', weight: 0 }]
      : []),
    { name: 'recent evidence', description: 'Provides recent or active related work context.', weight: 0 }
  ]);
  return {
    required: normalizedRequired,
    niceToHave
  };
}

function normalizeWeights<T extends { weight: number }>(criteria: T[]): T[] {
  if (criteria.length === 0) return criteria;
  const weight = 1 / criteria.length;
  return criteria.map((criterion) => ({ ...criterion, weight }));
}

function sentenceCase(value: string): string {
  const normalized = normalize(value);
  if (!normalized) return '';
  return normalized[0]?.toUpperCase() + normalized.slice(1);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

const KEYWORD_STOP_WORDS = new Set([
  'and',
  'are',
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
