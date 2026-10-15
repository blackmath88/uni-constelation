# Next build: Law × Economics discovery journey

Status: implemented and validated on the PR branch on 2026-10-15. Concrete results are recorded in `README.md`, `DATA_METHOD.md`, `CANDIDATE_REVIEW.md`, and `VALIDATION.md`.
Continue the existing implementation on `claude/focused-carson-kpli3c` / PR #1. This is an implementation task: build, validate and update the existing PR, rather than returning only a plan. Do not merge or deploy.

## Outcome

Turn Uni Constellation into a convincing, evidence-backed research discovery experience spanning Law and Business and Economics at the University of Basel.

A visitor should be able to find a researcher, publication or subject, explore its neighbourhood, discover relevant work across the faculty boundary, and understand why the connection is suggested. Preserve free exploration of the constellation; make the first useful discovery possible within roughly one minute.

The product question is “Where does my work connect, and whom might I have a useful conversation with?” Treat recommendations as invitations to investigate, never as established collaboration opportunities.

## Starting state and known problems

Reviewed implementation: 79bdc17c94f16608146bcf5073f87368bcc26cbf.
Law snapshot: 7,807 publications; only about 13% have abstracts. Existing edges already represent authorship, shared publication records and derived keyword similarity.
GitHub CI run 38775868182 fails because scripts/build_graph.py writes .cache/layout-input.json without creating its parent. Fix the clean-checkout path first. Local validation claims do not substitute for a passing fresh-checkout build.

Other findings to address:
- Current crawler accepts --org-unit but always overwrites data/raw/universe-listing.json and edoc-enrichment.json.
- Current 13-area classification and UI framing are Law-specific.
- Conversations and detail panels use the full snapshot while filters change the map, without a clear scope boundary.
- Coauthor edges remain visible when both endpoints have any matching publication, even if their joint evidence lies outside the selected period.
- Layout uses category anchors; proximity must not be described as a calibrated semantic measurement.
- Approximately 17 MB of JSON loads before the UI becomes available.

## 1. Collect Economics and combine safely

Approved second source:
- Faculty of Business and Economics, org unit 47827
- https://universe.unibas.ch/org-units/47827/publications
- Public listing observed at 3,127 publications on 2026-10-15. Read the actual reported total during collection; this is not an exact acceptance constant.
Existing Law source: org unit 47838.

Collect the complete Economics listing through the existing public-listing adapter. Retain serial rate limiting, bounded retries, caching, provenance and resumability. Enrich via the existing public edoc adapter. No private endpoint probing, authenticated exports, paid services or additional faculties.

Store each faculty's raw snapshot separately. Preserve the existing Law data. Build a combined normalized dataset:
- One publication per shared UNIverse record ID; use DOI/handle only with explicit conservative duplicate rules and conflict reporting.
- Preserve all source records, source URLs and faculty-listing memberships when deduplicating.
- Publication listing membership is not evidence of a person's current employment or discipline.
- Retain existing identity ambiguity handling. Do not invent ORCIDs or merge initials into full names.
- Report counts per source, overlaps, combined unique records, enrichment and abstract coverage.
- A missing or partial source must be visible, never silently presented as complete.

## 2. Build a small interpretation pipeline

Keep the static website and lightweight JSON graph. No graph database or live inference backend is required.

Separate:
1. Source normalization and identities.
2. Multi-label description of publications.
3. Candidate retrieval and scoring.
4. Evidence-backed graph relationships.
5. UI projections.

A graph stores relationships; it does not make similarity meaningful by itself.

Use multiple subject labels across both faculties. Do not force Economics into Law's taxonomy or give each interdisciplinary publication only one authoritative category.

Where source text supports it, represent subject, research question, method, context and disciplinary perspective. Retain evidence spans/source fields and derivation method. Leave unsupported fields unknown, especially for title-only records. Prefer a narrow defensible extraction to impressive invented enrichment.

Retain TF-IDF as a reproducible baseline. Implement a precomputed multilingual embedding retrieval path using a suitable locally runnable open model; verify model documentation, licence and practical resource requirements before choosing it. Record model revision, preprocessing, text coverage and parameters; cache vectors. Do not introduce paid APIs or credentials. If local inference cannot run in the available environment, implement the adapter and report the blocker honestly; continue the working baseline journey without relabelling it as semantic matching.

Do not compare embedding cosine values as probabilities of useful collaboration. Do not assume a graph algorithm or an LLM explanation validates a candidate.

Build sparse candidate links rather than exporting all pairwise similarities. Keep known authorship/coauthorship separate from derived shared-subject or cross-faculty suggestions. Distinguish existing bridges from possible new conversations.

Candidate cross-faculty status must be supported by publication listing memberships. Handle publications listed in both faculties explicitly; do not manufacture a cross-faculty connection from a duplicate record.

## 3. Make explanations useful and honest

For each suggestion show:
- The two people and supporting publications.
- The specific shared subject or question.
- What each publication contributes, only as supported by metadata/abstract evidence.
- Why the match was retrieved, its evidence coverage and relevant uncertainty.
- “No joint publication in this snapshot” only when that condition holds.
- Direct links to source publications and verified public profiles where available.

Separate shared subject from complementary perspectives. Do not infer a method, finding, current affiliation, willingness to collaborate or research gap from lexical/embedding similarity.

Replace generic template conversation starters where evidence supports a more useful question. Omit the question when it would add unsupported content. Hypothetical examples such as tenancy regulation versus residential mobility are search leads, not facts or required discoveries.

## 4. Build the guided discovery journey

Opening:
“Where does your research connect?”
Search by person, publication or subject, plus up to three manually reviewed, real examples. Include a short optional walkthrough with skip and replay controls. No forced onboarding wall.

Journey:
1. Choose a starting point.
2. See its research neighbourhood and known coauthors.
3. Explore across the faculty boundary.
4. Inspect “Why explore this connection?” with side-by-side publication evidence.
5. Open the original records/profiles or copy a link to the comparison.

Keep the map central and explorable. Faculty is a filter/colour option, not a compulsory spatial separation into two islands. Differentiate publications, people, observed links and inferred links clearly. Allow a list/comparison path without using the canvas.

Use calm, precise visual hierarchy and progressive disclosure. Explain the active view in ordinary language. Preserve mobile usability, keyboard navigation, visible focus and reduced motion.

Make active filter scope consistent:
- Suggestions displayed under a time/type/faculty filter require matching supporting evidence.
- Coauthorship in a filtered period requires at least one shared publication passing that filter.
- If a selected detail intentionally shows full history, explicitly label it as full-snapshot context.
- Filters and comparison state should survive shareable links.
- Do not recompute global person profiles implicitly and claim time-specific scores unless implemented and documented.

Load compact overview data first and detail data on demand where practical. Keep the UI usable during loading and provide ordinary-language failure/retry states.

## 5. Evaluate discovery quality, not just valid JSON

Review 15–20 actual candidate pairs, including both strong and weak examples. Compare keyword baseline and semantic retrieval on the same review set if embeddings run.

For each pair record publication evidence, metadata coverage, retrieval method, review rationale and one outcome: useful / obvious / misleading / insufficient evidence. Distinguish implementer review from independent faculty-expert validation. Include cross-language and cross-faculty cases; actively look for namesake, generic-term, series/edition and missing-abstract failures.

Choose up to three strong real examples for the opening journey from this review. Never fabricate examples to reach three. Document if evidence is insufficient.

## Acceptance and handoff

- Law snapshot preserved; full bounded Economics collection attempted with completeness honestly reported.
- Two source snapshots combine without lost provenance or duplicate publications.
- No faculty employment inferred from authorship/listing membership.
- Shared subject, observed collaboration and proposed conversation remain distinct.
- A visitor can complete the journey from entry to cross-faculty evidence and source records.
- Period/type/faculty filtering does not leave unsupported coauthor edges or suggestions.
- Source claims and interpretive fields have traceable evidence; unknowns stay unknown.
- Fresh-checkout graph build, validation, production build and relevant browser tests pass.
- Test two-source overlap, filter evidence semantics, unavailable abstract, invalid deep link and empty results.
- Check desktop/mobile screenshots yourself; report remaining visual/accessibility limitations.
- Record actual loading/payload measurements rather than assuming performance.
- Update README, DATA_METHOD and VALIDATION to describe the combined scope and actual completed checks.
- Update existing PR #1 with results, reviewed examples, limitations and reproduction instructions. Do not merge or deploy.

Stay within these two faculties and this discovery journey. Avoid a new platform, general university crawler, chatbot, GraphRAG infrastructure or paid inference service. Deliver working changes and evidence.
