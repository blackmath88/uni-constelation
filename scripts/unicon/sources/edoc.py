"""edoc (University of Basel repository, DSpace 7.6.2) enrichment adapter.

Verified anonymously: GET https://edoc.unibas.ch/server/api/discover/search/objects
accepts Solr-style queries such as handle:("a" OR "b"), dc.identifier.doi:(...) and
title:("..."). We batch identifiers into single queries to stay far below the
request cap. Matching tiers, strongest first:

  1. handle   — the UNIverse record links an EDOC handle            → confidence "high"
  2. doi      — same DOI (case-insensitive)                          → confidence "high"
  3. title    — identical folded title AND same year AND ≥1 shared   → confidence "medium"
                author family name; titles under 5 words are skipped
                (too generic, e.g. "Einleitung")

Anything weaker is recorded as unresolved, never used.
"""
from __future__ import annotations

import re

from ..citation import fold
from ..http import PoliteClient, qs

SEARCH = "https://edoc.unibas.ch/server/api/discover/search/objects"
PAGE_SIZE = 100


def _first(md: dict, key: str):
    v = md.get(key) or []
    return v[0]["value"] if v else None


def extract_item(item: dict) -> dict:
    md = item.get("metadata", {})
    year = None
    issued = _first(md, "dc.date.issued")
    if issued and re.match(r"\d{4}", issued):
        year = int(issued[:4])
    return {
        "uuid": item.get("uuid"),
        "handle": item.get("handle"),
        "title": _first(md, "dc.title"),
        "year": year,
        "type": _first(md, "dc.type"),
        "authors": [
            {"name": a["value"], "authority": a.get("authority") if (a.get("confidence") or 0) >= 500 else None}
            for a in md.get("dc.contributor.author", [])
        ],
        "editors": [a["value"] for a in md.get("dc.contributor.editor", [])],
        "abstract": _first(md, "dc.description.abstract"),
        "language": _first(md, "dc.language.iso"),
        "subjects": [s["value"] for s in md.get("dc.subject", [])],
        "doi": (_first(md, "dc.identifier.doi") or "").lower() or None,
        "journal": _first(md, "dc.relation.journal"),
        "orgUnits": [s["value"] for s in md.get("dc.relation.orgunit", [])],
    }


def _search(client: PoliteClient, query: str, budget: dict) -> list[dict]:
    if budget["used"] >= budget["max"]:
        raise BudgetExhausted
    url = qs(SEARCH, {"query": query, "dsoType": "ITEM", "size": PAGE_SIZE})
    resp = client.request_json("GET", url)
    budget["used"] += 1  # logical requests (network or cache) so the cap means the same on a resumed run
    sr = resp.get("_embedded", {}).get("searchResult", {})
    objs = sr.get("_embedded", {}).get("objects", [])
    return [o["_embedded"]["indexableObject"] for o in objs if o.get("_embedded")]


class BudgetExhausted(Exception):
    pass


def _quote(s: str) -> str:
    return '"' + re.sub(r'["\\]', " ", s).strip() + '"'


def handle_of(urls: dict) -> str | None:
    u = urls.get("EDOC") or ""
    m = re.search(r"(20\.500\.14716/\d+)", u)
    return m.group(1) if m else None


def enrich(client: PoliteClient, records: list[dict], max_requests: int, log=print) -> dict:
    """records: [{sourceRecordId, handle, doi, title, year, families[]}]"""
    budget = {"used": 0, "max": max_requests}
    matches: dict[str, dict] = {}
    unresolved: dict[str, str] = {}
    exhausted = False

    def batches(items, n):
        for i in range(0, len(items), n):
            yield items[i:i + n]

    # Tier 1 — handles
    by_handle: dict[str, list[str]] = {}
    for r in records:
        if r.get("handle"):
            by_handle.setdefault(r["handle"], []).append(r["sourceRecordId"])
    handles = sorted(by_handle)
    try:
        for i, chunk in enumerate(batches(handles, 40)):
            items = _search(client, "handle:(" + " OR ".join(_quote(h) for h in chunk) + ")", budget)
            for it in items:
                for rid in by_handle.get(it.get("handle"), []):
                    matches[rid] = {"method": "handle", "confidence": "high", "item": extract_item(it)}
            log(f"  edoc handles batch {i}: {len(items)} items, matched {len(matches)}")
    except BudgetExhausted:
        exhausted = True

    # Tier 2 — DOIs
    by_doi: dict[str, list[str]] = {}
    for r in records:
        if r["sourceRecordId"] not in matches and r.get("doi"):
            by_doi.setdefault(r["doi"].lower(), []).append(r["sourceRecordId"])
    dois = sorted(by_doi)
    if not exhausted:
        try:
            for i, chunk in enumerate(batches(dois, 30)):
                items = _search(client, "dc.identifier.doi:(" + " OR ".join(_quote(d) for d in chunk) + ")", budget)
                for it in items:
                    ex = extract_item(it)
                    for rid in by_doi.get(ex["doi"] or "", []):
                        matches.setdefault(rid, {"method": "doi", "confidence": "high", "item": ex})
                log(f"  edoc doi batch {i}: {len(items)} items, matched {len(matches)}")
        except BudgetExhausted:
            exhausted = True

    # Tier 3 — conservative title + year + author family
    pending = [r for r in records if r["sourceRecordId"] not in matches]
    titled = []
    for r in pending:
        t = r.get("title") or ""
        if len(fold(t).split()) < 5:
            unresolved[r["sourceRecordId"]] = "title too short/generic for title matching"
        elif r.get("year") is None:
            unresolved[r["sourceRecordId"]] = "no year for title matching"
        else:
            titled.append(r)
    if not exhausted:
        try:
            for i, chunk in enumerate(batches(titled, 12)):
                items = _search(client, "title:(" + " OR ".join(_quote(r["title"]) for r in chunk) + ")", budget)
                extracted = [extract_item(it) for it in items]
                for r in chunk:
                    ft = fold(r["title"])
                    fams = {fold(f) for f in r.get("families", []) if f}
                    found = None
                    for ex in extracted:
                        if not ex["title"] or fold(ex["title"]) != ft:
                            continue
                        if ex["year"] != r["year"]:
                            unresolved[r["sourceRecordId"]] = f"title match but year differs ({ex['year']})"
                            continue
                        ex_fams = {fold(a["name"].split(",")[0]) for a in ex["authors"]}
                        if fams & ex_fams:
                            found = ex
                            break
                        unresolved[r["sourceRecordId"]] = "title+year match without shared author family name"
                    if found:
                        matches[r["sourceRecordId"]] = {"method": "title+year+author", "confidence": "medium",
                                                       "item": found}
                        unresolved.pop(r["sourceRecordId"], None)
                    else:
                        unresolved.setdefault(r["sourceRecordId"], "no edoc candidate found")
                if i % 20 == 0:
                    log(f"  edoc title batch {i}: matched {len(matches)}")
        except BudgetExhausted:
            exhausted = True
    for r in records:
        if r["sourceRecordId"] not in matches:
            unresolved.setdefault(r["sourceRecordId"], "not attempted (request cap reached)" if exhausted else "no match")
    return {
        "source": "edoc.unibas.ch DSpace discovery search",
        "endpoint": SEARCH,
        "requestsUsed": budget["used"],
        "requestsCountedAs": "logical requests including cache hits",
        "requestCap": max_requests,
        "capReached": exhausted,
        "matches": matches,
        "unresolved": unresolved,
    }
