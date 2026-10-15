"""Combine the two approved faculty snapshots without losing provenance."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

FACULTIES = {
    "law": {"orgUnitId": "47838", "label": "Law"},
    "economics": {"orgUnitId": "47827", "label": "Business and Economics"},
}


def load_and_combine(data_dir: Path) -> tuple[dict, dict, dict]:
    listings = []
    enrichments = []
    missing = []
    for key, meta in FACULTIES.items():
        lp = data_dir / "raw" / f"universe-listing-{key}.json"
        ep = data_dir / "raw" / f"edoc-enrichment-{key}.json"
        if not lp.exists():
            missing.append(key)
            continue
        listing = json.loads(lp.read_text("utf-8"))
        listing["facultyKey"] = key
        listing["facultyLabel"] = meta["label"]
        listings.append(listing)
        if ep.exists():
            enrichment = json.loads(ep.read_text("utf-8"))
            enrichment["facultyKey"] = key
            enrichments.append(enrichment)

    if not listings:
        raise FileNotFoundError("no faculty-scoped raw listings found")

    records: dict[str, dict] = {}
    record_conflicts = []
    for listing in listings:
        key = listing["facultyKey"]
        for rec in listing["records"]:
            rid = rec["sourceRecordId"]
            if rid not in records:
                records[rid] = {**rec, "facultyMemberships": [key], "sourceRecords": []}
            elif any(records[rid].get(f) != rec.get(f) for f in ("bibliographyHtml", "urls")):
                record_conflicts.append({"sourceRecordId": rid, "faculty": key,
                                         "reason": "same UNIverse ID has differing citation or URLs"})
            records[rid]["facultyMemberships"] = sorted(set(records[rid]["facultyMemberships"] + [key]))
            records[rid]["sourceRecords"].append({
                "faculty": key, "orgUnitId": listing["orgUnitId"], "listingUrl": listing["listingUrl"],
                "listPosition": rec["listPosition"], "fetchedAt": rec["fetchedAt"],
            })

    matches: dict[str, dict] = {}
    unresolved: dict[str, str] = {}
    enrichment_conflicts = []
    for enr in enrichments:
        for rid, match in enr.get("matches", {}).items():
            if rid in matches and matches[rid] != match:
                enrichment_conflicts.append({"sourceRecordId": rid, "faculty": enr["facultyKey"],
                                             "reason": "different edoc enrichment for shared UNIverse ID"})
            else:
                matches[rid] = match
        unresolved.update({rid: reason for rid, reason in enr.get("unresolved", {}).items() if rid not in matches})

    # DOI/handle collisions are reported, never silently merged.
    identifiers: dict[tuple[str, str], list[str]] = defaultdict(list)
    for rid, match in matches.items():
        item = match.get("item", {})
        for kind in ("doi", "handle"):
            if item.get(kind):
                identifiers[(kind, item[kind].lower())].append(rid)
    identifier_conflicts = [
        {"kind": kind, "value": value, "sourceRecordIds": sorted(set(ids))}
        for (kind, value), ids in identifiers.items() if len(set(ids)) > 1
    ]

    combined_listing = {
        "source": "Combined approved UNIverse faculty listings",
        "listingUrl": listings[0]["listingUrl"],
        "endpoint": listings[0]["endpoint"],
        "orgUnitId": "+".join(x["orgUnitId"] for x in listings),
        "records": sorted(records.values(), key=lambda r: (min(x["listPosition"] for x in r["sourceRecords"]), r["sourceRecordId"])),
        "sources": listings,
        "crawlStartedAt": min((x.get("crawlStartedAt") or "") for x in listings),
        "reportedTotal": sum((x.get("reportedTotal") or 0) for x in listings),
        "maxRecords": sum((x.get("maxRecords") or 0) for x in listings),
        "pages": [p for x in listings for p in x.get("pages", [])],
        "duplicatesSkipped": sum(x.get("duplicatesSkipped", 0) for x in listings),
        "stopReason": "; ".join(f"{x['facultyKey']}: {x.get('stopReason')}" for x in listings),
    }
    combined_enrichment = {"source": "Combined edoc enrichment", "matches": matches, "unresolved": unresolved,
                           "sources": enrichments}
    report = {"missingSources": missing, "recordConflicts": record_conflicts,
              "enrichmentConflicts": enrichment_conflicts, "identifierConflicts": identifier_conflicts}
    return combined_listing, combined_enrichment, report
