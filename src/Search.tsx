import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Dataset } from "./data";
import { fold } from "./data";
import { topicColor } from "./colors";
import type { Selection } from "./types";

interface Result { sel: NonNullable<Selection>; label: string; meta: string; group: "Researchers" | "Topics" | "Publications" }

export function searchDataset(data: Dataset, q: string, limit = { res: 6, topic: 3, pub: 8 }): Result[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const match = (hay: string) => terms.every((t) => hay.includes(t));
  const out: Result[] = [];
  const res: Result[] = [];
  data.researchers.forEach((r, i) => {
    if (match(data.searchIndex.res[i])) {
      res.push({ sel: { kind: "researcher", id: r.id }, label: r.displayName, group: "Researchers",
        meta: `${r.publicationIds.length} publication${r.publicationIds.length === 1 ? "" : "s"} in snapshot` });
    }
  });
  // name prefix matches first, then more publications in snapshot (as a relevance tie-break only)
  // rank: every term starts a name word > edoc-linked identity > more publications (tie-break only)
  const wordStart = (label: string) => {
    const words = fold(label).split(/[\s-]+/);
    return terms.every((t) => words.some((w) => w.startsWith(t))) ? 0 : 1;
  };
  const linked = (id: string) => (data.resById.get(id)?.identityStatus === "edoc-person-record" ? 0 : 1);
  res.sort((a, b) => wordStart(a.label) - wordStart(b.label) || linked(a.sel.id) - linked(b.sel.id)
    || parseInt(b.meta) - parseInt(a.meta) || a.label.localeCompare(b.label));
  out.push(...res.slice(0, limit.res));
  data.graph.topics.forEach((t) => {
    if (match(fold(t.terms.join(" ") + " " + t.label)) && out.filter((o) => o.group === "Topics").length < limit.topic) {
      out.push({ sel: { kind: "topic", id: t.id }, label: t.label, group: "Topics", meta: `${t.size} publications` });
    }
  });
  let n = 0;
  for (let i = 0; i < data.publications.length && n < limit.pub; i++) {
    if (match(data.searchIndex.pub[i])) {
      const p = data.publications[i];
      out.push({ sel: { kind: "publication", id: p.id }, label: p.title, group: "Publications",
        meta: `${p.authors[0]?.name ?? "Unknown author"}${p.authors.length > 1 ? " et al." : ""}${p.year ? ` · ${p.year}` : ""}` });
      n++;
    }
  }
  return out;
}

export function Search({ data, onSelect }: { data: Dataset; onSelect: (s: Selection) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => searchDataset(data, q), [data, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setActive(0), [q]);

  const choose = (r: Result) => {
    onSelect(r.sel);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  };

  let lastGroup = "";
  return (
    <div className="search">
      <label htmlFor="search-input" className="visually-hidden">Search researchers, titles or topics</label>
      <input
        id="search-input"
        ref={inputRef}
        type="search"
        placeholder="Search researchers, titles, topics"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); choose(results[active]); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
        }}
        data-testid="search"
      />
      <kbd className="search-hint" aria-hidden="true">/</kbd>
      {open && q.trim() && (
        <ul id={listId} role="listbox" className="search-results" aria-label="Search results">
          {results.length === 0 && <li className="search-empty">No researcher, title or topic matches “{q}”.</li>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            return (
              <li key={`${r.sel.kind}-${r.sel.id}`} role="presentation">
                {head && <div className="search-group" role="presentation">{head}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`search-option${i === active ? " active" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                  onMouseEnter={() => setActive(i)}
                >
                  {r.sel.kind === "topic" && <span className="swatch" style={{ background: topicColor(r.sel.id) }} />}
                  <span className="opt-label">{r.label}</span>
                  <span className="opt-meta">{r.meta}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
