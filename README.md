# Uni Constellation

**Public-data pilot · Law × Business and Economics · 10,933 unique publications · snapshot 2026-10-15**

An evidence-backed discovery map for asking: *Where does my research connect, and whom might I have a useful conversation with?* It combines the University of Basel UNIverse listings for Law and Business and Economics, while treating suggestions as leads to investigate—not collaboration claims.

The guided path is optional: search for a person, publication or subject; explore the neighbourhood and known coauthors; open a cross-faculty comparison; inspect its two source publications; then open the original records or copy the comparison URL. The map remains freely explorable, and list view provides a keyboard-friendly alternative.

This is **not an official UNIverse product**. Listing membership is source provenance, not evidence of a person's employment or discipline.

## Snapshot

| | Result |
|---|---:|
| Law listing (org 47838) | 7,807 / 7,807, complete |
| Business and Economics (org 47827) | 3,127 / 3,127, complete |
| Shared UNIverse record IDs | 1 |
| Combined unique records | **10,933** |
| edoc matches | 9,153 (83.7%) |
| Abstracts | 2,742 (25.1%) |
| Years | 1972–2026 |
| Researchers/name identities | 8,242 |
| Edges | 23,746 author-of · 22,317 coauthorship · 28,173 thematic |
| Cross-faculty suggestions | 32 |

The two raw sources remain separate in `data/raw/`. A shared UNIverse ID becomes one normalized publication with both memberships and both source records. Repeated DOI/handle values on different UNIverse IDs are reported in `data/coverage.json`, not silently merged.

## Run and verify

Requirements: Node 22+ and Python 3.11+ with NumPy.

```bash
npm ci
python3 -m pip install numpy
npm run graph
npm test
npm run build
npm run test:e2e
```

Collection is faculty-scoped, cached, serial, bounded and resumable:

```bash
npm run crawl:law
npm run crawl:economics
npm run crawl:full
python3 scripts/crawl.py --org-unit 47827 --offline --max-records 4000
```

The optional local semantic adapter uses the pinned Apache-2.0 multilingual MiniLM revision documented in `docs/DATA_METHOD.md`:

```bash
pip install sentence-transformers
npm run embed
```

It writes sparse neighbours to `data/semantic-neighbors.json`; the product continues to label and use TF-IDF as its baseline. No API key, paid service, backend, deployment workflow or scheduled crawl is involved.

## Product and evidence rules

- Publications can carry multiple direct subject labels. The single map colour is only a primary projection; fallback assignments are labelled weaker.
- Solid coauthor links require a shared publication passing the active filters. Suggestions require a Law-only and an Economics-only evidence publication that both pass.
- Researcher panels explicitly show full-snapshot context; no time-specific person score is implied.
- Comparisons show shared terms, coverage, side-by-side publications, uncertainty, source links and “No joint publication in this snapshot.”
- Map positions use category anchors and sparse links for readability, not calibrated semantic distance.
- Filters and comparison state survive in the URL. Invalid links, missing abstracts, empty results and load failures have ordinary-language states.
- Six publications with more than 50 authors retain every author-of edge but are not expanded into combinatorial coauthorship cliques.

## Loading footprint

The production build loads the compact overview first: graph 1.04 MiB gzip, publications 1.31 MiB, researchers 0.31 MiB, layout 0.15 MiB and coverage 0.003 MiB—about **2.81 MiB gzip** total. The 2.41 MiB gzip publication-detail file is fetched only after a publication is opened. This cuts initial JSON by 42%, though the overview remains substantial on slow phones.

See [data method](docs/DATA_METHOD.md), [candidate review](docs/CANDIDATE_REVIEW.md), and [validation evidence](docs/VALIDATION.md).

## Limitations

- 74.9% of records have no abstract; many matches rest on titles and source keywords.
- TF-IDF and embedding cosine are retrieval scores, not probabilities of useful collaboration.
- Name-only identities can split a person or merge namesakes. Initials remain separate.
- Unsupported questions, methods, findings, contexts and disciplinary perspectives remain unknown.
- No full texts, citation networks, ORCID enrichment, independent faculty-expert review, assistive-technology session, deployment or GitHub Pages verification.
