import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDataset, type Dataset } from "./data";
import { MapView } from "./MapView";
import { Search } from "./Search";
import { Filters } from "./Filters";
import { Conversations } from "./Conversations";
import { Detail } from "./Detail";
import { ListView } from "./ListView";
import type { Filters as F, Mode, Selection } from "./types";

type View = "map" | "list";
type Sheet = "detail" | "filters" | "conversations";

function readHash(): { sel: Selection; mode: Mode; view: View } {
  const h = new URLSearchParams(location.hash.slice(1));
  const kinds = { p: "publication", r: "researcher", s: "suggestion", t: "topic" } as const;
  let sel: Selection = null;
  for (const [k, kind] of Object.entries(kinds)) {
    const v = h.get(k);
    if (v) sel = { kind, id: v } as Selection;
  }
  return { sel, mode: h.get("mode") === "coauthors" ? "coauthors" : "topics", view: h.get("view") === "list" ? "list" : "map" };
}

function writeHash(sel: Selection, mode: Mode, view: View, filters: F | null, data: Dataset | null) {
  const h = new URLSearchParams();
  if (mode !== "topics") h.set("mode", mode);
  if (view !== "map") h.set("view", view);
  if (sel) h.set(sel.kind[0], sel.id);
  if (filters && data) {
    if (filters.yearMin !== data.years[0] || filters.yearMax !== data.years[1]) h.set("years", `${filters.yearMin}-${filters.yearMax}`);
    if (filters.faculties.size !== 2) h.set("faculty", [...filters.faculties].sort().join(",") || "none");
    if (filters.abstractsOnly) h.set("abstracts", "1");
    if (filters.types.size !== data.types.length) h.set("types", [...filters.types].sort().join(",") || "none");
  }
  const s = h.toString();
  history.replaceState(null, "", s ? `#${s}` : location.pathname + location.search);
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const init = useMemo(readHash, []);
  const [selection, setSelection] = useState<Selection>(init.sel);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [view, setView] = useState<View>(init.view);
  const [filters, setFilters] = useState<F | null>(null);
  const [sheet, setSheet] = useState<Sheet>(init.sel ? "detail" : "conversations");
  const [fitSignal, setFitSignal] = useState(0);
  const [tour, setTour] = useState(true);
  const reducedMotion = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);

  useEffect(() => {
    loadDataset()
      .then((d) => {
        setData(d);
        const h = new URLSearchParams(location.hash.slice(1));
        const years = h.get("years")?.match(/^(\d{4})-(\d{4})$/);
        const faculty = h.get("faculty");
        const types = h.get("types");
        setFilters({
          yearMin: years ? Math.max(d.years[0], +years[1]) : d.years[0],
          yearMax: years ? Math.min(d.years[1], +years[2]) : d.years[1],
          types: types ? new Set(types === "none" ? [] : types.split(",").filter((x) => d.types.includes(x))) : new Set(d.types),
          faculties: faculty ? new Set((faculty === "none" ? [] : faculty.split(",")).filter((x): x is "law" | "economics" => x === "law" || x === "economics")) : new Set(["law", "economics"]),
          abstractsOnly: h.get("abstracts") === "1",
        });
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => { if (filters && data) writeHash(selection, mode, view, filters, data); }, [selection, mode, view, filters, data]);

  const select = useCallback((s: Selection) => {
    setSelection(s);
    if (s) setSheet("detail");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape" && tag !== "INPUT") { setSelection(null); setFitSignal((n) => n + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visiblePubs = useMemo(() => {
    const s = new Set<string>();
    if (!data || !filters) return s;
    for (const p of data.publications) {
      if (!filters.types.has(p.publicationType)) continue;
      if (p.year != null && (p.year < filters.yearMin || p.year > filters.yearMax)) continue;
      if (filters.abstractsOnly && !p.hasAbstract) continue;
      if (!p.facultyMemberships.some((f) => filters.faculties.has(f))) continue;
      s.add(p.id);
    }
    return s;
  }, [data, filters]);

  if (error) {
    return (
      <div className="loading" role="alert">
        <p>The snapshot could not be loaded: {error}</p>
        <p className="muted">Run <code>npm run graph</code> to regenerate data/, then reload.</p>
      </div>
    );
  }
  if (!data || !filters) return <div className="loading" role="status"><p>Loading the Law × Economics overview…</p></div>;

  const g = data.graph.meta;
  return (
    <div className={`app sheet-${sheet}`}>
      <header className="top">
        <div className="brand">
          <h1>Uni Constellation</h1>
          <p className="framing" data-testid="framing">
            Public-data pilot · Law × Business and Economics · {g.publicationCount.toLocaleString("en")} publications · snapshot {g.snapshotDate}
          </p>
        </div>
        <Search data={data} onSelect={select} />
          <div className="toggles">
          <button type="button" className="tour-replay" onClick={() => setTour(true)}>How to explore</button>
          <div className="seg" role="radiogroup" aria-label="Relationship shown on the map">
            <button role="radio" aria-checked={mode === "topics"} onClick={() => { setMode("topics"); setView("map"); }}>Research topics</button>
            <button role="radio" aria-checked={mode === "coauthors"} onClick={() => { setMode("coauthors"); setView("map"); }}>Coauthorship</button>
          </div>
          <div className="seg" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={view === "map"} onClick={() => setView("map")}>Map</button>
            <button role="radio" aria-checked={view === "list"} onClick={() => setView("list")}>List</button>
          </div>
        </div>
      </header>

      <nav className="sheet-tabs" aria-label="Panels">
        <button aria-pressed={sheet === "conversations"} onClick={() => setSheet("conversations")}>Conversations</button>
        <button aria-pressed={sheet === "filters"} onClick={() => setSheet("filters")}>Filters</button>
        <button aria-pressed={sheet === "detail"} onClick={() => setSheet("detail")}>{selection ? "Details" : "About"}</button>
      </nav>

      <div className="rail">
        <Filters data={data} filters={filters} setFilters={setFilters} selection={selection} onSelect={select} visibleCount={visiblePubs.size} />
        <Conversations data={data} selection={selection} visiblePubs={visiblePubs} onSelect={select} />
        <p className="disclaimer">
          Not an official UNIverse product. Built from public UNIverse listing and edoc metadata; an authorised UNIverse integration is planned, not connected.
        </p>
      </div>

      <main className="stage" aria-label={view === "map" ? "Research map" : "Publication list"}>
        {tour && <div className="walkthrough" role="region" aria-label="Optional discovery walkthrough">
          <strong>Where does your research connect?</strong>
          <span>1 Search a person, publication or subject</span><span>2 Explore the neighbourhood</span><span>3 Open a cross-faculty comparison and its sources</span>
          <button type="button" onClick={() => setTour(false)}>Skip tour</button>
        </div>}
        <div className="mode-banner" aria-live="polite">
          {view === "list" ? "List view: the filtered snapshot without the map"
            : mode === "topics" ? "Showing subject neighbourhoods: positions aid exploration, not calibrated semantic distance"
              : "Showing observed coauthorship: researchers joined by a shared publication record"}
        </div>
        {view === "map"
          ? <MapView data={data} mode={mode} selection={selection} visiblePubs={visiblePubs} onSelect={select} reducedMotion={reducedMotion} fitSignal={fitSignal} />
          : <ListView data={data} visiblePubs={visiblePubs} onSelect={select} selection={selection} />}
      </main>

      <Detail data={data} selection={selection} visiblePubs={visiblePubs} onSelect={select} onClose={() => { setSelection(null); setFitSignal((n) => n + 1); }} />
    </div>
  );
}
