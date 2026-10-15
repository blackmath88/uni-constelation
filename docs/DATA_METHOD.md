# Data method

How the Faculty of Law snapshot is collected, normalised and turned into relationships. Every parameter below is also written into `data/graph.json → meta.parameters` and `data/coverage.json`.

## 1. Sources and access

| Source | What we use | Access verified |
|---|---|---|
| UNIverse public research portal, Faculty of Law listing — `https://universe.unibas.ch/org-units/47838/publications` | Publication list: record ID, rendered citation (CSL HTML, Harvard style), DOI/edoc/other links | `robots.txt` is `Allow: /`. The listing page is an Angular app. Its JavaScript calls `POST https://universe-intern.unibas.ch/api/public/prp/orgUnits/publications` with `{"orgUnitId":"47838","paginationRequest":{"page":<0-based>,"size":<100\|200\|500>}}`. This is the public structured response behind the page, used anonymously exactly as the page uses it. No other `universe-intern` endpoint is used, and no login or private endpoint is probed. |
| edoc, the University of Basel repository (DSpace 7.6.2) — `https://edoc.unibas.ch/server/api/discover/search/objects` | Authors with authority IDs, document type, abstract, keywords, language, DOI | Anonymous GET. Queries are batched: `handle:("…" OR …)`, `dc.identifier.doi:(…)`, `title:("…" OR …)`. |

The listing exposes **no structured authors, years or types**: only a rendered citation string. All structure comes from parsing that string, or from edoc when the record can be matched.

## 2. Collection (`scripts/crawl.py`)

- One request stream at about 1 request/second, with bounded retries (3, exponential backoff from 2 s). The user agent identifies the project.
- Every response is cached in `.cache/http/` (gitignored). Re-running reuses the cache, so an interrupted crawl resumes, and `--offline` rebuilds raw files from the cache alone.
- Pagination is never assumed to work. Each page's record IDs are compared with those already seen. Collection stops on an empty page, on a page with no new IDs (a repeated page), at the source-reported total, or at `--max-records`.
- `--max-records 700` is the README's pilot bound (`npm run crawl`). The committed snapshot was collected with `--max-records 8000` (`npm run crawl:full`) at the requester's explicit instruction to capture the whole listing.
- edoc enrichment is capped by `--max-edoc-requests` (600 for the committed snapshot). Matching tiers, strongest first:
  1. **handle**: the UNIverse record links an edoc handle. Confidence: high.
  2. **doi**: the DOI is identical (case-insensitive). Confidence: high.
  3. **title+year+author**: the folded title is identical, the year is the same, and at least one author family name is shared. Confidence: medium. Titles under five words (for example "Einleitung") are not attempted.
  Weaker candidates are recorded as unresolved with a reason, never used.
- Raw files committed: `data/raw/universe-listing.json` (original citation HTML per record, links, page log) and `data/raw/edoc-enrichment.json` (the extracted fields of matched edoc items, plus unresolved reasons).

## 3. Citation parsing (`scripts/unicon/citation.py`)

- HTML entities are decoded and italics are tracked, because italics mark the journal or book title in Harvard CSL.
- Year: the first `(YYYY)` in the citation. `(n.d.)` leaves the year missing, with a warning.
- Authors: CSL renders each name as `Family, Given` (two comma tokens) or as one literal token such as `Sabine Gless`. An odd number of tokens means one literal name. A literal's family name is its last word (particles like *van/von/de* are kept), and the warning "name order inferred" is recorded.
- `et al.` sets `authorsComplete: false`. Missing coauthors are never invented.
- `(ed.)`/`(eds)`/`(Hrsg.)` marks editor role.
- Type, used only when edoc has no type: a quoted title followed by `in <i>…</i>` is a book chapter, or a commentary contribution when the container or title names a commentary (Kommentar, Commentaire, BSK …). A quoted title followed by `<i>Journal</i>` is a journal article. An italic title is a book. "Doctoral/Postdoctoral thesis" marks a thesis. The source of each type is stored in `publicationTypeSource`.
- DOI: taken from the DOI link only if it actually contains `10.xxxx/…`. A DOI field that holds a handle URL (seen in the data) is rejected with a warning.
- `rawCitation` always stores the original text, and `parseWarnings[]` lists every heuristic used.

Fixtures for et al., initials, accents, DOI escaping, missing identifiers, literal names, editors and mixed types live in `tests/fixtures/citations.json`.

## 4. Identities (`Identities` in `scripts/build_graph.py`)

| Rule | Effect |
|---|---|
| edoc `dc.contributor.author` with an authority UUID (confidence ≥ 500) | One researcher per UUID. `sourcePersonId = "edoc-authority:<uuid>"`. `identityStatus = "edoc-person-record"`. |
| Name with a full given name | Keyed by the folded token multiset of given + family name, so `Gless, Sabine` and `Sabine Gless` meet. This is exact equality, not fuzzy matching. |
| Full-name key equal to exactly one edoc-linked person's name | Joins that person (recorded in `mergeEvidence`). |
| Same name, two different edoc UUIDs | Kept separate. A plain-name occurrence joins neither. |
| Initials only (`S. Gless`) | Never merged with a full name. `identityStatus = "initials-only"`. |

All researcher IDs are local (`r-<sha1>`). No ORCID or institutional IDs are produced. Authorship on a faculty-listed publication is **not** treated as Basel employment. The UI says "Linked to a person record in edoc … not current employment" or "may be an external coauthor".

## 5. Text normalisation and TF-IDF (`scripts/unicon/text.py`)

Document text = title (counted twice) + edoc abstract + edoc keywords, when available. Records without an edoc match contribute only their title, which is a known bias. The share of records with abstracts is reported in `coverage.json`.

1. Fold case and accents (ß→ss).
2. **Concept lexicon:** about 35 regular expressions map German, English and French legal phrases to shared concept tokens. For example `Datenschutz` / `data protection` / `protection des données` / `DSG` / `GDPR` map to *data protection*, and `künstliche Intelligenz` / `AI` / `KI-VO` / `algorithm…` map to *artificial intelligence*. The full list is in `CONCEPTS`. Hand-made and English-labelled, it is the only cross-language bridge. Terms outside it stay language-specific.
3. **Stopwords:** DE/EN/FR/IT function words, plus broad legal boilerplate that would otherwise connect everything: *Recht, law, droit, Art., Abs., Kommentar, Kommentierung, Einleitung, Schweiz, Swiss, Bundesgericht, Urteil, BGE, Festschrift, Auflage, Reform, Entwicklungen …*
4. Light suffix stemming (`-en -er -es -e -s -ungen -ischen …`, keeping at least four characters). The most frequent surface form is shown in the UI.
5. TF-IDF uses sublinear term frequency, smoothed IDF, `min_df = 2`, and `max_df = max(30, 8% of documents)`. Concept tokens are exempt from `max_df`. Rows are L2-normalised.

This is keyword overlap. It is not semantic understanding, and the UI says so. No embedding model is used, so there is no API key, no download and no paid service.

## 6. Relationships

| Type | Meaning | Evidence | Label |
|---|---|---|---|
| `author-of` | Researcher is listed as author/editor | the publication | observed |
| `coauthorship` | Both names appear on the same publication record | `evidencePublicationIds[]` (all shared records) | observed |
| `thematic-similarity` | Two publications share specific terms | the two publications + `sharedTerms[]` + cosine score | derived suggestion |

- Publication similarity is sparse: each publication keeps its top 4 neighbours with cosine ≥ 0.22, and the union is taken.
- No citation links are created, because no reference lists were collected.

### Suggested researcher pairs ("Possible conversations")

- Eligible: researchers with ≥ 3 publications in the snapshot and an edoc person record or full name. Initials-only and single names are excluded.
- Profile = **mean** of their publication vectors, L2-normalised. Publishing more does not make a profile stronger, and nobody is ranked by output.
- A candidate pair needs a profile cosine ≥ 0.20, **no** shared publication in the snapshot, and at least one side linked to an edoc person record.
- Evidence: up to 3 disjoint publication pairs (one from each person, neither jointly authored), each with cosine ≥ 0.18 and **at least two distinct shared terms**. Pairs whose titles are near-duplicates (token Jaccard ≥ 0.6 without numbers) are skipped, because yearly series instalments ("Chronique … 2009/2012") and new editions of one commentary are not evidence of a new connection. A researcher pair with no remaining evidence is dropped and never shown.
- A raw word already represented by a matched concept ("Datenschutz" with *data protection*) is not counted twice, so a single idea cannot pass as two shared terms.
- Each researcher appears in at most 3 suggestions, so prolific authors do not dominate. The committed snapshot has 192 suggestions.
- Every suggestion carries `absenceNote: "No joint publication in this snapshot."` (the strongest absence claim made) and a conversation starter labelled "Suggested conversation starter". No complementary methods, interests or findings are inferred.

## 7. Legal areas and layout

- **Legal areas (the map colours):** the 35 lexicon concepts are grouped into 13 broad areas (`LEGAL_AREAS` in `build_graph.py`), for example *Criminal law & procedure* = criminal law, criminal procedure, sanctions, corruption.
  1. A publication whose text contains one or more concepts goes to the area with the highest summed TF-IDF weight of its concepts (`topicBasis: "concept lexicon"`). This covers 4,814 publications.
  2. Otherwise it takes a similarity-weighted vote of its 10 most similar lexicon-classified publications. Only neighbours with cosine ≥ 0.22 count, and the vote total must reach 0.6 (`topicBasis: "similar classified publications"`, shown in the UI as weaker evidence). This covers 1,341 publications.
  3. Everything else stays **unassigned** (1,652 publications, drawn grey). It is not forced into an area.
- Unsupervised k-means clusters were tried first. They produced blended clusters (e.g. "human rights · competition law") with low coherence, so they were replaced by this explainable scheme.
- Layout (`scripts/layout.mjs`): d3-force with its fixed-seed random source. Area anchors are placed first, closer when area centroids are more similar. Classified publications are pulled to their anchor. Unassigned publications feel no anchor, so similarity links alone place them between areas. A second layout places researchers by coauthorship.
- Positions are a readability aid. **Distances are not calibrated measurements.** Dot size is uniform.

## 8. Source-adapter boundary and future UNIverse integration

`scripts/unicon/sources/` holds one module per source, and each returns plain records. An authorised UNIverse export or API, if one is provided later, would be a new adapter producing the same raw record shape:

```
{ sourceRecordId, bibliographyHtml | structured fields, urls{}, fetchedAt, listPosition }
```

Structured authors with person IDs from such an export would replace citation parsing and name-based identity. That integration is **planned, not connected**: nothing in this repository calls a private UNIverse interface or pretends to.
