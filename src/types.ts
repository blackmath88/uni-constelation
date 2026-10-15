export interface Author { name: string; researcherId: string; role: "author" | "editor" }

export interface Publication {
  id: string;
  sourceRecordId: string;
  title: string;
  year: number | null;
  publicationType: string;
  publicationTypeSource: string;
  sourceType: string | null;
  authors: Author[];
  authorsComplete: boolean;
  authorsSource: "edoc" | "citation";
  doi: string | null;
  sourceUrl: string;
  links?: Record<string, string>;
  fetchedAt: string;
  rawCitation?: string;
  container?: string | null;
  abstract?: string | null;
  hasAbstract: boolean;
  abstractSource: string | null;
  keywords: string[];
  language: string | null;
  languageSource: string | null;
  edocMatch?: { method: string; confidence: string; handle: string | null } | null;
  facultyScope: string;
  facultyMemberships: ("law" | "economics")[];
  sourceRecords?: { faculty: "law" | "economics"; orgUnitId: string; listingUrl: string; listPosition: number; fetchedAt: string }[];
  parseWarnings?: string[];
  topicId: string | null;
  topicBasis: string | null;
  subjectLabels: string[];
}

export interface Researcher {
  id: string;
  displayName: string;
  nameVariants: string[];
  sourcePersonId: string | null;
  orcid: string | null;
  affiliations: { label: string; source: string; date: string | null }[];
  identityStatus: "edoc-person-record" | "name-only" | "initials-only" | "single-name";
  publicationIds: string[];
  mergeEvidence: string[];
}

export interface Edge {
  source: string;
  target: string;
  type: "author-of" | "coauthorship" | "thematic-similarity";
  evidencePublicationIds: string[];
  score?: number;
  weight?: number;
  sharedTerms?: string[];
}

export interface Evidence { publicationA: string; publicationB: string; score: number; sharedTerms: string[] }

export interface Suggestion {
  id: string;
  researcherA: string;
  researcherB: string;
  score: number;
  sharedTerms: string[];
  evidence: Evidence[];
  method: string;
  confidenceLabel: string;
  absenceNote: string;
  question: string | null;
  sharedSubject: string[];
  facultyBridge: ["law", "economics"];
  evidenceCoverage: { pairs: number; withAbstractOnBothSides: number };
}

export interface Topic { id: string; label: string; concepts: string[]; terms: string[]; size: number; byBasis: Record<string, number> }

export interface Graph {
  meta: {
    title: string; snapshotDate: string; publicationCount: number; researcherCount: number;
    methodVersion: string; parameters: Record<string, number>; notes: string[];
  };
  edgeTypes: Record<Edge["type"], { method: string; evidenceBasis: string; confidenceLabel: string }>;
  topics: Topic[];
  concepts: Record<string, string>;
  edges: Edge[];
  suggestions: Suggestion[];
  featuredSuggestionIds: string[];
}

export interface Layout {
  publications: Record<string, [number, number]>;
  topics: [number, number][];
  researchers: Record<string, [number, number]>;
}

export interface Coverage {
  sourceReportedTotal: number; unique: number; snapshotDate: string; yearRange: [number, number] | null;
  abstractCoverage: { withAbstract: number; share: number };
  edoc: { matched: number; byMethod: Record<string, number>; unresolved: number };
  incompleteAuthorLists: number; unresolvedIdentities: number; stopReason: string;
  byType: Record<string, number>; knownExclusions: string[];
  [k: string]: unknown;
}

export type Mode = "topics" | "coauthors";
export type Selection =
  | { kind: "publication"; id: string }
  | { kind: "researcher"; id: string }
  | { kind: "suggestion"; id: string }
  | { kind: "topic"; id: string }
  | null;

export interface Filters { yearMin: number; yearMax: number; types: Set<string>; faculties: Set<"law" | "economics">; abstractsOnly: boolean }
