#!/usr/bin/env node
// Deterministic 2D layouts for the constellation (d3-force uses a fixed-seed LCG).
// Input: .cache/layout-input.json (from build_graph.py). Output: data/layout.json.
// Positions are a readability aid, not calibrated distances.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forceSimulation, forceManyBody, forceLink, forceX, forceY, forceCollide, forceCenter,
} from "d3-force";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const input = JSON.parse(readFileSync(join(root, ".cache/layout-input.json"), "utf8"));
const n = input.publications.length;
const k = input.topicSimilarity.length;
const R = Math.max(40, 4.4 * Math.sqrt(n));
const round = (v) => Math.round(v * 10) / 10;

// 1) topic anchors — similar topics sit closer; sizes give each topic room
const topicCount = Array.from({ length: k }, (_, j) => input.topicOf.filter((t) => t === j).length);
const anchors = topicCount.map((c, j) => ({
  j, r: Math.sqrt(c / Math.max(1, n)) * R * 0.9,
  x: Math.cos((2 * Math.PI * j) / k) * R * 0.6, y: Math.sin((2 * Math.PI * j) / k) * R * 0.6,
}));
const tlinks = [];
for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
  tlinks.push({ source: a, target: b, s: input.topicSimilarity[a][b] });
}
forceSimulation(anchors)
  .force("link", forceLink(tlinks).distance((l) => (anchors[l.source.j ?? l.source].r + anchors[l.target.j ?? l.target].r) * (1.15 + 1.6 * (1 - l.s))).strength(0.25))
  .force("collide", forceCollide((d) => d.r * 1.3 + 6).iterations(4))
  .force("center", forceCenter(0, 0))
  .stop().tick(500);

// 2) publications
const nodes = input.publications.map((id, i) => {
  const t = input.topicOf[i];
  const a = t >= 0 ? anchors[t] : { x: 0, y: 0, r: R * 0.9 };
  const ang = (i * 2.399963) % (2 * Math.PI);
  const rad = Math.sqrt((i % 97) / 97) * a.r;
  return { i, t, ax: a.x, ay: a.y, x: a.x + Math.cos(ang) * rad, y: a.y + Math.sin(ang) * rad };
});
const links = input.similarity.map(([s, t, w]) => ({ source: s, target: t, w }));
forceSimulation(nodes)
  // unassigned publications (t < 0) feel no anchor: similarity links alone place them between areas
  .force("x", forceX((d) => d.ax).strength((d) => (d.t >= 0 ? 0.09 : 0.004)))
  .force("y", forceY((d) => d.ay).strength((d) => (d.t >= 0 ? 0.09 : 0.004)))
  .force("link", forceLink(links).distance(6).strength((l) => (l.source.t === l.target.t ? 0.35 : l.source.t < 0 || l.target.t < 0 ? 0.25 : 0.04) * l.w))
  .force("charge", forceManyBody().strength(-3.2).distanceMax(45).theta(0.95))
  .force("collide", forceCollide(2.6).iterations(2))
  .stop().tick(320);

// topic label positions = member centroid
const tpos = Array.from({ length: k }, () => ({ x: 0, y: 0, c: 0 }));
for (const d of nodes) if (d.t >= 0) { tpos[d.t].x += d.x; tpos[d.t].y += d.y; tpos[d.t].c++; }

// 3) coauthorship layout: researchers with ≥1 coauthor edge, plus those with ≥3 publications
const m = input.researchers.length;
const deg = new Array(m).fill(0);
for (const [a, b] of input.coauthorship) { deg[a]++; deg[b]++; }
const topicIndex = (tid) => (tid ? Number(tid.slice(1)) : -1);
const rnodes = [];
const rmap = new Map();
input.researchers.forEach((id, i) => {
  if (!deg[i] && (input.researcherPubCount?.[i] ?? 0) < 3) return; // isolates only if they could appear in suggestions
  const t = topicIndex(input.researcherTopic[i]);
  const a = t >= 0 ? anchors[t] : { x: 0, y: 0 };
  const ang = (i * 2.399963) % (2 * Math.PI);
  rmap.set(i, rnodes.length);
  rnodes.push({ i, ax: a.x * 0.8, ay: a.y * 0.8, x: a.x * 0.8 + Math.cos(ang) * 20, y: a.y * 0.8 + Math.sin(ang) * 20 });
});
const rlinks = input.coauthorship.map(([a, b, w]) => ({ source: rmap.get(a), target: rmap.get(b), w }));
forceSimulation(rnodes)
  .force("x", forceX((d) => d.ax).strength(0.02))
  .force("y", forceY((d) => d.ay).strength(0.02))
  .force("link", forceLink(rlinks).distance(14).strength((l) => Math.min(1, 0.25 + 0.15 * l.w) / Math.sqrt(Math.min(deg[l.source.i], deg[l.target.i]))))
  .force("charge", forceManyBody().strength(-14).distanceMax(120))
  .force("collide", forceCollide(4.5))
  .stop().tick(400);

const out = {
  generatedBy: "scripts/layout.mjs (d3-force, deterministic)",
  publications: Object.fromEntries(nodes.map((d) => [input.publications[d.i], [round(d.x), round(d.y)]])),
  topics: tpos.map((p) => (p.c ? [round(p.x / p.c), round(p.y / p.c)] : [0, 0])),
  researchers: Object.fromEntries(rnodes.map((d) => [input.researchers[d.i], [round(d.x), round(d.y)]])),
};
writeFileSync(join(root, "data/layout.json"), JSON.stringify(out));
console.log(`layout: ${nodes.length} publications, ${rnodes.length} coauthoring researchers, ${k} topics`);
