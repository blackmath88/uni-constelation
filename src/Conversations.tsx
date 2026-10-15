import { useMemo } from "react";
import { suggestionHasVisibleEvidence, type Dataset } from "./data";
import type { Selection, Suggestion } from "./types";

/** A small, diverse set of the strongest evidence-linked pairings: each researcher appears at most once. */
export function topConversations(data: Dataset, visiblePubs: Set<string>, n = 8): Suggestion[] {
  const used = new Set<string>();
  const out: Suggestion[] = [];
  const featured = new Set(data.graph.featuredSuggestionIds);
  for (const s of [...data.graph.suggestions].sort((a, b) => Number(featured.has(b.id)) - Number(featured.has(a.id)) || b.score - a.score)) {
    if (!suggestionHasVisibleEvidence(s, visiblePubs)) continue;
    if (used.has(s.researcherA) || used.has(s.researcherB)) continue;
    used.add(s.researcherA); used.add(s.researcherB);
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

export function Conversations({ data, selection, visiblePubs, onSelect }: { data: Dataset; selection: Selection; visiblePubs: Set<string>; onSelect: (s: Selection) => void }) {
  const list = useMemo(() => topConversations(data, visiblePubs), [data, visiblePubs]);
  return (
    <section className="conversations" aria-labelledby="conv-h">
      <div className="section-head"><h2 id="conv-h">Across the faculty boundary</h2></div>
      <p className="hint">
        Pairs supported by one Law-listed and one Economics-listed publication that both pass the active filters.
        These are suggestions from keyword overlap, not known collaborations.
      </p>
      {list.length === 0 && <p className="muted">No pairing meets the evidence threshold in this snapshot.</p>}
      <ol className="conv-list">
        {list.map((s) => <ConversationItem key={s.id} s={s} data={data} selection={selection} onSelect={onSelect} />)}
      </ol>
    </section>
  );
}

export function ConversationItem({ s, data, selection, onSelect, perspective }: {
  s: Suggestion; data: Dataset; selection: Selection; onSelect: (s: Selection) => void; perspective?: string;
}) {
  const A = data.resById.get(s.researcherA)!, B = data.resById.get(s.researcherB)!;
  const on = selection?.kind === "suggestion" && selection.id === s.id;
  const [first, second] = perspective === B.id ? [B, A] : [A, B];
  return (
    <li>
      <button type="button" className={`conv${on ? " on" : ""}`} aria-pressed={on} onClick={() => onSelect({ kind: "suggestion", id: s.id })}>
        <span className="conv-names">
          {perspective ? <>{second.displayName}</> : <>{first.displayName}<span className="conv-amp"> and </span>{second.displayName}</>}
        </span>
        <span className="conv-terms">{s.sharedTerms.slice(0, 3).join(", ")}</span>
        <span className="conv-why">Why explore this connection?</span>
      </button>
    </li>
  );
}
