import type { Coverage, Edge, Graph, Layout, Publication, Researcher, Suggestion, Topic } from "./types";

export interface Dataset {
  graph: Graph;
  layout: Layout;
  coverage: Coverage;
  publications: Publication[];
  researchers: Researcher[];
  pubById: Map<string, Publication>;
  resById: Map<string, Researcher>;
  topicById: Map<string, Topic>;
  similarByPub: Map<string, Edge[]>;
  coauthorsByRes: Map<string, Edge[]>;
  suggestionsByRes: Map<string, Suggestion[]>;
  suggestionById: Map<string, Suggestion>;
  types: string[];
  years: [number, number];
  searchIndex: { pub: string[]; res: string[] };
}

const url = (name: string) => `${import.meta.env.BASE_URL}data/${name}`;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(url(name));
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

let detailPromise: Promise<Record<string, Partial<Publication>>> | null = null;
export async function loadPublicationDetail(p: Publication): Promise<Publication> {
  detailPromise ??= getJson<Record<string, Partial<Publication>>>("publication-details.json");
  const details = await detailPromise;
  return { ...p, ...(details[p.id] ?? {}) };
}

export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase();
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

export async function loadDataset(): Promise<Dataset> {
  const [graph, layout, coverage, publications, researchers] = await Promise.all([
    getJson<Graph>("graph.json"),
    getJson<Layout>("layout.json"),
    getJson<Coverage>("coverage.json"),
    getJson<Publication[]>("publications.json"),
    getJson<Researcher[]>("researchers.json"),
  ]);
  const pubById = new Map(publications.map((p) => [p.id, p]));
  const resById = new Map(researchers.map((r) => [r.id, r]));
  const topicById = new Map(graph.topics.map((t) => [t.id, t]));
  const similarByPub = new Map<string, Edge[]>();
  const coauthorsByRes = new Map<string, Edge[]>();
  for (const e of graph.edges) {
    if (e.type === "thematic-similarity") {
      push(similarByPub, e.source, e);
      push(similarByPub, e.target, e);
    } else if (e.type === "coauthorship") {
      push(coauthorsByRes, e.source, e);
      push(coauthorsByRes, e.target, e);
    }
  }
  for (const list of similarByPub.values()) list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const list of coauthorsByRes.values()) list.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const suggestionsByRes = new Map<string, Suggestion[]>();
  for (const s of graph.suggestions) {
    push(suggestionsByRes, s.researcherA, s);
    push(suggestionsByRes, s.researcherB, s);
  }
  const typeCounts = new Map<string, number>();
  let y0 = Infinity, y1 = -Infinity;
  for (const p of publications) {
    typeCounts.set(p.publicationType, (typeCounts.get(p.publicationType) ?? 0) + 1);
    if (p.year) { y0 = Math.min(y0, p.year); y1 = Math.max(y1, p.year); }
  }
  const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return {
    graph, layout, coverage, publications, researchers, pubById, resById, topicById,
    similarByPub, coauthorsByRes, suggestionsByRes,
    suggestionById: new Map(graph.suggestions.map((s) => [s.id, s])),
    types,
    years: [Number.isFinite(y0) ? y0 : 2000, Number.isFinite(y1) ? y1 : 2026],
    searchIndex: {
      pub: publications.map((p) => fold(`${p.title} ${p.authors.map((a) => a.name).join(" ")} ${p.keywords.join(" ")} ${p.container ?? ""}`)),
      res: researchers.map((r) => fold(r.nameVariants.join(" "))),
    },
  };
}

export function otherEnd(e: Edge, id: string) {
  return e.source === id ? e.target : e.source;
}

export const edgeHasVisibleEvidence = (e: Edge, visible: Set<string>) => e.evidencePublicationIds.some((id) => visible.has(id));
export const suggestionHasVisibleEvidence = (s: Suggestion, visible: Set<string>) =>
  s.evidence.some((e) => visible.has(e.publicationA) && visible.has(e.publicationB));
