# Data method

## Sources, collection and combination

Only two anonymous public UNIverse listings are in scope: Law org unit `47838` and Business and Economics org unit `47827`. The adapter posts the same pagination request as the public listing UI, serially at about one request/second, with three bounded retries and an on-disk cache. It compares IDs across pages and stops at an empty/repeated page, the configured cap, or the reported total. edoc enrichment uses batched anonymous DSpace discovery queries: linked handle; exact DOI; then exact folded title + year + shared author family for titles of at least five words.

Each faculty writes `universe-listing-<faculty>.json` and `edoc-enrichment-<faculty>.json`; `--org-unit` accepts only the two approved IDs. A crawl cannot overwrite the other faculty.

Combination uses UNIverse record ID as the authoritative duplicate key. A shared ID retains both memberships and both source records. DOI or handle collisions across different IDs are reported, not merged. Missing sources, partial stops, field conflicts and identifier collisions are explicit in `coverage.json`.

## Normalisation and identities

Citation parsing retains `rawCitation` and warnings. edoc fields win where matched. Unknown abstract, method, question, context, perspective or finding stays unknown. No employment or discipline is inferred from authorship or listing membership.

An edoc authority UUID is a stable source identity. Otherwise exact full-name token equality is used. Initials never merge into full names; two authorities with the same name stay separate. All IDs are local and no ORCID is invented.

## Multi-label description and TF-IDF baseline

Input text is title (weighted twice), edoc abstract and edoc keywords. Normalisation folds case/accents, removes multilingual function words and boilerplate, applies light stemming, and maps a German/English/French concept lexicon to shared legal and economics labels. Every directly supported area is retained in `subjectLabels[]` with evidence fields and method. The primary `topicId` is only a map projection; otherwise-unlabelled records may receive a disclosed similarity-vote fallback or stay unassigned.

TF-IDF uses `min_df=2`, `max_df=max(30, 8% of documents)`, sublinear term frequency, smoothed IDF and L2 normalisation. Each publication keeps at most four neighbours at cosine ≥0.22.

## Candidate retrieval and evidence

Researcher profiles average publication vectors and are L2-normalised. Candidates require ≥3 publications, profile cosine ≥0.20, no shared publication, and at least one edoc-linked identity. Evidence requires up to three disjoint publication pairs with cosine ≥0.18 and at least two distinct shared terms. Near-duplicate titles are rejected.

Every displayed candidate is cross-faculty: each evidence pair contains one Law-only and one Economics-only record. A record listed by both cannot manufacture a bridge. `sharedSubject`, publication pairs, metadata coverage, method and uncertainty are stored. Questions are narrow prompts to inspect framing, not inferred methods, findings, gaps, willingness or complementary expertise.

Observed authorship/coauthorship and derived similarity are distinct edge types. Records with more than 50 authors keep all author-of evidence but do not expand into pairwise coauthorship.

## Optional semantic retrieval

`scripts/embed.py` uses `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, pinned to revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`. Its model card identifies Apache-2.0 licensing, 384 dimensions, a 128-token maximum and multilingual sentence-similarity use. Input is title + available edoc abstract + keywords; vectors are normalized; the top 3 across-faculty neighbours per Law publication are retained at cosine ≥0.35.

The local run covered 10,933 records and produced 23,395 sparse pairs. Cached vectors are about 16 MiB; the committed file is 1.6 MiB (0.18 MiB gzip). Sentence-transformers 5.1.2 / PyTorch 2.8 on Apple arm64 encoded the corpus in about 16 seconds after download. Cosine is a retrieval score, never a probability. The UI still uses the reproducible TF-IDF path; semantic retrieval is comparison evidence, not validation.

References: [model card](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) and [Sentence Transformers semantic-search documentation](https://www.sbert.net/examples/sentence_transformer/applications/semantic-search/README.html).

## UI projection and loading

Filters determine visible publications. Coauthor edges survive only if a shared evidence publication passes; suggestions survive only if both publications in an evidence pair pass. Faculty filters use listing membership. Filter, view, mode and selection state are shareable in the URL. Researcher detail deliberately shows full-snapshot history and says so.

Compact overview records load first. `publication-details.json`—abstracts, citations, source records and warnings—is fetched on first publication open. Layout is fixed-seed d3-force around category anchors and sparse links; it is for navigation, never a calibrated distance.
