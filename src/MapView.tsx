import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Dataset } from "./data";
import { edgeHasVisibleEvidence, otherEnd, suggestionHasVisibleEvidence } from "./data";
import { NO_TOPIC, topicColor } from "./colors";
import type { Mode, Selection } from "./types";

type XY = [number, number];
interface Line { a: XY; b: XY; kind: "similarity" | "coauthor" | "evidence"; strong?: boolean }
interface Label { x: number; y: number; text: string; kind: "focus" | "context" | "b" }
interface Highlight { primary: Set<string>; secondary: Set<string>; lines: Line[]; labels: Label[]; active: boolean }

interface Props {
  data: Dataset;
  mode: Mode;
  selection: Selection;
  visiblePubs: Set<string>;
  onSelect: (s: Selection) => void;
  reducedMotion: boolean;
  fitSignal: number;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function researcherTopic(data: Dataset, rid: string): string | null {
  const r = data.resById.get(rid);
  if (!r) return null;
  const counts = new Map<string, number>();
  for (const pid of r.publicationIds) {
    const t = data.pubById.get(pid)?.topicId;
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null, n = 0;
  for (const [t, c] of counts) if (c > n) { best = t; n = c; }
  return best;
}

/** Greedy label placement: larger topics first, nudge vertically to avoid overlaps, keep inside the view. */
function placeLabels<T extends { x: number; y: number; text: string; size: number }>(labels: T[], width: number): T[] {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const out: T[] = [];
  for (const l of [...labels].sort((a, b) => b.size - a.size)) {
    const half = (l.text.length * 6.9) / 2 + 16;
    const x = Math.max(half + 6, Math.min(width - half - 6, l.x));
    let chosen: number | null = null;
    for (const dy of [0, 17, -17, 34, -34, 51, -51]) {
      const box = { x0: x - half, x1: x + half, y0: l.y + dy - 13, y1: l.y + dy + 4 };
      if (!placed.some((p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1)) {
        placed.push(box);
        chosen = dy;
        break;
      }
    }
    if (chosen !== null) out.push({ ...l, x, y: l.y + chosen });
  }
  return out;
}

export function MapView({ data, mode, selection, visiblePubs, onSelect, reducedMotion, fitSignal }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown>>();
  const sizeRef = useRef({ w: 800, h: 600 });
  const drawRef = useRef<() => void>(() => {});
  const [hover, setHover] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);

  // ---------- nodes for the active mode (world coordinates)
  const nodes = useMemo(() => {
    if (mode === "topics") {
      return data.publications.flatMap((p) => {
        const xy = data.layout.publications[p.id];
        return xy ? [{ id: p.id, x: xy[0], y: xy[1], color: topicColor(p.topicId) }] : [];
      });
    }
    return Object.entries(data.layout.researchers).map(([id, xy]) => ({
      id, x: xy[0], y: xy[1], color: topicColor(researcherTopic(data, id)),
    }));
  }, [data, mode]);
  const posById = useMemo(() => new Map(nodes.map((n) => [n.id, [n.x, n.y] as XY])), [nodes]);
  const quadtree = useMemo(() => d3.quadtree(nodes, (d) => d.x, (d) => d.y), [nodes]);

  // which nodes pass the filters (researchers pass if any of their publications pass)
  const visible = useMemo(() => {
    if (mode === "topics") return visiblePubs;
    const s = new Set<string>();
    for (const n of nodes) {
      const r = data.resById.get(n.id);
      if (r?.publicationIds.some((p) => visiblePubs.has(p))) s.add(n.id);
    }
    return s;
  }, [mode, nodes, visiblePubs, data]);
  const visibleCoauthorEdges = useMemo(() => data.graph.edges.filter((e) => e.type === "coauthorship" && edgeHasVisibleEvidence(e, visiblePubs)).length, [data, visiblePubs]);

  // ---------- highlight model derived from the selection
  const hl: Highlight = useMemo(() => {
    const primary = new Set<string>(), secondary = new Set<string>();
    const lines: Line[] = [], labels: Label[] = [];
    const pos = (id: string) => posById.get(id);
    const addLabel = (id: string, text: string, kind: Label["kind"]) => {
      const p = pos(id);
      if (p) labels.push({ x: p[0], y: p[1], text, kind });
    };
    if (!selection) return { primary, secondary, lines, labels, active: false };

    if (selection.kind === "topic") {
      if (mode === "topics") {
        for (const p of data.publications) if (p.topicId === selection.id) primary.add(p.id);
      } else {
        for (const n of nodes) if (researcherTopic(data, n.id) === selection.id) primary.add(n.id);
      }
    } else if (selection.kind === "publication") {
      const pub = data.pubById.get(selection.id);
      if (pub && mode === "topics") {
        primary.add(pub.id);
        addLabel(pub.id, truncate(pub.title, 60), "focus");
        for (const a of pub.authors) for (const pid of data.resById.get(a.researcherId)?.publicationIds ?? []) if (pid !== pub.id) secondary.add(pid);
        for (const e of (data.similarByPub.get(pub.id) ?? []).slice(0, 8)) {
          const o = otherEnd(e, pub.id);
          const a = pos(pub.id), b = pos(o);
          secondary.add(o);
          if (a && b) lines.push({ a, b, kind: "similarity" });
        }
      } else if (pub) {
        const rids = pub.authors.map((a) => a.researcherId);
        rids.forEach((r) => { primary.add(r); addLabel(r, data.resById.get(r)?.displayName ?? r, "focus"); });
        for (let i = 0; i < rids.length; i++) for (let j = i + 1; j < rids.length; j++) {
          const a = pos(rids[i]), b = pos(rids[j]);
          if (a && b) lines.push({ a, b, kind: "coauthor", strong: true });
        }
      }
    } else if (selection.kind === "researcher") {
      const r = data.resById.get(selection.id);
      if (r && mode === "topics") {
        r.publicationIds.forEach((p) => primary.add(p));
        // neighbouring work: only the 24 strongest similarity links overall, to avoid a spaghetti network
        const cand: { pid: string; o: string; s: number }[] = [];
        for (const pid of r.publicationIds) {
          for (const e of data.similarByPub.get(pid) ?? []) {
            const o = otherEnd(e, pid);
            if (!primary.has(o)) cand.push({ pid, o, s: e.score ?? 0 });
          }
        }
        for (const c of cand.sort((x, y) => y.s - x.s).slice(0, 24)) {
          secondary.add(c.o);
          const a = pos(c.pid), b = pos(c.o);
          if (a && b) lines.push({ a, b, kind: "similarity" });
        }
        // label the researcher near the centroid of their publications
        const pts = r.publicationIds.map(pos).filter(Boolean) as XY[];
        if (pts.length) labels.push({ x: d3.mean(pts, (p) => p[0])!, y: d3.mean(pts, (p) => p[1])!, text: r.displayName, kind: "focus" });
      } else if (r) {
        primary.add(r.id);
        addLabel(r.id, r.displayName, "focus");
        // coauthor list is sorted by number of joint records; label only the first ten to stay readable
        (data.coauthorsByRes.get(r.id) ?? []).forEach((e, n) => {
          if (!edgeHasVisibleEvidence(e, visiblePubs)) return;
          const o = otherEnd(e, r.id);
          secondary.add(o);
          const a = pos(r.id), b = pos(o);
          if (a && b) lines.push({ a, b, kind: "coauthor", strong: true });
          if (n < 10) addLabel(o, data.resById.get(o)?.displayName ?? o, "context");
        });
        for (const s of data.suggestionsByRes.get(r.id) ?? []) {
          if (!suggestionHasVisibleEvidence(s, visiblePubs)) continue;
          const o = s.researcherA === r.id ? s.researcherB : s.researcherA;
          const a = pos(r.id), b = pos(o);
          if (a && b) { lines.push({ a, b, kind: "similarity" }); secondary.add(o); addLabel(o, data.resById.get(o)?.displayName ?? o, "context"); }
        }
      }
    } else if (selection.kind === "suggestion") {
      const s = data.suggestionById.get(selection.id);
      if (s) {
        const A = data.resById.get(s.researcherA)!, B = data.resById.get(s.researcherB)!;
        if (mode === "topics") {
          A.publicationIds.forEach((p) => primary.add(p));
          B.publicationIds.forEach((p) => secondary.add(p));
          for (const ev of s.evidence) {
            const a = pos(ev.publicationA), b = pos(ev.publicationB);
            if (a && b) lines.push({ a, b, kind: "evidence" });
          }
          const ptsA = A.publicationIds.map(pos).filter(Boolean) as XY[];
          const ptsB = B.publicationIds.map(pos).filter(Boolean) as XY[];
          if (ptsA.length) labels.push({ x: d3.mean(ptsA, (p) => p[0])!, y: d3.mean(ptsA, (p) => p[1])!, text: A.displayName, kind: "focus" });
          if (ptsB.length) labels.push({ x: d3.mean(ptsB, (p) => p[0])!, y: d3.mean(ptsB, (p) => p[1])!, text: B.displayName, kind: "b" });
        } else {
          primary.add(A.id); secondary.add(B.id);
          const a = pos(A.id), b = pos(B.id);
          if (a && b) lines.push({ a, b, kind: "evidence" });
          addLabel(A.id, A.displayName, "focus");
          addLabel(B.id, B.displayName, "b");
        }
      }
    }
    return { primary, secondary, lines, labels, active: true };
  }, [selection, data, mode, posById, nodes, visiblePubs]);

  // ---------- drawing
  useEffect(() => {
    const canvas = canvasRef.current!, svg = d3.select(svgRef.current!);
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ink").trim() || "#14202B";
    const paper = css.getPropertyValue("--paper").trim() || "#F5F6F4";
    const accent = css.getPropertyValue("--accent").trim() || "#2442C4";
    const coLinks = mode === "coauthors"
      ? data.graph.edges.filter((e) => e.type === "coauthorship" && edgeHasVisibleEvidence(e, visiblePubs) && posById.has(e.source) && posById.has(e.target))
      : [];

    drawRef.current = () => {
      const { w, h } = sizeRef.current;
      const t = transformRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = Math.max(1.6, Math.min(7, (mode === "topics" ? 2.1 : 3.2) * Math.sqrt(t.k)));
      const X = (x: number) => t.applyX(x), Y = (y: number) => t.applyY(y);

      // ambient coauthorship network (coauthor mode only, deliberately faint)
      if (coLinks.length) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = hl.active ? 0.05 : 0.13;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (const e of coLinks) {
          if (!visible.has(e.source) || !visible.has(e.target)) continue;
          const a = posById.get(e.source)!, b = posById.get(e.target)!;
          ctx.moveTo(X(a[0]), Y(a[1]));
          ctx.lineTo(X(b[0]), Y(b[1]));
        }
        ctx.stroke();
      }

      // nodes
      for (const n of nodes) {
        const vis = visible.has(n.id);
        let alpha = vis ? 0.85 : 0.07;
        if (hl.active && !hl.primary.has(n.id) && !hl.secondary.has(n.id)) alpha = vis ? 0.16 : 0.04;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2);
        ctx.fill();
      }

      // relationship lines for the selection
      for (const l of hl.lines) {
        ctx.globalAlpha = l.kind === "similarity" ? 0.75 : 0.95;
        ctx.strokeStyle = l.kind === "evidence" ? accent : ink;
        ctx.lineWidth = l.kind === "coauthor" ? 1.6 : l.kind === "evidence" ? 2 : 1.1;
        ctx.setLineDash(l.kind === "coauthor" ? [] : l.kind === "evidence" ? [6, 4] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(X(l.a[0]), Y(l.a[1]));
        ctx.lineTo(X(l.b[0]), Y(l.b[1]));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // emphasis rings: primary = solid ink ring, secondary = thin ring
      if (hl.active) {
        for (const n of nodes) {
          const p = hl.primary.has(n.id), s = hl.secondary.has(n.id);
          if (!p && !s) continue;
          ctx.globalAlpha = 1;
          ctx.fillStyle = n.color;
          ctx.beginPath();
          ctx.arc(X(n.x), Y(n.y), p ? r + 1.2 : r + 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = p ? 1.6 : 1;
          ctx.strokeStyle = selection?.kind === "suggestion" && s ? accent : p ? ink : paper;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // svg labels
      const topicLabels = mode === "topics" ? placeLabels(data.graph.topics.map((tp, i) => ({
        id: tp.id, x: X(data.layout.topics[i]?.[0] ?? 0), y: Y(data.layout.topics[i]?.[1] ?? 0),
        text: tp.label, color: topicColor(tp.id), size: tp.size,
        dim: hl.active && !(selection?.kind === "topic" && selection.id === tp.id),
      })), w) : [];
      svg.select("g.topic-labels").selectAll<SVGGElement, (typeof topicLabels)[number]>("g")
        .data(topicLabels, (d) => d.id)
        .join((enter) => {
          const g = enter.append("g").attr("class", "topic-label");
          g.append("text").attr("class", "halo");
          g.append("text").attr("class", "fg");
          g.append("circle").attr("r", 4.5).attr("cy", -4.5);
          return g;
        })
        .attr("transform", (d) => `translate(${d.x},${d.y})`)
        .attr("opacity", (d) => (d.dim ? 0.3 : 1))
        .call((g) => g.selectAll<SVGTextElement, (typeof topicLabels)[number]>("text").text((d) => d.text))
        .each(function (d) {
          const fg = this.querySelector("text.fg") as SVGTextElement;
          const len = fg.getComputedTextLength?.() || d.text.length * 6.6;
          d3.select(this).select("circle").attr("fill", d.color).attr("cx", -len / 2 - 9);
        });

      // selection labels: nudge down when two would overlap
      const sel: (Label & { i: number; sx: number; sy: number })[] = [];
      for (const [i, l] of hl.labels.slice(0, 24).entries()) {
        let sx = Math.min(X(l.x), w - l.text.length * 7 - 12), sy = Y(l.y);
        for (let tries = 0; tries < 6 && sel.some((o) => Math.abs(o.sy - sy) < 16 && Math.abs(o.sx - sx) < Math.max(o.text.length, l.text.length) * 7); tries++) sy += 17;
        sel.push({ ...l, i, sx, sy });
      }
      svg.select("g.sel-labels").selectAll<SVGGElement, (typeof sel)[number]>("g")
        .data(sel, (d) => `${d.i}-${d.text}`)
        .join((enter) => {
          const g = enter.append("g");
          g.append("text").attr("class", "halo");
          g.append("text").attr("class", "fg");
          return g;
        })
        .attr("class", (d) => `sel-label ${d.kind}`)
        .attr("transform", (d) => `translate(${d.sx + 8},${d.sy - 8})`)
        .call((g) => g.selectAll<SVGTextElement, (typeof sel)[number]>("text").text((d) => d.text));
    };
    drawRef.current();
  }, [nodes, posById, visible, hl, mode, data, selection, visiblePubs]);

  // ---------- size + zoom
  const fit = (animate: boolean) => {
    const wrap = wrapRef.current, zoom = zoomRef.current;
    if (!wrap || !zoom) return;
    const focusIds = hl.active ? [...hl.primary, ...hl.secondary] : [...visible];
    const pts = (focusIds.length ? focusIds : nodes.map((n) => n.id)).map((id) => posById.get(id)).filter(Boolean) as XY[];
    if (!pts.length) return;
    const [x0, x1] = d3.extent(pts, (p) => p[0]) as [number, number];
    const [y0, y1] = d3.extent(pts, (p) => p[1]) as [number, number];
    const { w, h } = sizeRef.current;
    const pad = 48;
    const k = Math.min(8, 0.92 * Math.min((w - pad * 2) / Math.max(30, x1 - x0), (h - pad * 2) / Math.max(30, y1 - y0)));
    const t = d3.zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    const s = d3.select(wrap);
    if (animate && !reducedMotion) s.transition().duration(650).ease(d3.easeCubicInOut).call(zoom.transform, t);
    else s.call(zoom.transform, t);
  };

  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.2, 40])
      .clickDistance(4)
      .on("zoom", (ev) => {
        transformRef.current = ev.transform;
        drawRef.current();
      });
    zoomRef.current = zoom;
    d3.select(wrap).call(zoom).on("dblclick.zoom", null);
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const first = sizeRef.current.w === 800 && sizeRef.current.h === 600;
      sizeRef.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (first) fit(false);
      else drawRef.current();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refit when the mode changes or a fit is requested; focus selection on change
  useEffect(() => { fit(false); /* eslint-disable-next-line */ }, [mode]);
  useEffect(() => { if (fitSignal) fit(true); /* eslint-disable-next-line */ }, [fitSignal]);
  useEffect(() => { if (selection && selection.kind !== "topic") fit(true); /* eslint-disable-next-line */ }, [selection]);

  // ---------- pointer interaction
  const findNode = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const [wx, wy] = transformRef.current.invert([clientX - rect.left, clientY - rect.top]);
    const radius = 10 / transformRef.current.k;
    const n = quadtree.find(wx, wy, radius);
    return n && visible.has(n.id) ? n : n && hl.primary.has(n.id) ? n : undefined;
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const n = findNode(e.clientX, e.clientY);
    const rect = wrapRef.current!.getBoundingClientRect();
    if (!n) { setHover(null); wrapRef.current!.style.cursor = "grab"; return; }
    wrapRef.current!.style.cursor = "pointer";
    if (mode === "topics") {
      const p = data.pubById.get(n.id)!;
      const names = p.authors.slice(0, 3).map((a) => a.name).join(", ") + (p.authors.length > 3 || !p.authorsComplete ? " et al." : "");
      setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, title: truncate(p.title, 110), sub: `${names}${p.year ? ` (${p.year})` : ""}` });
    } else {
      const r = data.resById.get(n.id)!;
      const co = data.coauthorsByRes.get(r.id)?.length ?? 0;
      setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, title: r.displayName, sub: `${r.publicationIds.length} publication${r.publicationIds.length === 1 ? "" : "s"} in snapshot · ${co} coauthor${co === 1 ? "" : "s"}` });
    }
  };
  const onClick = (e: React.MouseEvent) => {
    const n = findNode(e.clientX, e.clientY);
    if (n) onSelect(mode === "topics" ? { kind: "publication", id: n.id } : { kind: "researcher", id: n.id });
    else if (selection) onSelect(null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const wrap = d3.select(wrapRef.current!), zoom = zoomRef.current!;
    const step = 60;
    const map: Record<string, () => void> = {
      "+": () => wrap.call(zoom.scaleBy, 1.4), "=": () => wrap.call(zoom.scaleBy, 1.4),
      "-": () => wrap.call(zoom.scaleBy, 1 / 1.4), "0": () => fit(true),
      ArrowLeft: () => wrap.call(zoom.translateBy, step / transformRef.current.k, 0),
      ArrowRight: () => wrap.call(zoom.translateBy, -step / transformRef.current.k, 0),
      ArrowUp: () => wrap.call(zoom.translateBy, 0, step / transformRef.current.k),
      ArrowDown: () => wrap.call(zoom.translateBy, 0, -step / transformRef.current.k),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  const zoomBy = (f: number) => {
    const s = d3.select(wrapRef.current!);
    (reducedMotion ? s : s.transition().duration(250)).call(zoomRef.current!.scaleBy as never, f);
  };

  const anyVisible = visible.size > 0;
  const unplaced = mode === "coauthors" && selection?.kind === "researcher" && !posById.has(selection.id);
  return (
    <div className="map-shell">
      <div
        ref={wrapRef}
        className="map"
        tabIndex={0}
        role="application"
        aria-label={`Research map, ${mode === "topics" ? "publications coloured by topic" : "researchers linked by coauthorship"}. Use plus and minus to zoom, arrow keys to pan, 0 to fit. The search and list view give the same information without the map.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onKeyDown={onKey}
        data-testid="map"
        data-visible-coauthor-edges={mode === "coauthors" ? visibleCoauthorEdges : undefined}
      >
        <canvas ref={canvasRef} />
        <svg ref={svgRef} className="map-labels" aria-hidden="true">
          <g className="topic-labels" />
          <g className="sel-labels" />
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: hover.x, top: hover.y }} role="presentation">
            <div className="tooltip-title">{hover.title}</div>
            <div className="tooltip-sub">{hover.sub}</div>
          </div>
        )}
        {unplaced && (
          <div className="map-empty" role="status">
            <p>This researcher has no coauthored publication in the snapshot, so there is no position in the coauthorship view.</p>
            <p className="muted">Switch to Research topics to see their publications on the map.</p>
          </div>
        )}
        {!anyVisible && (
          <div className="map-empty" role="status">
            <p>No publications match these filters.</p>
            <p className="muted">Widen the year range or re-enable publication types.</p>
          </div>
        )}
      </div>
      <div className="map-controls" role="group" aria-label="Map controls">
        <button type="button" onClick={() => zoomBy(1.5)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => fit(true)} aria-label="Fit to view" className="fit">Fit</button>
      </div>
      <MapLegend mode={mode} />
    </div>
  );
}

function MapLegend({ mode }: { mode: Mode }) {
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-row">
        <span className="dot" style={{ background: NO_TOPIC }} />
        {mode === "topics" ? "One dot = one publication, coloured by primary subject (grey: not assigned)" : "One dot = one researcher, coloured by their most frequent subject"}
      </div>
      <div className="legend-row">
        <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--ink)" strokeWidth="1.8" /></svg>
        Coauthored — shared publication record (observed)
      </div>
      <div className="legend-row">
        <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--ink)" strokeWidth="1.2" strokeDasharray="3 3" /></svg>
        Thematic similarity — derived from shared terms (suggestion)
      </div>
    </div>
  );
}
