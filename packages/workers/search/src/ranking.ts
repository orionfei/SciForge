import type {
  ResearchIntent,
  ResearchPaper,
  ResearchWebResult
} from './types.js';

const CURRENT_YEAR = 2026;

export type ThemeCluster = {
  name: string;
  papers: string[];
  summary: string;
};

export function mergeAndRankPapers(input: {
  papers: ResearchPaper[];
  query: string;
  intent: ResearchIntent;
  relevanceCriteria?: {
    required: Array<{ name: string; weight: number }>;
    niceToHave: Array<{ name: string; weight: number }>;
  };
  centrality?: 'central' | 'less_cited' | null;
  recency?: 'recent' | 'early' | null;
  maxResults: number;
}): ResearchPaper[] {
  const merged = new Map<string, ResearchPaper>();
  for (const paper of input.papers) {
    if (!paper.title.trim()) continue;
    const key = paperKey(paper);
    const existing = merged.get(key);
    merged.set(key, existing ? mergePaper(existing, paper) : normalizePaper(paper));
  }
  const titleMerged = new Map<string, ResearchPaper>();
  for (const paper of merged.values()) {
    const key = `title:${normalizeTitle(paper.title).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
    const existing = titleMerged.get(key);
    titleMerged.set(key, existing ? mergePaper(existing, paper) : paper);
  }
  return [...titleMerged.values()]
    .map((paper) => ({
      ...paper,
      relevanceReason: paper.relevanceReason ?? relevanceReason(paper, input.query)
    }))
    .sort((a, b) =>
      scorePaper(b, input) - scorePaper(a, input)
    )
    .slice(0, input.maxResults);
}

export function mergeAndRankWebResults(input: {
  webResults: ResearchWebResult[];
  maxResults: number;
}): ResearchWebResult[] {
  const merged = new Map<string, ResearchWebResult>();
  for (const result of input.webResults) {
    if (!result.title.trim() || !result.url.trim()) continue;
    const key = webResultKey(result.url);
    const existing = merged.get(key);
    if (!existing || result.rank < existing.rank) {
      merged.set(key, {
        ...result,
        title: result.title.replace(/\s+/g, ' ').trim(),
        snippet: result.snippet?.replace(/\s+/g, ' ').trim()
      });
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, input.maxResults);
}

export function buildThemeClusters(papers: readonly ResearchPaper[]): ThemeCluster[] {
  const clusters = [
    {
      name: 'Foundation models and representation learning',
      pattern: /\b(foundation|pretrain|pre-train|language model|transformer|embedding|representation)\b/i
    },
    {
      name: 'Generative modeling',
      pattern: /\b(diffusion|generative|generation|inverse design|flow matching|vae|gan)\b/i
    },
    {
      name: 'Simulation and surrogate modeling',
      pattern: /\b(simulation|surrogate|pde|physics-informed|operator learning|neural operator)\b/i
    },
    {
      name: 'Benchmarks, datasets, and evaluation',
      pattern: /\b(benchmark|dataset|evaluation|leaderboard|baseline)\b/i
    }
  ];
  return clusters
    .map((cluster) => {
      const matched = papers
        .filter((paper) => cluster.pattern.test(textForPaper(paper)))
        .slice(0, 6)
        .map((paper) => paper.title);
      return {
        name: cluster.name,
        papers: matched,
        summary: matched.length
          ? `${matched.length} result(s) mention ${cluster.name.toLowerCase()}.`
          : ''
      };
    })
    .filter((cluster) => cluster.papers.length > 0);
}

export function buildInitialGaps(input: {
  papers: readonly ResearchPaper[];
  webResults: readonly ResearchWebResult[];
}): string[] {
  const gaps = [];
  const recentWithoutVenue = input.papers.filter((paper) => !paper.venue && (paper.year ?? 0) >= 2024).length;
  if (recentWithoutVenue > 0) {
    gaps.push('Several recent results are preprints or lack venue metadata; verify peer review status before treating them as established baselines.');
  }
  if (input.papers.length > 0 && input.papers.every((paper) => (paper.citationCount ?? 0) < 50)) {
    gaps.push('Citation signals are still weak for this result set; prioritize method details and benchmark coverage over citation count.');
  }
  if (input.webResults.length === 0) {
    gaps.push('No web results were available; code, project pages, and benchmark sites may require a configured web search provider.');
  }
  return gaps.slice(0, 4);
}

export function buildSuggestedFollowups(input: {
  query: string;
  intent: ResearchIntent;
  papers: readonly ResearchPaper[];
}): string[] {
  const topTerms = keywordCandidates(input.papers).slice(0, 3);
  const followups = [
    `${input.query} benchmark comparison`,
    `${input.query} open source implementation`,
    `${input.query} limitations future work`
  ];
  for (const term of topTerms) {
    followups.push(`${input.query} ${term}`);
  }
  if (input.intent === 'latest') followups.unshift(`${input.query} 2026`);
  return [...new Set(followups)].slice(0, 6);
}

function mergePaper(a: ResearchPaper, b: ResearchPaper): ResearchPaper {
  return normalizePaper({
    ...a,
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    year: a.year ?? b.year,
    venue: a.venue ?? b.venue,
    abstract: longer(a.abstract, b.abstract),
    tldr: a.tldr ?? b.tldr,
    arxivId: a.arxivId ?? b.arxivId,
    doi: a.doi ?? b.doi,
    semanticScholarId: a.semanticScholarId ?? b.semanticScholarId,
    citationCount: Math.max(a.citationCount ?? 0, b.citationCount ?? 0) || undefined,
    url: a.url ?? b.url,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    source: [...new Set([...a.source, ...b.source])]
  });
}

function normalizePaper(paper: ResearchPaper): ResearchPaper {
  return {
    ...paper,
    title: normalizeTitle(paper.title),
    authors: paper.authors.map((author) => author.trim()).filter(Boolean),
    source: [...new Set(paper.source)]
  };
}

function paperKey(paper: ResearchPaper): string {
  if (paper.arxivId) return `arxiv:${paper.arxivId.toLowerCase()}`;
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  if (paper.semanticScholarId) return `s2:${paper.semanticScholarId}`;
  return `title:${normalizeTitle(paper.title).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function scorePaper(
  paper: ResearchPaper,
  input: {
    query: string;
    intent: ResearchIntent;
    relevanceCriteria?: {
      required: Array<{ name: string; weight: number }>;
      niceToHave: Array<{ name: string; weight: number }>;
    };
    centrality?: 'central' | 'less_cited' | null;
    recency?: 'recent' | 'early' | null;
  }
): number {
  const text = textForPaper(paper).toLowerCase();
  const terms = meaningfulTerms(input.query);
  const lexical = terms.reduce((score, term) => score + (text.includes(term) ? 3 : 0), 0);
  const criteria = criteriaScore(text, input.relevanceCriteria);
  const recency = paper.year ? Math.min(5, Math.max(0, paper.year - 2020)) : 0;
  const wantsRecent = input.intent === 'latest' || input.recency === 'recent';
  const citation = Math.log10((paper.citationCount ?? 0) + 1) * (wantsRecent ? 2 : 4);
  const venue = paper.venue ? 2 : 0;
  const tldr = paper.tldr ? 1 : 0;
  const recentIntentBoost = wantsRecent ? freshnessBoost(paper.year) : 0;
  const intentBoost = wantsRecent
    ? recency * 0.8 + recentIntentBoost
    : input.recency === 'early'
      ? -recency * 0.5
      : input.intent === 'baseline' || input.intent === 'sota' || input.centrality === 'central'
      ? citation + venue
      : input.centrality === 'less_cited'
        ? -citation
      : 0;
  return lexical + criteria + recency + citation + venue + tldr + intentBoost;
}

function freshnessBoost(year: number | undefined): number {
  if (!year) return 0;
  if (year >= CURRENT_YEAR) return 10;
  if (year === CURRENT_YEAR - 1) return 7;
  if (year === CURRENT_YEAR - 2) return 4;
  if (year === CURRENT_YEAR - 3) return 1;
  return -3;
}

function criteriaScore(
  text: string,
  criteria: {
    required: Array<{ name: string; weight: number }>;
    niceToHave: Array<{ name: string; weight: number }>;
  } | undefined
): number {
  if (!criteria) return 0;
  const required = criteria.required.reduce((score, criterion) => {
    const terms = meaningfulTerms(criterion.name);
    if (terms.length === 0) return score;
    const hits = terms.filter((term) => text.includes(term)).length;
    return score + (hits / terms.length) * criterion.weight * 12;
  }, 0);
  const nice = criteria.niceToHave.reduce((score, criterion) => {
    const terms = meaningfulTerms(criterion.name);
    if (terms.length === 0) return score;
    return score + (terms.some((term) => text.includes(term)) ? criterion.weight * 4 : 0);
  }, 0);
  return required + nice;
}

function relevanceReason(paper: ResearchPaper, query: string): string {
  const matching = meaningfulTerms(query)
    .filter((term) => textForPaper(paper).toLowerCase().includes(term.toLowerCase()))
    .slice(0, 5);
  return matching.length > 0
    ? `Matches query terms: ${matching.join(', ')}.`
    : 'Retrieved by a configured research source for this query.';
}

function meaningfulTerms(query: string): string[] {
  const stop = new Set([
    'model',
    'models',
    'latest',
    'recent',
    'advance',
    'advances',
    'review',
    'survey',
    '2024',
    '2025',
    '2026',
    'and',
    'for',
    'with',
    'the',
    'science',
    'biology',
    'computational',
    'foundation',
    'open',
    'source',
    'github',
    'implementation'
  ]);
  return [...new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2 && !stop.has(term)))];
}

function textForPaper(paper: ResearchPaper): string {
  return [paper.title, paper.abstract, paper.tldr, paper.venue].filter(Boolean).join(' ');
}

function longer(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function webResultKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    const normalized = url.toString().replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function keywordCandidates(papers: readonly ResearchPaper[]): string[] {
  const text = papers.map(textForPaper).join(' ').toLowerCase();
  const candidates = [
    'foundation model',
    'diffusion',
    'benchmark',
    'molecular generation',
    'protein design',
    'neural operator',
    'materials discovery'
  ];
  return candidates.filter((candidate) => text.includes(candidate));
}
