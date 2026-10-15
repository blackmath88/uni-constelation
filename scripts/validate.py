#!/usr/bin/env python3
"""Validate the committed data contract: IDs, references, evidence, no dangling links."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def main() -> int:
    pubs = json.loads((DATA / "publications.json").read_text("utf-8"))
    details = json.loads((DATA / "publication-details.json").read_text("utf-8"))
    if set(details) != {p["id"] for p in pubs}:
        err("publication detail IDs do not exactly match overview IDs")
    pubs = [{**p, **details.get(p["id"], {})} for p in pubs]
    res = json.loads((DATA / "researchers.json").read_text("utf-8"))
    graph = json.loads((DATA / "graph.json").read_text("utf-8"))
    layout = json.loads((DATA / "layout.json").read_text("utf-8"))
    coverage = json.loads((DATA / "coverage.json").read_text("utf-8"))

    pub_ids = [p["id"] for p in pubs]
    res_ids = [r["id"] for r in res]
    for name, ids in (("publication", pub_ids), ("researcher", res_ids)):
        dup = [k for k, c in Counter(ids).items() if c > 1]
        if dup:
            err(f"duplicate {name} ids: {dup[:5]}")
    src_dup = [k for k, c in Counter(p["sourceRecordId"] for p in pubs).items() if c > 1]
    if src_dup:
        err(f"duplicate source records: {src_dup[:5]}")
    P, R = set(pub_ids), set(res_ids)
    topics = {t["id"] for t in graph["topics"]}

    required = ["id", "sourceRecordId", "title", "year", "publicationType", "authors", "authorsComplete", "doi",
                "sourceUrl", "fetchedAt", "rawCitation", "abstract", "abstractSource", "language", "facultyScope",
                "parseWarnings"]
    for p in pubs:
        for f in required:
            if f not in p:
                err(f"{p['id']} missing field {f}")
        for a in p["authors"]:
            if a["researcherId"] not in R:
                err(f"{p['id']} author {a['name']} -> unknown researcher {a['researcherId']}")
        if p.get("topicId") and p["topicId"] not in topics:
            err(f"{p['id']} unknown topic {p['topicId']}")
        if p["abstract"] and p["abstractSource"] != "edoc":
            err(f"{p['id']} abstract without edoc source")
        if p["doi"] and not re.match(r"^10\.\d{4,9}/\S+$", p["doi"]):
            err(f"{p['id']} malformed DOI {p['doi']}")
        if p["id"] not in layout["publications"]:
            err(f"{p['id']} has no layout position")
    pub_authors = {p["id"]: {a["researcherId"] for a in p["authors"]} for p in pubs}
    for r in res:
        for pid in r["publicationIds"]:
            if pid not in P:
                err(f"{r['id']} -> unknown publication {pid}")
            elif r["id"] not in pub_authors[pid]:
                err(f"{r['id']} lists {pid} but is not among its authors")
        if r["orcid"] is not None and not re.match(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$", r["orcid"]):
            err(f"{r['id']} invalid ORCID")
        if r["sourcePersonId"] and not r["sourcePersonId"].startswith("edoc-authority:"):
            err(f"{r['id']} unexpected sourcePersonId")
        if not r["id"].startswith("r-"):
            err(f"{r['id']} researcher id is not a local id")
    for e in graph["edges"]:
        for end in (e["source"], e["target"]):
            if end not in P and end not in R:
                err(f"dangling edge end {end} ({e['type']})")
        if not e.get("evidencePublicationIds"):
            err(f"edge without evidence: {e['type']} {e['source']} {e['target']}")
        for pid in e["evidencePublicationIds"]:
            if pid not in P:
                err(f"edge evidence unknown publication {pid}")
        if e["type"] == "coauthorship":
            for pid in e["evidencePublicationIds"]:
                if not {e["source"], e["target"]} <= pub_authors[pid]:
                    err(f"coauthorship {e['source']}–{e['target']} not supported by {pid}")
        if e["type"] not in graph["edgeTypes"]:
            err(f"unknown edge type {e['type']}")
        if e["type"] == "thematic-similarity" and len(e["evidencePublicationIds"]) != 2:
            err("similarity edge must cite exactly its two publications")
    et = graph["edgeTypes"]
    if et["coauthorship"]["confidenceLabel"] != "observed" or et["author-of"]["confidenceLabel"] != "observed":
        err("observed relationships must be labelled observed")
    if et["thematic-similarity"]["confidenceLabel"] != "derived suggestion":
        err("similarity must be labelled derived suggestion")
    coauth = {tuple(sorted((e["source"], e["target"]))) for e in graph["edges"] if e["type"] == "coauthorship"}
    for s in graph["suggestions"]:
        a, b = s["researcherA"], s["researcherB"]
        if a not in R or b not in R:
            err(f"suggestion {s['id']} unknown researcher")
            continue
        if tuple(sorted((a, b))) in coauth:
            err(f"suggestion {s['id']} pairs existing coauthors")
        if not s["evidence"]:
            err(f"suggestion {s['id']} has no evidence")
        res_by = {r["id"]: r for r in res}
        for ev in s["evidence"]:
            if ev["publicationA"] not in res_by[a]["publicationIds"] or ev["publicationB"] not in res_by[b]["publicationIds"]:
                err(f"suggestion {s['id']} evidence not authored by the pair")
            if len(ev["sharedTerms"]) < 2:
                err(f"suggestion {s['id']} evidence has fewer than two shared terms")
        if "No joint publication in this snapshot" not in s["absenceNote"]:
            err(f"suggestion {s['id']} absence note wording")
        if s.get("question") and not s["question"].lower().startswith("a question to investigate"):
            err(f"suggestion {s['id']} question not framed as an investigation")
        for ev in s["evidence"]:
            fa = next(p["facultyMemberships"] for p in pubs if p["id"] == ev["publicationA"])
            fb = next(p["facultyMemberships"] for p in pubs if p["id"] == ev["publicationB"])
            if not ((fa == ["law"] and fb == ["economics"]) or (fa == ["economics"] and fb == ["law"])):
                err(f"suggestion {s['id']} is not supported by exclusive cross-faculty records")
    if coverage["unique"] != len(pubs):
        err("coverage unique count does not match publications.json")
    if len(layout["topics"]) != len(graph["topics"]):
        err("layout topic count mismatch")
    semantic_path = DATA / "semantic-neighbors.json"
    if semantic_path.exists():
        semantic = json.loads(semantic_path.read_text("utf-8"))
        if semantic.get("revision") != "e8f8c211226b894fcb81acc59f3b34ba3efd5f42":
            err("unexpected semantic model revision")
        pub_by = {p["id"]: p for p in pubs}
        per_law = Counter()
        for pair in semantic.get("pairs", []):
            a, b = pair["publicationA"], pair["publicationB"]
            if a not in P or b not in P:
                err("semantic neighbour cites unknown publication")
                continue
            if pub_by[a]["facultyMemberships"] != ["law"] or pub_by[b]["facultyMemberships"] != ["economics"]:
                err("semantic neighbour is not exclusive Law to Economics")
            per_law[a] += 1
        if per_law and max(per_law.values()) > semantic["parameters"]["topKAcrossFaculty"]:
            err("semantic neighbour list exceeds configured top-k")

    print(f"validated {len(pubs)} publications, {len(res)} researchers, {len(graph['edges'])} edges, "
          f"{len(graph['suggestions'])} suggestions")
    if errors:
        print(f"{len(errors)} problem(s):")
        for e in errors[:40]:
            print("  -", e)
        return 1
    print("OK: no dangling references; all relationships carry evidence")
    return 0


if __name__ == "__main__":
    sys.exit(main())
