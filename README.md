# Uni Constellation
## Claude implementation handoff — Faculty of Law pilot
Prepared 2026-10-15 for Achim Imboden. This repository starts empty. This file is the build brief, not evidence of implemented functionality.

### Outcome
Build a compelling, usable research constellation from real public publication metadata of the University of Basel Faculty of Law. Help a researcher answer: **Where does my work connect with other researchers, and which conversations might be interesting?**

Deliver the actual crawler, a checked-in reproducible JSON snapshot, and a functioning D3 exploration UI. Work deeply within this pilot. Do not stop at a plan or substitute invented research records.

### Scope and execution
- Inspect repository instructions, branches and open work before edits. Read the current operating contract at https://github.com/blackmath88/weavr/blob/main/docs/CHATGPT-OPERATING-CONTRACT.md.
- No Observatory or Weavr configuration was present when this empty repository was inspected. Do not invent a Mission or dispatch through Weavr. If governance has since been added, respect its actual state.
- Implement on a feature branch and return a reviewable PR. No merge, deployment, visibility changes or paid API use.
- First bounded delivery: up to 700 unique publications, newest first, from the Faculty of Law listing. Do not widen to other faculties in this slice. Design source adapters so later additions are possible.
- Initial work budget: 30 minutes, then return a tested checkpoint and exact remaining work if incomplete. No delegation required.
- Do not send messages or contact researchers.

### Sources and verified leads
Primary seed:
https://universe.unibas.ch/org-units/47838/publications

Secondary faculty presentation:
https://ius.unibas.ch/de/forschung/

The public UNIverse listing returned **7,807 found** on 2026-10-15, with page-size controls 100 / 200 / 500. The user's suggested 700 is the bounded pilot target, not a verified total. Recheck the total; report unique successfully captured records, not expected counts. Do not claim full faculty coverage.

Useful official documentation:
https://easyweb.unibas.ch/de/anleitungen/publikationslisten/
https://universe.help/

Successfully checked on 2026-10-15, anonymously:
- https://edoc.unibas.ch/server/api — HTTP 200, application/hal+json; DSpace 7.6.2 root with navigable links.
- https://edoc.unibas.ch/server/oai/request?verb=Identify — HTTP 200, OAI-PMH XML.

These verify interfaces, not faculty filtering or record coverage. Follow returned links and discover actual schemas.
https://universe-intern.unibas.ch/api returned HTML for the application, NOT a verified JSON API. Do not claim it as a usable raw-data endpoint or probe private endpoints.

### Acquisition
1. Inspect robots.txt, public page structure and pagination. Respect published limits and access controls.
2. Prefer the public structured response used by the listing if observable without login. Otherwise parse public HTML or use Playwright to render the listing and follow actual controls.
3. Never invent pagination parameters or assume changing the URL changes the records. Confirm distinct record IDs/titles across pages; stop on repeated pages or exhausted results.
4. Capture at most 700 unique publications, reproducibly. Single low-rate request stream (about one request per second), cache responses, bounded retries with backoff, resume support. No full-text crawling for this slice.
5. Parse complete author lists when exposed. “et al.” means authors are incomplete; never fabricate the missing people or infer the full coauthor network.
6. Match optional edoc records by DOI or a conservative title/year comparison; preserve match confidence and unresolved cases. Enrich available abstracts and identifiers within the same request cap; do not block the UI on enrichment.
7. ORCID is optional identity enrichment, not a requirement. Do not download the full global ORCID dump for this pilot or add paid services.
8. Store original citation strings alongside parsed fields so extraction errors remain auditable. Handle accents, HTML entities, escaped DOI URLs, inconsistent name ordering, missing years, book chapters, commentaries and theses.
9. Keep ambiguous name variants separate unless a stable source person ID, ORCID, or reviewed mapping supports merging. Do not equate “S. Gless” and “Sabine Gless” solely by surname and initial.
10. Distinguish being an author on a faculty-listed publication from being a current Basel employee. External coauthors must not appear as confirmed Basel staff.

### Data architecture
Use versioned JSON in the repository first. At this size a database adds no necessary value. Keep collection scripts separate from rendering.

Suggested layout (adapt for a clean implementation):
- scripts/crawl.* — bounded, resumable collection
- scripts/build-graph.* — deterministic normalization and graph generation
- data/raw/ — permitted public source snapshots or minimal raw citation records
- data/publications.json
- data/researchers.json
- data/graph.json
- data/coverage.json
- src/ — app
- docs/DATA_METHOD.md
- docs/VALIDATION.md

Publication fields:
id, sourceRecordId, title, year, publicationType, authors[], authorsComplete, doi, sourceUrl, fetchedAt, rawCitation, abstract|null, abstractSource|null, language|null, facultyScope, parseWarnings[].

Researcher fields:
id, displayName, sourcePersonId|null, orcid|null, affiliations[] with source and date when available, identityStatus, publicationIds[].
Do not manufacture IDs that look like ORCID or institutional IDs. Local generated IDs are clearly local.

Edges:
source, target, type, evidencePublicationIds[], method, evidenceBasis, confidenceLabel.
Keep author-of, coauthorship, and thematic similarity separate. No synthetic citation links when reference lists are unavailable.

coverage.json:
source URLs, retrieval date, source-reported total, fetched/unique/failed/duplicate counts, sampling rule and year range, abstract coverage, incomplete author lists, unresolved identities, known exclusions.

### Relationship logic
- Actual coauthorship is supported by one or more shared publication records.
- Thematic proximity is a derived suggestion, never a confirmed collaboration.
- Provide a transparent baseline based on titles and available abstracts, e.g. TF-IDF with cosine similarity and documented multilingual term normalization. Do not call keyword overlap deep semantic understanding.
- German/English language differences must be acknowledged. If a free local multilingual embedding route is already available and feasible, make it optional and document the model/version. Do not add an API key requirement.
- Keep links sparse: top-k neighbours plus a minimum threshold. Layout distances are visual approximations, not calibrated scientific distances.
- Broad legal words, repeated commentary titles and prolific authors should not dominate merely through volume. Record stopwords and normalization.
- Each suggested researcher pair must cite two relevant publications and the shared terms/topics that support it.
- “No joint publication in this snapshot” is the strongest allowed absence claim. Never say the people have never collaborated or do not know each other.
- Complementary methods or cross-domain opportunities must not be inferred unless supporting metadata exists. A proposed discussion question is labelled as a suggestion.
- Missing metadata remains missing. No invented abstracts, affiliations, research interests or findings.

### UI: make the constellation useful and visually strong
Use D3 for an interactive 2D constellation (SVG for this scale unless measured performance requires Canvas). React + TypeScript + Vite is suitable; keep it statically buildable.

Primary surface:
- A large, restrained research map occupying most of the viewport.
- Publications as nodes; topic groups with readable labels; sparse links revealed on selection.
- Search by researcher, title or topic; year and publication-type filters.
- Pan/zoom, fit-to-view, clear selection and optional layout freeze.
- Selecting a researcher highlights their publications and neighbouring work.
- Selecting a publication opens a readable detail panel: full title, authors, year, source, available abstract, related work, missing-data notes.
- Switch between research topics and observed coauthorship; clearly label the active relationship.
- A “Possible conversations” panel with a small number of meaningful, evidence-linked pairings.
- “Why this connection?” exposes the supporting publications, shared terms and method.
- Preserve selection where possible when filtering; show a useful empty state otherwise.
- No giant always-on spaghetti network. No decorative random connections.

Visual direction:
Sophisticated editorial/Swiss information design, sans-serif typography, crisp hierarchy, restrained palette, intentional whitespace. Avoid generic pastel dashboard cards, excessive pills, gradients and glowing space gimmicks. “Constellation” describes the relationships, not a requirement for a starfield.
Use colour for topics, not researcher quality. Node size must have a stated meaning or be uniform; do not rank people by quality/productivity.
Provide a search/list route that works without interpreting the graph, keyboard controls, visible focus, reduced-motion handling and mobile layout.

Demo framing:
“Public-data pilot · Faculty of Law · [actual count] publications · snapshot [date]”.
This is not an official UNIverse product. Describe future UNIverse integration accurately as planned, not connected.
The data should be real; “demo” describes the interface and bounded snapshot.
Never add a fake “Connect UNIverse” control.

### GitHub and static delivery
The UI reads committed JSON and works without runtime crawling, server, login or API keys. The repository holds code and dataset; GitHub Pages is an optional later hosting destination, not implied by committing code.
Support the repository subpath /uni-constelation/ in the production build.
Provide scripts for dev, build, tests, bounded crawl and graph rebuild. Add CI validation/build if appropriate; do not enable deployment or scheduled crawling in this slice.
Document the source-adapter boundary for a later authorized UNIverse export/API without implementing a fake integration.

### Acceptance
- Real bounded collection attempted; actual unique count and gaps honestly reported. A smaller working snapshot is preferable to padding to 700.
- Subsequent crawl resumes/caches and avoids duplicate records.
- IDs and graph references validate; no dangling links.
- Parser fixtures cover et al., initials, accents, DOI escaping, missing identifiers and mixed publication types.
- Coauthor links have source-publication evidence; similarity links are visibly different and inspectable.
- A user can find a researcher, inspect their work, follow a suggested connection, and explain why it appears.
- A researcher pair with no evidence is not presented as a supported recommendation.
- Build and focused browser tests pass. Inspect desktop and mobile screenshots and fix overlaps, unreadable labels and panel overflow. Do not claim visual verification without rendering.
- Local static build works with the GitHub repository base path and no secrets.
- README documents commands, data snapshot, limitations and future integration.
- PR includes commit, checks, screenshots where available, coverage summary and remaining limitations.

### Suggested build sequence
1. Acquire a small real sample and inspect extraction quality.
2. Normalize and validate the data contract.
3. Build the map/detail/search/pairing experience against the sample.
4. Expand collection up to the 700-record bound; measure coverage and performance.
5. Verify relationships, visual usability, build and reproducibility.
6. Submit the implementation PR with evidence.

Start implementation from this brief. Do not spend the whole session redesigning the architecture or asking for routine choices.
