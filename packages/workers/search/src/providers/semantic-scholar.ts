import type {
  ResearchPaper,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../types.js';
import { errorMessage, fetchJson } from '../http.js';

const S2_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const S2_FIELDS = [
  'title',
  'authors',
  'year',
  'venue',
  'citationCount',
  'externalIds',
  'tldr',
  'abstract',
  'url'
].join(',');
const DEFAULT_MIN_INTERVAL_MS = 1_100;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_500;

type SemanticScholarProviderOptions = {
  minIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  delayImpl?: (ms: number) => Promise<void>;
};

let nextRequestAt = 0;
let rateLimitQueue = Promise.resolve();

export class SemanticScholarResearchProvider implements ResearchSearchProvider {
  readonly id = 'semantic_scholar' as const;

  constructor(
    private readonly apiKey = '',
    private readonly options: SemanticScholarProviderOptions = {}
  ) {}

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    const url = new URL(S2_SEARCH_URL);
    url.searchParams.set('query', request.query);
    url.searchParams.set('limit', String(request.maxResults));
    url.searchParams.set('fields', S2_FIELDS);
    if (request.sinceYear) url.searchParams.set('year', `${request.sinceYear}-`);
    try {
      const json = await this.fetchWithRateLimitAndRetry(url.href, request);
      const papers = parseSemanticScholarPapers(json);
      return {
        papers,
        webResults: [],
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: true,
          resultCount: papers.length
        }]
      };
    } catch (error) {
      return {
        papers: [],
        webResults: [],
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: false,
          reason: errorMessage(error)
        }]
      };
    }
  }

  private headers(): Record<string, string> {
    return this.apiKey.trim()
      ? { Accept: 'application/json', 'x-api-key': this.apiKey.trim() }
      : { Accept: 'application/json' };
  }

  private async fetchWithRateLimitAndRetry(url: string, request: ResearchSearchRequest): Promise<unknown> {
    const maxRetries = finiteInt(this.options.maxRetries, DEFAULT_MAX_RETRIES);
    let attempt = 0;
    for (;;) {
      try {
        await this.waitForGlobalRateLimit();
        return await fetchJson(url, request.timeoutMs, request.signal, { headers: this.headers() });
      } catch (error) {
        if (!isHttp429(error) || attempt >= maxRetries || request.signal.aborted) throw error;
        const delayMs = retryDelayMs(this.options.retryBaseDelayMs, attempt);
        await (this.options.delayImpl ?? delay)(delayMs);
        attempt += 1;
      }
    }
  }

  private waitForGlobalRateLimit(): Promise<void> {
    const minIntervalMs = finiteInt(this.options.minIntervalMs, DEFAULT_MIN_INTERVAL_MS);
    if (minIntervalMs <= 0) return Promise.resolve();
    const wait = rateLimitQueue.then(async () => {
      const now = Date.now();
      const delayMs = Math.max(0, nextRequestAt - now);
      if (delayMs > 0) await (this.options.delayImpl ?? delay)(delayMs);
      nextRequestAt = Date.now() + minIntervalMs;
    });
    rateLimitQueue = wait.catch(() => undefined);
    return wait;
  }
}

function isHttp429(error: unknown): boolean {
  return error instanceof Error && /\bHTTP 429\b/.test(error.message);
}

function retryDelayMs(baseDelayMs: number | undefined, attempt: number): number {
  return finiteInt(baseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS) * (2 ** attempt);
}

function finiteInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSemanticScholarPapers(value: unknown): ResearchPaper[] {
  const rows = asRecord(value).data;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseSemanticScholarPaper).filter(isPaper);
}

function parseSemanticScholarPaper(value: unknown): ResearchPaper | null {
  const record = asRecord(value);
  const title = stringValue(record.title);
  if (!title) return null;
  const externalIds = asRecord(record.externalIds);
  const authors = Array.isArray(record.authors)
    ? record.authors.map((author) => stringValue(asRecord(author).name)).filter(Boolean)
    : [];
  const tldr = asRecord(record.tldr);
  const year = numberValue(record.year);
  const citationCount = numberValue(record.citationCount);
  return {
    title,
    authors,
    ...(year ? { year } : {}),
    venue: optionalString(record.venue),
    abstract: optionalString(record.abstract),
    tldr: optionalString(tldr.text),
    arxivId: optionalString(externalIds.ArXiv),
    doi: optionalString(externalIds.DOI),
    semanticScholarId: optionalString(record.paperId),
    ...(citationCount !== undefined ? { citationCount } : {}),
    url: optionalString(record.url),
    source: ['semantic_scholar']
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value);
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isPaper(value: ResearchPaper | null): value is ResearchPaper {
  return value !== null;
}
