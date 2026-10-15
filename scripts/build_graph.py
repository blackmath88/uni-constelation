#!/usr/bin/env python3
"""Deterministic normalisation + graph generation from data/raw/.

  python3 scripts/build_graph.py

Reads  data/raw/universe-listing.json, data/raw/edoc-enrichment.json (optional)
Writes data/publications.json, data/researchers.json, data/graph.json,
       data/coverage.json, .cache/layout-input.json (consumed by scripts/layout.mjs)
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from unicon.citation import INITIALS_RE, fold, parse_citation  # noqa: E402
from unicon.text import CONCEPTS, STOPWORDS, analyse, concept_label, detect_language  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
METHOD_VERSION = "tfidf-cosine-v1"

# Thematic similarity parameters (documented in docs/DATA_METHOD.md)
PUB_TOP_K = 4
PUB_MIN_SIM = 0.22
MIN_DF = 2
MAX_DF_RATIO = 0.08
RES_MIN_PUBS = 3
RES_TOP_K = 3
RES_MIN_SIM = 0.20
EVIDENCE_MIN_SIM = 0.18
MAX_TOPICS = 12

EDOC_TYPE_LABELS = {
    "journal_article": "Journal article", "article": "Journal article", "review": "Review / commentary article",
    "book_part": "Book chapter", "book_chapter": "Book chapter", "book": "Book", "edited_book": "Edited book",
    "thesis": "Thesis", "doctoral_thesis": "Thesis", "conference_paper": "Conference paper",
    "conference_object": "Conference paper", "working_paper": "Working paper", "report": "Report",
    "other": "Other", "newspaper_article": "Newspaper / magazine article", "book_review": "Book review",
    "case_note": "Case note", "commentary": "Commentary contribution",
}

LANG_ISO3 = {"deu": "de", "ger": "de", "eng": "en", "fra": "fr", "fre": "fr", "ita": "it", "spa": "es", "nld": "nl", "dut": "nl"}


def local_id(prefix: str, key: str) -> str:
    return f"{prefix}-{hashlib.sha1(key.encode()).hexdigest()[:10]}"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")[:40]


# ---------------------------------------------------------------- identities
class Identities:
    """Author identity resolution.

    Rules (docs/DATA_METHOD.md#identities):
      * an edoc authority UUID is a stable source person ID → one researcher per UUID
      * a name with a full given name is keyed by folded (family, given); literal
        "Given Family" names are keyed by the same token multiset, so "Sabine Gless"
        and "Gless, Sabine" meet — this is exact full-name equality, not fuzzy matching
      * a full-name key that equals exactly one edoc-linked person's name joins that person
      * initials-only names ("S. Gless") are never merged with full names
    """

    def __init__(self):
        self.people: dict[str, dict] = {}
        self.authority_names: dict[str, set[str]] = defaultdict(set)  # name key -> authority person ids

    @staticmethod
    def name_key(family: str, given: str) -> str:
        toks = sorted(fold(f"{given} {family}").split())
        return " ".join(toks)

    def _get(self, pid: str, display: str, **kw) -> dict:
        p = self.people.get(pid)
        if p is None:
            p = {"id": pid, "displayName": display, "nameVariants": Counter(), "sourcePersonId": None,
                 "orcid": None, "affiliations": [], "identityStatus": kw.get("status", "name-only"),
                 "publicationIds": [], "mergeEvidence": []}
            self.people[pid] = p
        p["nameVariants"][display] += 1
        return p

    def register_authority(self, authority: str, family: str, given: str) -> str:
        pid = local_id("r", "edoc:" + authority)
        p = self._get(pid, f"{given} {family}".strip(), status="edoc-person-record")
        p["sourcePersonId"] = f"edoc-authority:{authority}"
        if not p["affiliations"]:
            p["affiliations"].append({
                "label": "Linked to a person record in edoc, the University of Basel repository",
                "source": "edoc dc.contributor.author authority", "date": None})
        if given and not INITIALS_RE.match(given):
            self.authority_names[self.name_key(family, given)].add(pid)
        return pid

    def resolve_name(self, family: str, given: str) -> str:
        initials = bool(given and INITIALS_RE.match(given))
        key = self.name_key(family, given)
        if not initials and len(self.authority_names.get(key, ())) == 1:
            pid = next(iter(self.authority_names[key]))
            p = self.people[pid]
            p["nameVariants"][f"{given} {family}".strip()] += 1
            return pid
        status = "initials-only" if initials else ("name-only" if given else "single-name")
        pid = local_id("r", ("init:" if initials else "name:") + key)
        self._get(pid, f"{given} {family}".strip(), status=status)
        return pid


def split_edoc_name(name: str) -> tuple[str, str]:
    if "," in name:
        fam, given = name.split(",", 1)
        return fam.strip(), given.strip()
    parts = name.split()
    return (parts[-1], " ".join(parts[:-1])) if len(parts) > 1 else (name, "")


# ---------------------------------------------------------------- tf-idf
def build_tfidf(docs: list[list[str]]):
    df = Counter()
    for d in docs:
        df.update(set(d))
    n = len(docs)
    max_df = max(30, int(MAX_DF_RATIO * n))
    vocab = sorted(t for t, c in df.items() if c >= MIN_DF and (c <= max_df or t.startswith("c_")))
    index = {t: i for i, t in enumerate(vocab)}
    idf = np.array([math.log((1 + n) / (1 + df[t])) + 1 for t in vocab], dtype=np.float32)
    mat = np.zeros((n, len(vocab)), dtype=np.float32)
    for i, d in enumerate(docs):
        for t, c in Counter(d).items():
            j = index.get(t)
            if j is not None:
                mat[i, j] = (1 + math.log(c)) * idf[j]
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1
    mat /= norms
    return vocab, mat, df, max_df


def kmeans(x: np.ndarray, k: int, seed: int = 42, iters: int = 40) -> np.ndarray:
    """Spherical k-means with deterministic k-means++ init."""
    rng = np.random.RandomState(seed)
    n = x.shape[0]
    centers = [x[rng.randint(n)]]
    d2 = np.full(n, np.inf)
    for _ in range(1, k):
        d2 = np.minimum(d2, 1 - x @ centers[-1])
        d2 = np.clip(d2, 0, None)
        p = d2 / d2.sum() if d2.sum() > 0 else np.full(n, 1 / n)
        centers.append(x[rng.choice(n, p=p)])
    c = np.stack(centers)
    labels = np.zeros(n, dtype=int)
    for _ in range(iters):
        sims = x @ c.T
        new = sims.argmax(1)
        if np.array_equal(new, labels) and _ > 0:
            break
        labels = new
        for j in range(k):
            members = x[labels == j]
            if len(members):
                v = members.sum(0)
                c[j] = v / (np.linalg.norm(v) or 1)
    return labels


def display_term(term: str, surfaces: dict[str, Counter]) -> str:
    if term.startswith("c_"):
        return concept_label(term)
    s = surfaces.get(term)
    return s.most_common(1)[0][0] if s else term


# ---------------------------------------------------------------- main
def main() -> None:
    listing = json.loads((DATA / "raw" / "universe-listing.json").read_text("utf-8"))
    enr_path = DATA / "raw" / "edoc-enrichment.json"
    enrichment = json.loads(enr_path.read_text("utf-8")) if enr_path.exists() else {"matches": {}, "unresolved": {}}
    matches = enrichment["matches"]

    ids = Identities()
    pubs: list[dict] = []
    seen_ids = set()
    # pass 1: register all edoc authorities so name-only occurrences can join them
    for m in matches.values():
        for a in m["item"]["authors"]:
            if a.get("authority"):
                fam, given = split_edoc_name(a["name"])
                ids.register_authority(a["authority"], fam, given)

    surfaces_all: dict[str, Counter] = {}
    docs: list[list[str]] = []
    for rec in listing["records"]:
        rid = rec["sourceRecordId"]
        if rid in seen_ids:
            continue
        seen_ids.add(rid)
        pc = parse_citation(rec["bibliographyHtml"], rec["urls"])
        warnings = list(pc.warnings)
        match = matches.get(rid)
        item = match["item"] if match else None

        authors = []
        if item and item["authors"]:
            authors_source = "edoc"
            for a in item["authors"]:
                fam, given = split_edoc_name(a["name"])
                pid = ids.register_authority(a["authority"], fam, given) if a.get("authority") else ids.resolve_name(fam, given)
                authors.append({"name": f"{given} {fam}".strip(), "researcherId": pid, "role": "author"})
            authors_complete = True
            if pc.et_al:
                warnings.append("citation shows 'et al.'; full author list taken from edoc")
        else:
            authors_source = "citation"
            for a in pc.authors:
                pid = ids.resolve_name(a.family, a.given)
                authors.append({"name": a.display, "researcherId": pid, "role": "editor" if pc.editor_role else "author"})
            authors_complete = not pc.et_al and bool(pc.authors)
            if pc.et_al:
                warnings.append("author list truncated with 'et al.' — missing coauthors are not inferred")

        title = (item or {}).get("title") or pc.title or "(untitled)"
        year = pc.year if pc.year is not None else (item or {}).get("year")
        if item and item["type"]:
            ptype, type_source = EDOC_TYPE_LABELS.get(item["type"], item["type"].replace("_", " ").capitalize()), "edoc"
        else:
            ptype, type_source = pc.publication_type, "inferred from citation format"
        lang, lang_source = None, None
        if item and item.get("language"):
            lang, lang_source = LANG_ISO3.get(item["language"], item["language"]), "edoc"
        else:
            guess = detect_language(title)
            if guess:
                lang, lang_source = guess, "heuristic (title function words)"
        abstract = (item or {}).get("abstract") or None
        doi = pc.doi or (item or {}).get("doi")
        handle_url = rec["urls"].get("EDOC") or (f"https://hdl.handle.net/{item['handle']}" if item and item.get("handle") else None)
        links = {"listing": listing["listingUrl"]}
        if doi:
            links["doi"] = f"https://doi.org/{doi}"
        if handle_url:
            links["edoc"] = handle_url
        for k, v in rec["urls"].items():
            if k not in ("DOI", "EDOC") and v:
                links[k.lower()] = v
        pub = {
            "id": f"p-{rid}",
            "sourceRecordId": rid,
            "title": title,
            "year": year,
            "publicationType": ptype,
            "publicationTypeSource": type_source,
            "authors": authors,
            "authorsComplete": authors_complete,
            "authorsSource": authors_source,
            "doi": doi,
            "sourceUrl": links.get("edoc") or links.get("doi") or listing["listingUrl"],
            "links": links,
            "fetchedAt": rec["fetchedAt"],
            "rawCitation": pc.raw_text,
            "container": pc.container,
            "abstract": abstract,
            "abstractSource": "edoc" if abstract else None,
            "keywords": (item or {}).get("subjects", []),
            "language": lang,
            "languageSource": lang_source,
            "edocMatch": {"method": match["method"], "confidence": match["confidence"], "handle": item.get("handle")} if match else None,
            "facultyScope": "Listed under Faculty of Law (UNIverse org unit 47838)",
            "listPosition": rec["listPosition"],
            "parseWarnings": warnings,
        }
        pubs.append(pub)
        text = " ".join([title, title, abstract or "", " ".join(pub["keywords"])])
        toks, surf = analyse(text)
        for k, v in surf.items():
            surfaces_all.setdefault(k, Counter()).update(v)
        docs.append(toks)
        for a in authors:
            ids.people[a["researcherId"]]["publicationIds"].append(pub["id"])

    n = len(pubs)
    print(f"publications: {n}")
    vocab, mat, df, max_df = build_tfidf(docs)
    print(f"vocabulary: {len(vocab)} terms (min df {MIN_DF}, max df {max_df})")
    empty = int((np.abs(mat).sum(1) == 0).sum())

    # ---------------- topics
    k = max(3, min(MAX_TOPICS, n // 40))
    labels = kmeans(mat, k)
    global_mean = mat.mean(0)
    topics = []
    order = sorted(range(k), key=lambda j: -(labels == j).sum())
    remap = {old: new for new, old in enumerate(order)}
    labels = np.array([remap[l] for l in labels])
    for j in range(k):
        members = mat[labels == j]
        centroid = members.mean(0) if len(members) else global_mean
        distinct = centroid - global_mean
        top = np.argsort(-distinct)[:8]
        terms = [display_term(vocab[t], surfaces_all) for t in top if distinct[t] > 0]
        topics.append({"id": f"t{j}", "label": " · ".join(terms[:3]), "terms": terms,
                       "size": int(len(members))})
    for i, p in enumerate(pubs):
        p["topicId"] = f"t{labels[i]}" if np.abs(mat[i]).sum() > 0 else None

    # ---------------- publication similarity (sparse top-k)
    sim_edges = []
    pub_top_terms = []
    for i in range(n):
        row = mat[i]
        nz = np.nonzero(row)[0]
        pub_top_terms.append(set(nz.tolist()))
    chunk = 512
    for start in range(0, n, chunk):
        block = mat[start:start + chunk] @ mat.T
        for bi in range(block.shape[0]):
            i = start + bi
            block[bi, i] = 0
            cand = np.argpartition(-block[bi], min(PUB_TOP_K, n - 1))[:PUB_TOP_K] if n > 1 else []
            for j in cand:
                s = float(block[bi, j])
                if s < PUB_MIN_SIM or j == i:
                    continue
                a, b = (i, j) if i < j else (j, i)
                sim_edges.append((a, b, s))
    best: dict[tuple[int, int], float] = {}
    for a, b, s in sim_edges:
        best[(a, b)] = max(best.get((a, b), 0), s)

    def shared_terms(i: int, j: int, limit: int = 6) -> list[str]:
        common = pub_top_terms[i] & pub_top_terms[j]
        ranked = sorted(common, key=lambda t: -(mat[i, t] * mat[j, t]))
        return [display_term(vocab[t], surfaces_all) for t in ranked[:limit]]

    edges = []
    for (a, b), s in sorted(best.items()):
        edges.append({
            "source": pubs[a]["id"], "target": pubs[b]["id"], "type": "thematic-similarity",
            "score": round(s, 3), "sharedTerms": shared_terms(a, b),
            "evidencePublicationIds": [pubs[a]["id"], pubs[b]["id"]],
            "method": METHOD_VERSION, "evidenceBasis": "titles, edoc abstracts and keywords where available",
            "confidenceLabel": "derived suggestion",
        })

    # ---------------- researchers
    people = ids.people
    # drop people that ended up without publications (authority registered from unmatched duplicates)
    people = {k: v for k, v in people.items() if v["publicationIds"]}
    for p in people.values():
        p["publicationIds"] = sorted(set(p["publicationIds"]), key=lambda x: x)
        variants = p.pop("nameVariants")
        p["displayName"] = sorted(variants.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))[0][0]
        p["nameVariants"] = sorted(variants)
        if len(variants) > 1 and p["identityStatus"] == "edoc-person-record":
            p["mergeEvidence"].append("edoc authority UUID; name variants joined by exact full-name match")
    pub_index = {p["id"]: i for i, p in enumerate(pubs)}

    # coauthorship + author-of
    pair_pubs: dict[tuple[str, str], list[str]] = defaultdict(list)
    for p in pubs:
        rids = sorted({a["researcherId"] for a in p["authors"]})
        for x in range(len(rids)):
            for y in range(x + 1, len(rids)):
                pair_pubs[(rids[x], rids[y])].append(p["id"])
        for r in rids:
            edges.append({"source": r, "target": p["id"], "type": "author-of",
                          "evidencePublicationIds": [p["id"]], "method": "listed-author",
                          "evidenceBasis": f"author list ({p['authorsSource']})", "confidenceLabel": "observed"})
    for (a, b), plist in sorted(pair_pubs.items()):
        edges.append({"source": a, "target": b, "type": "coauthorship", "weight": len(plist),
                      "evidencePublicationIds": plist, "method": "shared-publication-record",
                      "evidenceBasis": "both appear in the author list of the cited publication(s)",
                      "confidenceLabel": "observed"})
    coauthors = {k for k in pair_pubs}

    # researcher thematic profiles — mean of publication vectors, then L2-normalised,
    # so volume does not increase a profile's weight
    eligible = [r for r, p in people.items()
                if len(p["publicationIds"]) >= RES_MIN_PUBS and p["identityStatus"] in ("edoc-person-record", "name-only")]
    eligible.sort()
    prof = np.zeros((len(eligible), mat.shape[1]), dtype=np.float32)
    for i, r in enumerate(eligible):
        rows = [pub_index[x] for x in people[r]["publicationIds"]]
        v = mat[rows].mean(0)
        prof[i] = v / (np.linalg.norm(v) or 1)
    suggestions = []
    if len(eligible) > 1:
        rs = prof @ prof.T
        np.fill_diagonal(rs, 0)
        seen_pairs = set()
        for i, r in enumerate(eligible):
            for j in np.argsort(-rs[i])[: RES_TOP_K * 3]:
                s = float(rs[i, j])
                if s < RES_MIN_SIM:
                    break
                a, b = sorted((r, eligible[j]))
                if (a, b) in seen_pairs or (a, b) in coauthors:
                    continue
                pa = [pub_index[x] for x in people[a]["publicationIds"]]
                pb = [pub_index[x] for x in people[b]["publicationIds"]]
                # only pubs that are not jointly authored
                pa_only = [x for x in pa if x not in set(pb)]
                pb_only = [x for x in pb if x not in set(pa)]
                if not pa_only or not pb_only:
                    continue
                cross = mat[pa_only] @ mat[pb_only].T
                flat = np.argsort(-cross, axis=None)
                evidence, used_a, used_b = [], set(), set()
                for f in flat[:40]:
                    ia, ib = divmod(int(f), cross.shape[1])
                    score = float(cross[ia, ib])
                    if score < EVIDENCE_MIN_SIM:
                        break
                    if ia in used_a or ib in used_b:
                        continue
                    terms = shared_terms(pa_only[ia], pb_only[ib], 5)
                    if len(terms) < 2:
                        continue
                    used_a.add(ia); used_b.add(ib)
                    evidence.append({"publicationA": pubs[pa_only[ia]]["id"], "publicationB": pubs[pb_only[ib]]["id"],
                                     "score": round(score, 3), "sharedTerms": terms})
                    if len(evidence) == 3:
                        break
                if not evidence:
                    continue
                seen_pairs.add((a, b))
                contrib = prof[eligible.index(a)] * prof[eligible.index(b)]
                top_terms = [display_term(vocab[t], surfaces_all) for t in np.argsort(-contrib)[:6] if contrib[t] > 0]
                suggestions.append({
                    "id": f"s-{a}-{b}", "researcherA": a, "researcherB": b, "score": round(s, 3),
                    "sharedTerms": top_terms, "evidence": evidence, "type": "thematic-similarity",
                    "method": METHOD_VERSION, "confidenceLabel": "derived suggestion",
                    "absenceNote": "No joint publication in this snapshot.",
                    "question": (f"Suggested conversation starter: how do your approaches to "
                                 f"{top_terms[0]}{' and ' + top_terms[1] if len(top_terms) > 1 else ''} compare?"),
                })
    # keep top-k per researcher
    per = Counter()
    kept = []
    for sgg in sorted(suggestions, key=lambda x: -x["score"]):
        if per[sgg["researcherA"]] >= RES_TOP_K and per[sgg["researcherB"]] >= RES_TOP_K:
            continue
        per[sgg["researcherA"]] += 1
        per[sgg["researcherB"]] += 1
        kept.append(sgg)
    suggestions = kept
    print(f"researchers: {len(people)}, eligible for suggestions: {len(eligible)}, suggestions: {len(suggestions)}")

    # dangling check
    pub_ids = {p["id"] for p in pubs}
    for e in edges:
        for end in (e["source"], e["target"]):
            assert end in pub_ids or end in people, f"dangling edge end {end}"

    # ---------------- outputs
    snapshot = max(r["fetchedAt"] for r in listing["records"])[:10] if listing["records"] else None
    years = [p["year"] for p in pubs if p["year"]]
    meta = {
        "title": "Uni Constellation — Faculty of Law public-data pilot",
        "snapshotDate": snapshot,
        "publicationCount": n,
        "researcherCount": len(people),
        "methodVersion": METHOD_VERSION,
        "parameters": {"pubTopK": PUB_TOP_K, "pubMinSim": PUB_MIN_SIM, "minDf": MIN_DF, "maxDf": max_df,
                       "researcherMinPubs": RES_MIN_PUBS, "researcherTopK": RES_TOP_K, "researcherMinSim": RES_MIN_SIM,
                       "evidenceMinSim": EVIDENCE_MIN_SIM, "topics": k},
        "notes": [
            "Thematic similarity is TF-IDF keyword overlap on titles (+ abstracts/keywords when edoc provides them); it is a suggestion, not a collaboration.",
            "Coauthorship means both names appear on the same publication record in this snapshot.",
            "Map positions are a force layout for readability, not calibrated distances.",
        ],
    }
    for p in pubs:
        p.pop("listPosition", None)
    researchers = sorted(people.values(), key=lambda p: p["id"])
    graph = {"meta": meta, "topics": topics,
             "concepts": {cid: lab for cid, (lab, _rx) in CONCEPTS.items()},
             "edges": edges, "suggestions": suggestions}

    abstracts = sum(1 for p in pubs if p["abstract"])
    coverage = {
        "sources": [
            {"name": listing["source"], "url": listing["listingUrl"], "endpoint": listing["endpoint"]},
            {"name": enrichment.get("source", "edoc"), "url": "https://edoc.unibas.ch", "endpoint": enrichment.get("endpoint")},
        ],
        "retrievalStarted": listing.get("crawlStartedAt"),
        "snapshotDate": snapshot,
        "sourceReportedTotal": listing["reportedTotal"],
        "maxRecordsRequested": listing["maxRecords"],
        "pagesFetched": len([p for p in listing["pages"] if "error" not in p]),
        "pagesFailed": len([p for p in listing["pages"] if "error" in p]),
        "fetched": sum(p.get("returned", 0) for p in listing["pages"]),
        "unique": n,
        "duplicatesSkipped": listing["duplicatesSkipped"],
        "stopReason": listing["stopReason"],
        "samplingRule": "UNIverse listing order (newest first as displayed), first N unique records",
        "yearRange": [min(years), max(years)] if years else None,
        "publicationsWithoutYear": n - len(years),
        "byYear": dict(sorted(Counter(p["year"] for p in pubs if p["year"]).items())),
        "byType": dict(Counter(p["publicationType"] for p in pubs).most_common()),
        "typeSource": dict(Counter(p["publicationTypeSource"] for p in pubs)),
        "abstractCoverage": {"withAbstract": abstracts, "share": round(abstracts / n, 3) if n else 0},
        "edoc": {
            "matched": len(matches), "byMethod": dict(Counter(m["method"] for m in matches.values())),
            "unresolved": len(enrichment.get("unresolved", {})),
            "unresolvedReasons": dict(Counter(enrichment.get("unresolved", {}).values()).most_common()),
            "requestsUsed": enrichment.get("requestsUsed"), "requestCap": enrichment.get("requestCap"),
            "capReached": enrichment.get("capReached"),
        },
        "incompleteAuthorLists": sum(1 for p in pubs if not p["authorsComplete"]),
        "publicationsWithParseWarnings": sum(1 for p in pubs if p["parseWarnings"]),
        "publicationsWithoutTopicTerms": empty,
        "identities": dict(Counter(p["identityStatus"] for p in researchers)),
        "unresolvedIdentities": sum(1 for p in researchers if p["identityStatus"] != "edoc-person-record"),
        "edges": dict(Counter(e["type"] for e in edges)),
        "suggestions": len(suggestions),
        "knownExclusions": [
            "Only the Faculty of Law org-unit listing (47838); other faculties are out of scope.",
            "No full texts, reference lists or citation links were collected.",
            "No ORCID enrichment in this slice.",
            "Records not found in edoc have only citation-derived authors, types and no abstracts.",
            "Author lists shortened with 'et al.' are incomplete unless edoc provides the full list.",
        ],
    }
    write = lambda name, obj: (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")
    write("publications.json", pubs)
    write("researchers.json", researchers)
    write("graph.json", graph)
    (DATA / "coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2), "utf-8")
    # layout input: compact, consumed by scripts/layout.mjs which writes data/layout.json
    sim_by_pub = [[pub_index[e["source"]], pub_index[e["target"]], e["score"]] for e in edges if e["type"] == "thematic-similarity"]
    res_ids = sorted(people)
    res_index = {r: i for i, r in enumerate(res_ids)}
    co = [[res_index[e["source"]], res_index[e["target"]], e["weight"]] for e in edges if e["type"] == "coauthorship"]
    topic_sim = []
    cents = []
    for j in range(k):
        m_ = mat[labels == j]
        v = m_.mean(0) if len(m_) else global_mean
        cents.append(v / (np.linalg.norm(v) or 1))
    cents = np.stack(cents)
    tsim = (cents @ cents.T).round(3).tolist()
    (ROOT / ".cache" / "layout-input.json").write_text(json.dumps({
        "publications": [p["id"] for p in pubs], "topicOf": [int(labels[i]) if pubs[i]["topicId"] else -1 for i in range(n)],
        "similarity": sim_by_pub, "topicSimilarity": tsim,
        "researchers": res_ids, "coauthorship": co,
        "researcherTopic": [Counter(pubs[pub_index[x]]["topicId"] for x in people[r]["publicationIds"]).most_common(1)[0][0] or "" for r in res_ids],
    }), "utf-8")
    print("coverage:", json.dumps({k: coverage[k] for k in ("unique", "sourceReportedTotal", "edges", "suggestions")}))


if __name__ == "__main__":
    main()
