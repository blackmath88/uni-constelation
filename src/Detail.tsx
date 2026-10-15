import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dataset } from "./data";
import { fold, loadPublicationDetail, otherEnd } from "./data";
import { topicColor } from "./colors";
import { ConversationItem } from "./Conversations";
import type { Publication, Researcher, Selection } from "./types";

interface Props { data: Dataset; selection: Selection; visiblePubs: Set<string>; onSelect: (s: Selection) => void; onClose: () => void }

const IDENTITY_TEXT: Record<Researcher["identityStatus"], string> = {
  "edoc-person-record": "Linked to a person record in edoc (University of Basel repository). This shows a repository identity, not current employment.",
  "name-only": "Identified by name only. May be an external coauthor; not confirmed as University of Basel staff.",
  "initials-only": "Listed with initials only. Kept separate from similar full names; not confirmed as University of Basel staff.",
  "single-name": "Only a single name is given in the source citation.",
};

export function Detail({ data, selection, visiblePubs, onSelect, onClose }: Props) {
  let body: ReactNode;
  if (!selection) body = <About data={data} />;
  else if (selection.kind === "publication") body = <PublicationDetail data={data} id={selection.id} onSelect={onSelect} />;
  else if (selection.kind === "researcher") body = <ResearcherDetail data={data} id={selection.id} onSelect={onSelect} selection={selection} />;
  else if (selection.kind === "suggestion") body = <SuggestionDetail data={data} id={selection.id} visiblePubs={visiblePubs} onSelect={onSelect} />;
  else body = <TopicDetail data={data} id={selection.id} onSelect={onSelect} />;
  return (
    <aside className="detail" aria-label="Details" data-testid="detail">
      {selection && (
        <button type="button" className="close" onClick={onClose} aria-label="Clear selection">
          Clear selection <span aria-hidden="true">×</span>
        </button>
      )}
      {body}
    </aside>
  );
}

function PersonLink({ data, id, name, onSelect }: { data: Dataset; id: string; name: string; onSelect: (s: Selection) => void }) {
  const r = data.resById.get(id);
  const ext = r && r.identityStatus !== "edoc-person-record";
  return (
    <button type="button" className={`person${ext ? " unverified" : ""}`} onClick={() => onSelect({ kind: "researcher", id })}
      title={r ? IDENTITY_TEXT[r.identityStatus] : undefined}>
      {name}
    </button>
  );
}

function PubRow({ p, onSelect, extra }: { p: Publication; onSelect: (s: Selection) => void; extra?: ReactNode }) {
  return (
    <li className="pub-row">
      <span className="swatch" style={{ background: topicColor(p.topicId) }} aria-hidden="true" />
      <div>
        <button type="button" className="pub-link" onClick={() => onSelect({ kind: "publication", id: p.id })}>{p.title}</button>
        <div className="pub-meta">
          {p.authors.slice(0, 3).map((a) => a.name).join(", ")}{p.authors.length > 3 || !p.authorsComplete ? " et al." : ""}
          {p.year ? ` (${p.year})` : ""} · {p.publicationType}
        </div>
        {extra}
      </div>
    </li>
  );
}

function PublicationDetail({ data, id, onSelect }: { data: Dataset; id: string; onSelect: (s: Selection) => void }) {
  const base = data.pubById.get(id);
  const [loaded, setLoaded] = useState<Publication | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => { setLoaded(null); if (base) loadPublicationDetail(base).then(setLoaded); }, [base]);
  if (!base) return <p className="muted">This publication is not in the snapshot.</p>;
  const p = loaded ?? base;
  const related = (data.similarByPub.get(p.id) ?? []).slice(0, 6);
  const topic = p.topicId ? data.topicById.get(p.topicId) : null;
  const missing: string[] = [];
  if (!p.hasAbstract) missing.push(p.edocMatch ? "edoc has no abstract for this record." : "No abstract: the record was not matched in edoc, so only the citation is available.");
  if (!p.authorsComplete) missing.push("Author list is incomplete (“et al.” in the source citation). Missing coauthors are not inferred.");
  if (p.year == null) missing.push("No publication year in the source citation.");
  if (p.publicationTypeSource !== "edoc") missing.push("Publication type is inferred from the citation format.");
  return (
    <article className="pub-detail">
      <div className="kicker">
        {topic && <span className="swatch" style={{ background: topicColor(topic.id) }} aria-hidden="true" />}
        {p.publicationType}{p.year ? ` · ${p.year}` : ""}{p.language ? ` · ${p.language.toUpperCase()}` : ""}
      </div>
      <h2 className="detail-title">{p.title}</h2>
      <p className="authors">
        {p.authors.map((a, i) => (
          <span key={a.researcherId + i}>
            {i > 0 && (i === p.authors.length - 1 ? " and " : ", ")}
            <PersonLink data={data} id={a.researcherId} name={a.name} onSelect={onSelect} />
          </span>
        ))}
        {!p.authorsComplete && <span className="muted"> et al. (incomplete)</span>}
        {p.authors.some((a) => a.role === "editor") && <span className="muted"> (eds.)</span>}
      </p>
      {p.container && <p className="container">In <em>{p.container}</em></p>}
      {p.abstract ? (
        <div className="abstract">
          <h3>Abstract <span className="src">from edoc</span></h3>
          <p>{p.abstract}</p>
        </div>
      ) : null}
      {p.keywords.length > 0 && <p className="keywords"><span className="label">Keywords</span> {p.keywords.join(", ")}</p>}
      <div className="links">
        {p.links?.doi && <a href={p.links.doi} target="_blank" rel="noreferrer">DOI {p.doi}</a>}
        {p.links?.edoc && <a href={p.links.edoc} target="_blank" rel="noreferrer">edoc record</a>}
        {(p.sourceRecords ?? []).map((s) => <a key={s.faculty} href={s.listingUrl} target="_blank" rel="noreferrer">UNIverse {s.faculty === "law" ? "Law" : "Economics"} listing</a>)}
      </div>
      {missing.length > 0 && (
        <div className="notes" role="note">
          <h3>Missing or derived data</h3>
          <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {topic && (
        <p className="topic-line">
          Primary subject projection: <button type="button" className="link" onClick={() => onSelect({ kind: "topic", id: topic.id })}>{topic.label}</button>
          {p.topicBasis === "similar classified publications" && <span className="muted"> (assigned from similar publications; weaker evidence)</span>}
        </p>
      )}
      <section>
        <h3>Related work <span className="src">thematic similarity, derived</span></h3>
        {related.length === 0 ? <p className="muted">No publication passes the similarity threshold.</p> : (
          <ul className="pub-list">
            {related.map((e) => {
              const q = data.pubById.get(otherEnd(e, p.id))!;
              return <PubRow key={q.id} p={q} onSelect={onSelect} extra={<div className="shared">Shared terms: {e.sharedTerms?.join(", ")} · similarity {e.score?.toFixed(2)}</div>} />;
            })}
          </ul>
        )}
      </section>
      <section>
        <button type="button" className="disclosure" aria-expanded={showRaw} onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? "Hide" : "Show"} source record
        </button>
        {showRaw && (
          <div className="raw">
            <p className="raw-cite">{p.rawCitation}</p>
            <dl>
              <dt>UNIverse record</dt><dd>{p.sourceRecordId}</dd>
              <dt>Authors from</dt><dd>{p.authorsSource === "edoc" ? "edoc author list" : "parsed citation"}</dd>
              <dt>edoc match</dt><dd>{p.edocMatch ? `${p.edocMatch.method} (${p.edocMatch.confidence} confidence)` : "none"}</dd>
              <dt>Fetched</dt><dd>{p.fetchedAt}</dd>
              {(p.parseWarnings?.length ?? 0) > 0 && <><dt>Parse warnings</dt><dd>{p.parseWarnings!.join("; ")}</dd></>}
            </dl>
          </div>
        )}
      </section>
    </article>
  );
}

function ResearcherDetail({ data, id, onSelect, selection }: { data: Dataset; id: string; onSelect: (s: Selection) => void; selection: Selection }) {
  const r = data.resById.get(id);
  const pubs = useMemo(() => (r ? r.publicationIds.map((x) => data.pubById.get(x)!).filter(Boolean).sort((a, b) => (b.year ?? 0) - (a.year ?? 0)) : []), [r, data]);
  const topics = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pubs) if (p.topicId) m.set(p.topicId, (m.get(p.topicId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pubs]);
  const [showAll, setShowAll] = useState(false);
  if (!r) return <p className="muted">This researcher is not in the snapshot.</p>;
  const co = data.coauthorsByRes.get(r.id) ?? [];
  const sugg = data.suggestionsByRes.get(r.id) ?? [];
  const shown = showAll ? pubs : pubs.slice(0, 12);
  return (
    <article className="res-detail">
      <div className="kicker">Researcher</div>
      <h2 className="detail-title">{r.displayName}</h2>
      <p className="identity">{IDENTITY_TEXT[r.identityStatus]}</p>
      {r.nameVariants.length > 1 && <p className="muted small">Name forms in the source: {r.nameVariants.join("; ")}</p>}
      <p className="stat">Author on {pubs.length} faculty-listed publication{pubs.length === 1 ? "" : "s"} in this snapshot.</p>
      <p className="scope-note">Full-snapshot context: this panel is not recomputed as a time-specific profile.</p>
      {topics.length > 0 && (
        <div className="topic-bar" role="img" aria-label={`Topic mix: ${topics.map(([t, n]) => `${data.topicById.get(t)?.label} ${n}`).join("; ")}`}>
          {topics.map(([t, n]) => (
            <button key={t} type="button" style={{ flexGrow: n, background: topicColor(t) }} title={`${data.topicById.get(t)?.label}: ${n}`}
              onClick={() => onSelect({ kind: "topic", id: t })} aria-label={`${data.topicById.get(t)?.label}, ${n} publications`} />
          ))}
        </div>
      )}
      <section>
        <h3>Possible conversations <span className="src">derived suggestion</span></h3>
        {sugg.length === 0 ? (
          <p className="muted">
            {r.publicationIds.length < (data.graph.meta.parameters.researcherMinPubs ?? 3)
              ? `Suggestions need at least ${data.graph.meta.parameters.researcherMinPubs ?? 3} publications in the snapshot.`
              : "No pairing with enough shared-term evidence in this snapshot."}
          </p>
        ) : (
          <ol className="conv-list compact">
            {sugg.map((s) => <ConversationItem key={s.id} s={s} data={data} selection={selection} onSelect={onSelect} perspective={r.id} />)}
          </ol>
        )}
      </section>
      <section>
        <h3>Coauthors <span className="src">observed</span></h3>
        {co.length === 0 ? <p className="muted">No coauthored publication in this snapshot.</p> : (
          <ul className="coauthors">
            {co.slice(0, 20).map((e) => {
              const o = otherEnd(e, r.id);
              const other = data.resById.get(o)!;
              return (
                <li key={o}>
                  <PersonLink data={data} id={o} name={other.displayName} onSelect={onSelect} />
                  <span className="n">{e.weight} joint</span>
                </li>
              );
            })}
            {co.length > 20 && <li className="muted">and {co.length - 20} more</li>}
          </ul>
        )}
      </section>
      <section>
        <h3>Publications in this snapshot</h3>
        <ul className="pub-list">{shown.map((p) => <PubRow key={p.id} p={p} onSelect={onSelect} />)}</ul>
        {pubs.length > 12 && (
          <button type="button" className="disclosure" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${pubs.length}`}
          </button>
        )}
      </section>
    </article>
  );
}

function highlightTerms(text: string, terms: string[]): ReactNode {
  const words = terms.flatMap((t) => t.split(/\s+/)).filter((w) => w.length > 3).map((w) => fold(w).slice(0, Math.max(4, w.length - 2)));
  if (!words.length) return text;
  return text.split(/(\s+)/).map((tok, i) => {
    const f = fold(tok);
    return words.some((w) => f.includes(w)) ? <mark key={i}>{tok}</mark> : tok;
  });
}

function SuggestionDetail({ data, id, visiblePubs, onSelect }: { data: Dataset; id: string; visiblePubs: Set<string>; onSelect: (s: Selection) => void }) {
  const s = data.suggestionById.get(id);
  if (!s) return <p className="muted">This suggestion is not in the snapshot.</p>;
  const A = data.resById.get(s.researcherA)!, B = data.resById.get(s.researcherB)!;
  const evidence = s.evidence.filter((e) => visiblePubs.has(e.publicationA) && visiblePubs.has(e.publicationB));
  if (!evidence.length) return <article><h2 className="detail-title">This comparison is outside the active filters</h2><p>Widen the filters to restore its supporting publications. The URL keeps the comparison selected.</p></article>;
  return (
    <article className="why">
      <div className="kicker">Possible conversation · derived suggestion</div>
      <h2 className="detail-title pair">
        <PersonLink data={data} id={A.id} name={A.displayName} onSelect={onSelect} />
        <span className="amp">and</span>
        <PersonLink data={data} id={B.id} name={B.displayName} onSelect={onSelect} />
      </h2>
      <p className="absence">{s.absenceNote}</p>
      <section>
        <h3>Why explore this connection?</h3>
        <p>
          Their publications in this snapshot share these terms: <strong>{s.sharedTerms.join(", ")}</strong>.
          Retrieval used TF-IDF cosine; the value {s.score.toFixed(2)} ranks candidates and is not a probability of useful collaboration.
        </p>
        <ol className="evidence">
          {evidence.map((ev, i) => {
            const pa = data.pubById.get(ev.publicationA)!, pb = data.pubById.get(ev.publicationB)!;
            return (
              <li key={i} className="evidence-pair">
                <div className="ev-shared">Shared: {ev.sharedTerms.join(", ")} <span className="muted">· {ev.score.toFixed(2)}</span></div>
                <div className="ev-grid">
                  <EvidencePub p={pa} who={A.displayName} terms={ev.sharedTerms} onSelect={onSelect} />
                  <EvidencePub p={pb} who={B.displayName} terms={ev.sharedTerms} onSelect={onSelect} />
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="method">
        <h3>How this was derived</h3>
        <p>
          Each publication is represented by the terms in its title, plus its abstract and keywords when edoc provides them.
          German, English and French legal and economics phrases are mapped to shared concepts with a published lexicon, and broad words
          such as “Recht”, “law” or “Kommentar” are ignored. Each researcher's profile is the average of their publications,
          so writing more does not make a profile stronger. A pair is only shown when at least one pair of publications
          shares two or more specific terms.
        </p>
        <p className="muted">
          This is keyword overlap, not an assessment of research quality or of whether the two people know each other.
        </p>
      </section>
      {s.question && <p className="question">{s.question}</p>}
      <button type="button" className="copy-link" onClick={() => navigator.clipboard.writeText(location.href)}>Copy comparison link</button>
    </article>
  );
}

function EvidencePub({ p, who, terms, onSelect }: { p: Publication; who: string; terms: string[]; onSelect: (s: Selection) => void }) {
  return (
    <div className="ev-pub">
      <div className="ev-who">{who}</div>
      <button type="button" className="pub-link" onClick={() => onSelect({ kind: "publication", id: p.id })}>{highlightTerms(p.title, terms)}</button>
      <div className="pub-meta">{p.year ?? "n.d."} · {p.publicationType}{p.hasAbstract ? " · abstract available" : ""}</div>
      <a className="source-mini" href={p.sourceUrl} target="_blank" rel="noreferrer">Open source record</a>
    </div>
  );
}

function TopicDetail({ data, id, onSelect }: { data: Dataset; id: string; onSelect: (s: Selection) => void }) {
  const t = data.topicById.get(id);
  const members = useMemo(() => data.publications.filter((p) => p.topicId === id), [data, id]);
  const people = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of members) for (const a of p.authors) m.set(a.researcherId, (m.get(a.researcherId) ?? 0) + 1);
    return [...m.entries()].filter(([r]) => data.resById.get(r)?.identityStatus === "edoc-person-record").sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [members, data]);
  if (!t) return null;
  return (
    <article className="topic-detail">
      <div className="kicker"><span className="swatch" style={{ background: topicColor(t.id) }} aria-hidden="true" />Subject area</div>
      <h2 className="detail-title">{t.label}</h2>
      <p>{t.size.toLocaleString("en")} publications. Frequent terms here: {t.terms.join(", ")}.</p>
      <p className="small">Concepts that define this area: {t.concepts.join(", ")}.</p>
      <p className="muted small">
        {(t.byBasis["concept lexicon"] ?? 0).toLocaleString("en")} assigned because their text names one of these concepts;{" "}
        {(t.byBasis["similar classified publications"] ?? 0).toLocaleString("en")} assigned from their most similar classified publications (weaker evidence).
        This is an approximate grouping, not an official classification.
      </p>
      <section>
        <h3>Researchers with edoc records active here</h3>
        <ul className="coauthors">
          {people.map(([r, n]) => (
            <li key={r}><PersonLink data={data} id={r} name={data.resById.get(r)!.displayName} onSelect={onSelect} /><span className="n">{n}</span></li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Recent publications</h3>
        <ul className="pub-list">
          {members.slice().sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 10).map((p) => <PubRow key={p.id} p={p} onSelect={onSelect} />)}
        </ul>
      </section>
    </article>
  );
}

function About({ data }: { data: Dataset }) {
  const c = data.coverage;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <article className="about">
      <h2 className="detail-title">Where does your work connect?</h2>
      <p>
        Search for a researcher, click a dot, or open one of the possible conversations. Every link on the map
        points back to the publications that support it.
      </p>
      <dl className="facts">
        <dt>Publications</dt><dd>{c.unique.toLocaleString("en")} of {c.sourceReportedTotal.toLocaleString("en")} listed by UNIverse</dd>
        <dt>Years</dt><dd>{c.yearRange ? `${c.yearRange[0]}–${c.yearRange[1]}` : "—"}</dd>
        <dt>Matched in edoc</dt><dd>{c.edoc.matched.toLocaleString("en")} ({pct(c.edoc.matched / c.unique)})</dd>
        <dt>With abstract</dt><dd>{c.abstractCoverage.withAbstract.toLocaleString("en")} ({pct(c.abstractCoverage.share)})</dd>
        <dt>Incomplete author lists</dt><dd>{c.incompleteAuthorLists.toLocaleString("en")}</dd>
        <dt>Researchers (name forms)</dt><dd>{data.researchers.length.toLocaleString("en")}</dd>
      </dl>
      <h3>Reading the map</h3>
      <ul className="plain">
        <li>Positions come from category anchors and sparse links. Distance is for navigation, not a calibrated similarity measure.</li>
        <li>A solid line means the two names share a publication record. A dashed line is a thematic suggestion.</li>
        <li>“No joint publication in this snapshot” is the strongest absence claim made here.</li>
        <li>Dot size is uniform. Nothing on this map ranks people.</li>
      </ul>
      <h3>Limits of this snapshot</h3>
      <ul className="plain">{c.knownExclusions.map((k) => <li key={k}>{k}</li>)}</ul>
    </article>
  );
}
