export type ResearchIntent =
  | 'overview'
  | 'latest'
  | 'baseline'
  | 'sota'
  | 'dataset'
  | 'code'
  | 'gap';

export type ResearchDomain =
  | 'ai4s'
  | 'biology'
  | 'chemistry'
  | 'materials'
  | 'physics'
  | 'climate'
  | 'general';

export type ResearchSourceKind =
  | 'arxiv'
  | 'biorxiv'
  | 'biorxiv_web'
  | 'europe_pmc'
  | 'semantic_scholar'
  | 'web'
  | 'cns';

export type ResearchProviderId =
  | 'arxiv'
  | 'biorxiv'
  | 'biorxiv_web'
  | 'europe_pmc'
  | 'semantic_scholar'
  | 'tavily'
  | 'cns';

export type ResearchSearchRequest = {
  query: string;
  intent: ResearchIntent;
  domain: ResearchDomain;
  sinceYear?: number;
  maxResults: number;
  timeoutMs: number;
  signal: AbortSignal;
};

export type ResearchPaper = {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  tldr?: string;
  arxivId?: string;
  doi?: string;
  semanticScholarId?: string;
  citationCount?: number;
  url?: string;
  pdfUrl?: string;
  source: ResearchSourceKind[];
  relevanceReason?: string;
};

export type ResearchWebResult = {
  title: string;
  url: string;
  snippet: string;
  source: 'tavily' | 'biorxiv_web' | 'cns';
  rank: number;
};

export type ResearchProviderDiagnostic = {
  id: ResearchProviderId;
  enabled: boolean;
  available: boolean;
  resultCount?: number;
  reason?: string;
};

export type ResearchSearchProviderResult = {
  papers: ResearchPaper[];
  webResults: ResearchWebResult[];
  diagnostics?: ResearchProviderDiagnostic[];
};

export interface ResearchSearchProvider {
  readonly id: ResearchProviderId;
  search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult>;
}

export type ResearchSearchConfig = {
  arxivEnabled: boolean;
  biorxivEnabled: boolean;
  biorxivWebEnabled: boolean;
  europePmcEnabled: boolean;
  semanticScholarEnabled: boolean;
  semanticScholarApiKey: string;
  tavilyEnabled: boolean;
  tavilyApiKey: string;
  cnsEnabled: boolean;
  cnsDomains: string[];
  defaultSinceYear?: number;
  maxResults: number;
  timeoutMs: number;
};

export type ResearchSearchInput = {
  query: string;
  intent?: ResearchIntent;
  domain?: ResearchDomain;
  sinceYear?: number;
  maxResults?: number;
  sources?: ResearchSourceKind[];
  signal?: AbortSignal;
};

export type ResearchSearchOutput = {
  answerGuidance: string;
  interpretedIntent: {
    intent: ResearchIntent;
    domain: ResearchDomain;
    rationale: string;
  };
  searchPlan: {
    normalizedGoal: string;
    language: 'zh' | 'en' | 'mixed';
    content: string;
    rewrittenQuery: string;
    keywordQuery: string;
    coreConcepts: string[];
    methods: string[];
    entities: string[];
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
    sourceQueries: Partial<Record<ResearchSourceKind, string[]>>;
  };
  generatedQueries: string[];
  papers: ResearchPaper[];
  webResults: ResearchWebResult[];
  themes: Array<{
    name: string;
    papers: string[];
    summary: string;
  }>;
  gaps: string[];
  suggestedFollowups: string[];
  diagnostics: ResearchProviderDiagnostic[];
  citations: Array<{
    title: string;
    url: string;
    source: string;
  }>;
};
