import { useMemo, useState } from "react";
import type { Dataset } from "./data";
import { fold } from "./data";
import { topicColor } from "./colors";
import type { Selection } from "./types";

/** The non-graph route: the same filtered data as a readable, keyboard-friendly list. */
export function ListView({ data, visiblePubs, onSelect, selection }: {
  data: Dataset; visiblePubs: Set<string>; onSelect: (s: Selection) => void; selection: Selection;
}) {
  const [tab, setTab] = useState<"publications" | "researchers">("publications");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(100);
  const terms = fold(q).split(/\s+/).filter(Boolean);

  const pubs = useMemo(() => {
    const out = [];
    for (let i = 0; i < data.publications.length; i++) {
      const p = data.publications[i];
      if (!visiblePubs.has(p.id)) continue;
      if (terms.length && !terms.every((t) => data.searchIndex.pub[i].includes(t))) continue;
      out.push(p);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visiblePubs, q]);

  const researchers = useMemo(() => {
    return data.researchers
      .map((r, i) => ({ r, i, n: r.publicationIds.filter((p) => visiblePubs.has(p)).length }))
      .filter(({ i, n }) => n > 0 && (!terms.length || terms.every((t) => data.searchIndex.res[i].includes(t))))
      .sort((a, b) => a.r.displayName.localeCompare(b.r.displayName, "de"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visiblePubs, q]);

  return (
    <div className="list-view" data-testid="list-view">
      <div className="list-head">
        <div role="tablist" aria-label="List contents" className="seg">
          <button role="tab" aria-selected={tab === "publications"} onClick={() => { setTab("publications"); setLimit(100); }}>
            Publications <span className="n">{pubs.length.toLocaleString("en")}</span>
          </button>
          <button role="tab" aria-selected={tab === "researchers"} onClick={() => { setTab("researchers"); setLimit(100); }}>
            Researchers <span className="n">{researchers.length.toLocaleString("en")}</span>
          </button>
        </div>
        <label className="list-filter">
          <span className="visually-hidden">Filter this list</span>
          <input type="search" placeholder={tab === "publications" ? "Filter by title, author or keyword" : "Filter by name"} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {tab === "publications" ? (
        <ol className="list-rows">
          {pubs.slice(0, limit).map((p) => (
            <li key={p.id} className={selection?.kind === "publication" && selection.id === p.id ? "on" : ""}>
              <span className="swatch" style={{ background: topicColor(p.topicId) }} aria-hidden="true" />
              <span className="yr">{p.year ?? "n.d."}</span>
              <div>
                <button type="button" className="pub-link" onClick={() => onSelect({ kind: "publication", id: p.id })}>{p.title}</button>
                <div className="pub-meta">
                  {p.authors.slice(0, 4).map((a) => a.name).join(", ")}{p.authors.length > 4 || !p.authorsComplete ? " et al." : ""} · {p.publicationType}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="list-rows researchers">
          {researchers.slice(0, limit).map(({ r, n }) => (
            <li key={r.id} className={selection?.kind === "researcher" && selection.id === r.id ? "on" : ""}>
              <div>
                <button type="button" className="pub-link" onClick={() => onSelect({ kind: "researcher", id: r.id })}>{r.displayName}</button>
                <div className="pub-meta">
                  {n} publication{n === 1 ? "" : "s"} matching filters
                  {r.identityStatus === "edoc-person-record" ? " · edoc person record" : " · name only"}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {(tab === "publications" ? pubs.length : researchers.length) > limit && (
        <button type="button" className="more" onClick={() => setLimit(limit + 200)}>Show more</button>
      )}
      {(tab === "publications" ? pubs.length : researchers.length) === 0 && (
        <p className="list-empty">Nothing matches. Clear the list filter or widen the filters on the left.</p>
      )}
    </div>
  );
}
