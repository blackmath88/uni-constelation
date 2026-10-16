# Uni Constellation

### Make research visible. Find a conversation worth having.

Explore how publications and researchers connect across the University of Basel's Law and Business and Economics listings. Follow a connection back to the publications that support it.

**[Explore the demo](https://blackmath88.github.io/uni-constelation/) · [Data and method](docs/DATA_METHOD.md) · [Run locally](#run-locally) · [Evidence](docs/VALIDATION.md)**

![Uni Constellation: a research landscape grouped by subject, with faculty and year filters and an explanation of the evidence.](docs/screenshots/law-economics-overview.png)

*Recorded interface from the Law × Economics pilot. Positions help navigation; distance on the map is not a calibrated measure of similarity.*

> **Competition snapshot · frozen.** Submitted to the Universität Basel Ideenwettbewerb 2026. The published demo and its URL are preserved. This is an independent prototype, not an official UNIverse product. [Freeze record](AGENTS.md).

## Start with one question

**Where does my work connect—and who might be interesting to talk to?**

1. Search for a researcher, publication or subject.
2. Explore the neighbourhood, or switch to the searchable list.
3. Open a cross-faculty comparison and inspect the two supporting publications.
4. Follow the original records; copy the comparison URL to share the question.

An existing coauthorship and a possible conversation are different kinds of connection. The interface keeps that distinction visible.

## What is inside

| Snapshot: 15 October 2026 | Coverage |
|---|---|
| Publications | 10,933 unique records from two faculty listings |
| Researcher identities | 8,242 name-based identities; not verified unique people |
| Abstracts available | 2,742 records, or 25.1% |
| Cross-faculty suggestions | 32 leads to inspect, not recommendations validated by researchers |

The pilot brings public UNIverse listings and matched edoc records into a static React/D3 interface. Thematic suggestions use a TF-IDF baseline. Every comparison should be read alongside its evidence and missing information.

## Run locally

Use **Node.js 22+**. The committed snapshot is enough to explore the app; a new crawl is unnecessary.

```bash
git clone https://github.com/blackmath88/uni-constelation.git
cd uni-constelation
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL Vite prints. Search and select a publication to reach its detail and source links. For Python-based data checks, browser tests and optional semantic experiments, see the [technical guide](.github/TECHNICAL_GUIDE.md).

## Read the evidence correctly

- Faculty-list membership describes a source, not a person's current employer or discipline.
- Name matching can split one person or combine namesakes.
- Most records have no abstract; many similarities depend on titles and keywords.
- The graph does not contain full texts or citation networks. Similarity is not a probability of successful collaboration.
- “No joint publication in this snapshot” does not mean two people have never collaborated.

## Go deeper

| Your question | Start here |
|---|---|
| Where do the data and connections come from? | [Data method](docs/DATA_METHOD.md) |
| How were candidate connections reviewed? | [Candidate review](docs/CANDIDATE_REVIEW.md) |
| What was tested? | [Recorded validation](docs/VALIDATION.md) |
| How is the snapshot built and checked? | [Technical guide](.github/TECHNICAL_GUIDE.md) |
| Can I contribute? | [Contribution boundaries](CONTRIBUTING.md) |

**Reuse:** no repository-wide code license is currently declared. Public visibility does not grant a reuse license; source records retain their own rights and attribution requirements.

Created by Achim Imboden. Further development is separate from this frozen competition snapshot.
