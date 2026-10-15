import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import type { Dataset } from "./data";
import { NO_TOPIC, topicColor } from "./colors";
import type { Filters as F, Selection } from "./types";

interface Props {
  data: Dataset;
  filters: F;
  setFilters: (f: F) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  visibleCount: number;
}

export function Filters({ data, filters, setFilters, selection, onSelect, visibleCount }: Props) {
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.publications) m.set(p.publicationType, (m.get(p.publicationType) ?? 0) + 1);
    return m;
  }, [data]);
  const unclustered = useMemo(() => data.publications.filter((p) => !p.topicId).length, [data]);
  const allTypes = filters.types.size === data.types.length;
  const isDefault = allTypes && filters.faculties.size === 2 && filters.yearMin === data.years[0] && filters.yearMax === data.years[1] && !filters.abstractsOnly;

  return (
    <section className="filters" aria-labelledby="filters-h">
      <div className="section-head">
        <h2 id="filters-h">Filter</h2>
        <span className="count" aria-live="polite">{visibleCount.toLocaleString("en")} shown</span>
        {!isDefault && (
          <button type="button" className="link" onClick={() => setFilters({ yearMin: data.years[0], yearMax: data.years[1], types: new Set(data.types), faculties: new Set(["law", "economics"]), abstractsOnly: false })}>
            Reset
          </button>
        )}
      </div>
      <YearBrush data={data} filters={filters} setFilters={setFilters} />
      <fieldset className="faculties">
        <legend>Faculty listing</legend>
        {([['law', 'Law'], ['economics', 'Business and Economics']] as const).map(([key, label]) => <label className="check" key={key}>
          <input type="checkbox" checked={filters.faculties.has(key)} onChange={(e) => {
            const next = new Set(filters.faculties); if (e.target.checked) next.add(key); else next.delete(key);
            setFilters({ ...filters, faculties: next });
          }} /><span>{label}</span>
        </label>)}
        <p className="hint">Listing membership describes the source record, not a person's employment or discipline.</p>
      </fieldset>
      <fieldset className="types">
        <legend>Publication type</legend>
        {data.types.map((t) => (
          <label key={t} className="check">
            <input
              type="checkbox"
              checked={filters.types.has(t)}
              onChange={(e) => {
                const next = new Set(filters.types);
                if (e.target.checked) next.add(t); else next.delete(t);
                setFilters({ ...filters, types: next });
              }}
            />
            <span>{t}</span>
            <span className="n">{typeCounts.get(t)?.toLocaleString("en")}</span>
          </label>
        ))}
        <div className="type-actions">
          <button type="button" className="link" onClick={() => setFilters({ ...filters, types: new Set(data.types) })} disabled={allTypes}>All</button>
          <button type="button" className="link" onClick={() => setFilters({ ...filters, types: new Set() })} disabled={!filters.types.size}>None</button>
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={filters.abstractsOnly} onChange={(e) => setFilters({ ...filters, abstractsOnly: e.target.checked })} />
        <span>Only publications with an abstract</span>
      </label>
      <div className="topics" aria-labelledby="topics-h">
        <h3 id="topics-h">Subject areas</h3>
        <p className="hint">Direct labels come from a multilingual concept list. The primary colour is only a map projection; a publication may carry several labels.</p>
        <ul>
          {data.graph.topics.map((t) => {
            const on = selection?.kind === "topic" && selection.id === t.id;
            return (
              <li key={t.id}>
                <button type="button" className={`topic-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => onSelect(on ? null : { kind: "topic", id: t.id })}>
                  <span className="swatch" style={{ background: topicColor(t.id) }} />
                  <span className="topic-name">{t.label}</span>
                  <span className="n">{t.size.toLocaleString("en")}</span>
                </button>
              </li>
            );
          })}
          {unclustered > 0 && (
            <li className="topic-none">
              <span className="swatch" style={{ background: NO_TOPIC }} />
              <span className="topic-name">Not assigned to an area</span>
              <span className="n">{unclustered.toLocaleString("en")}</span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

function YearBrush({ data, filters, setFilters }: Pick<Props, "data" | "filters" | "setFilters">) {
  const ref = useRef<SVGSVGElement>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const bins = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of data.publications) if (p.year) m.set(p.year, (m.get(p.year) ?? 0) + 1);
    return d3.range(data.years[0], data.years[1] + 1).map((y) => ({ y, n: m.get(y) ?? 0 }));
  }, [data]);
  const W = 264, H = 54;

  useEffect(() => {
    const svg = d3.select(ref.current!);
    const x = d3.scaleBand<number>().domain(bins.map((b) => b.y)).range([0, W]).paddingInner(0.18);
    const yS = d3.scaleSqrt().domain([0, d3.max(bins, (b) => b.n) || 1]).range([0, H - 6]);
    svg.select("g.bars").selectAll("rect").data(bins).join("rect")
      .attr("x", (b) => x(b.y)!).attr("width", x.bandwidth())
      .attr("y", (b) => H - yS(b.n)).attr("height", (b) => yS(b.n));
    const brush = d3.brushX().extent([[0, 0], [W, H]]).on("end", (ev) => {
      if (!ev.sourceEvent) return;
      const f = filtersRef.current;
      if (!ev.selection) { setFilters({ ...f, yearMin: data.years[0], yearMax: data.years[1] }); return; }
      const [a, b] = ev.selection as [number, number];
      const inside = bins.filter((bb) => x(bb.y)! + x.bandwidth() / 2 >= a && x(bb.y)! + x.bandwidth() / 2 <= b);
      if (!inside.length) return;
      setFilters({ ...f, yearMin: inside[0].y, yearMax: inside[inside.length - 1].y });
    });
    const g = svg.select<SVGGElement>("g.brush").call(brush);
    const full = filters.yearMin === data.years[0] && filters.yearMax === data.years[1];
    g.call(brush.move, full ? null : [x(filters.yearMin)!, x(filters.yearMax)! + x.bandwidth()]);
    svg.select("g.bars").selectAll<SVGRectElement, { y: number }>("rect").classed("off", (b) => b.y < filters.yearMin || b.y > filters.yearMax);
  }, [bins, filters.yearMin, filters.yearMax, data.years, setFilters]);

  const yrs = d3.range(data.years[0], data.years[1] + 1);
  return (
    <div className="years">
      <div className="years-head">
        <span>Year</span>
        <span className="range">{filters.yearMin}–{filters.yearMax}</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="year-hist" role="img" aria-label="Publications per year; drag to select a range">
        <g className="bars" />
        <g className="brush" />
      </svg>
      <div className="years-axis" aria-hidden="true"><span>{data.years[0]}</span><span>{data.years[1]}</span></div>
      <div className="year-selects">
        <label>From
          <select value={filters.yearMin} onChange={(e) => setFilters({ ...filters, yearMin: Math.min(+e.target.value, filters.yearMax) })}>
            {yrs.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
        <label>To
          <select value={filters.yearMax} onChange={(e) => setFilters({ ...filters, yearMax: Math.max(+e.target.value, filters.yearMin) })}>
            {yrs.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
