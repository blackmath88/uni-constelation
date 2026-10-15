# Validation

Results for the committed snapshot (2026-10-15). Commands: `npm test` (unit + data contract) and `npm run test:e2e` (browser).

## Data contract — `scripts/validate.py`

```
validated 7807 publications, 1672 researchers, 35817 edges, 192 suggestions
OK: no dangling references; all relationships carry evidence
```

Checks:

- no duplicate publication, researcher or source-record IDs
- all required publication fields present
- every author resolves to a researcher, and every researcher's `publicationIds` resolve and list them as an author
- researcher IDs are local (`r-…`); `sourcePersonId` only `edoc-authority:<uuid>`; no ORCID values are invented (all `null`)
- abstracts only with `abstractSource: "edoc"`; DOIs match `10.xxxx/…`
- every edge endpoint exists, every edge carries `evidencePublicationIds`, and every edge type is defined in `edgeTypes`
- each coauthorship edge's two people both appear on every cited publication
- coauthorship and author-of are labelled *observed*; thematic similarity is labelled *derived suggestion*
- each suggestion pairs two existing researchers who are **not** coauthors in the snapshot, cites evidence publications authored by each side with ≥ 2 shared terms, says "No joint publication in this snapshot.", and labels its question as a suggestion
- every publication has a layout position; coverage counts match the files

## Parser and identity fixtures — `tests/test_citation.py`

There are 11 real citation fixtures from the listing (`tests/fixtures/citations.json`). They cover:

- *et al.* truncation
- initials-only names
- accents and HTML entities
- a DOI field holding a handle URL, which is rejected as a DOI
- missing identifiers
- literal "Given Family" names, mixed literal and inverted lists, and double family names
- editors
- a missing year
- journal / chapter / commentary / book / thesis types

Identity tests check four rules:

- `S. Gless` ≠ `Sabine Gless`
- `Gless, Sabine` = `Sabine Gless`
- an edoc authority absorbs an exact full name but not initials
- two different authorities with the same name stay separate, and a plain-name occurrence joins neither

Result: `Ran 6 tests … OK` (fixture cases run as sub-tests).

## Reproducibility

- **Resume:** re-running `python3 scripts/crawl.py --max-records 8000 --max-edoc-requests 600 --offline` used 0 network requests and 270 cache hits, and reproduced the same 7,807 records and 6,526 edoc matches with the original fetch timestamps.
- **Deterministic build:** two consecutive `build_graph.py` + `layout.mjs` runs produce byte-identical `data/` (`diff -r` clean). CI repeats this check on its runner.
- **Static build:** `vite build` emits `dist/` with base `/uni-constelation/` and copies only the five app JSON files (no `data/raw`). No secrets or environment variables are used.

## Browser tests — Playwright against the production build (`vite preview`, `/uni-constelation/`)

```
✓ [desktop] loads the static build with the snapshot framing and a rendered map
✓ [mobile]  mobile layout: map on top, tabbed panels, no horizontal overflow
✓ [desktop] find a researcher, inspect their work and open a publication
✓ [desktop] follow a suggested connection and see why it appears
✓ [desktop] switch relationship mode and keep the label clear
✓ [desktop] filters preserve selection and show an empty state
✓ [desktop] list view works without the graph and topics are selectable
✓ [desktop] map responds to clicks and keyboard zoom
8 passed
```

No page errors were logged in any flow. Time from navigation to rendered map: about 0.6–1.1 s locally (1440×900 and Pixel-class 393×851).

## Visual inspection

The screenshots in `docs/screenshots/` were rendered from the production preview and reviewed. Issues found during review and fixed before commit:

- Tabular figures in Schibsted Grotesk widened punctuation ("7 ,807"), so `tnum` is limited to years.
- Area labels collided or ran off the canvas. They are now placed greedily, nudged vertically and clamped to the view, with ink text and a colour dot (yellow text was unreadable).
- Unsupervised clusters produced blended, misleading labels. They were replaced by lexicon-based legal areas with a disclosed fallback and grey "not assigned".
- The top suggestions were dominated by yearly series and new editions of the same work. These are now excluded as evidence, and duplicate concept/raw terms are no longer counted twice.
- Prolific researchers collected up to 10 suggestions. The cap is now 3 per person.
- Searching "Gless" ranked a single-name record above "Sabine Gless". Ranking now prefers name-word starts, then edoc-linked identities.
- Two name labels for a suggested pair overlapped, and coauthor hubs were cluttered with labels. Labels are now nudged apart, and only the top 10 coauthors are labelled.
- In coauthorship mode, a researcher without coauthors left the map blank. An explicit notice now explains why.
- Mobile: no horizontal overflow (asserted in the test); panels sit in tabs under the map.

## Not verified

- Behaviour on GitHub Pages itself (no deployment was made).
- Screen-reader output was not tested with assistive technology. ARIA roles and labels, visible focus and the list view are in place.
- Dark mode is implemented with `prefers-color-scheme` tokens but was not screenshot-reviewed.
- Correctness of individual edoc author lists and types is taken from the source.
