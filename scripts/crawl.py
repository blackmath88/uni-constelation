#!/usr/bin/env python3
"""Bounded, resumable collection of one approved faculty publication listing.

  python3 scripts/crawl.py --max-records 700          # README pilot bound
  python3 scripts/crawl.py --max-records 8000         # whole listing (~7.8k)
  python3 scripts/crawl.py --offline                  # rebuild raw files from cache only

Responses are cached in .cache/http (gitignored); re-running reuses the cache,
so an interrupted crawl resumes without re-requesting finished pages.
Writes faculty-scoped files so one crawl can never overwrite the other faculty.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from unicon.citation import parse_citation  # noqa: E402
from unicon.http import PoliteClient  # noqa: E402
from unicon.sources import edoc, universe  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FACULTY_OF_LAW = "47838"
FACULTY_OF_ECONOMICS = "47827"
FACULTY_KEYS = {FACULTY_OF_LAW: "law", FACULTY_OF_ECONOMICS: "economics"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--org-unit", default=FACULTY_OF_LAW)
    ap.add_argument("--max-records", type=int, default=700)
    ap.add_argument("--page-size", type=int, default=500, choices=[100, 200, 500])
    ap.add_argument("--max-edoc-requests", type=int, default=450)
    ap.add_argument("--skip-edoc", action="store_true")
    ap.add_argument("--offline", action="store_true", help="use cached responses only")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between requests")
    args = ap.parse_args()

    if args.org_unit not in FACULTY_KEYS:
        ap.error(f"org unit must be one of the approved faculties: {', '.join(FACULTY_KEYS)}")
    faculty_key = FACULTY_KEYS[args.org_unit]

    client = PoliteClient(ROOT / ".cache" / "http", min_interval=args.interval, offline=args.offline)
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"UNIverse org unit {args.org_unit}: collecting up to {args.max_records} records")
    listing = universe.collect(client, args.org_unit, args.max_records, args.page_size)
    listing["crawlStartedAt"] = started
    raw_dir = ROOT / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    listing["facultyKey"] = faculty_key
    (raw_dir / f"universe-listing-{faculty_key}.json").write_text(json.dumps(listing, ensure_ascii=False, indent=1), "utf-8")
    print(f"  {len(listing['records'])} unique records; stop: {listing['stopReason']}")

    if not args.skip_edoc:
        recs = []
        for r in listing["records"]:
            pc = parse_citation(r["bibliographyHtml"], r["urls"])
            recs.append({
                "sourceRecordId": r["sourceRecordId"],
                "handle": edoc.handle_of(r["urls"]),
                "doi": pc.doi,
                "title": pc.title,
                "year": pc.year,
                "families": [a.family for a in pc.authors],
            })
        print(f"edoc enrichment (cap {args.max_edoc_requests} requests)")
        enr = edoc.enrich(client, recs, args.max_edoc_requests)
        enr["fetchedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        enr["facultyKey"] = faculty_key
        (raw_dir / f"edoc-enrichment-{faculty_key}.json").write_text(json.dumps(enr, ensure_ascii=False, indent=1), "utf-8")
        print(f"  matched {len(enr['matches'])}, unresolved {len(enr['unresolved'])}, requests {enr['requestsUsed']}")
    print("http stats:", client.stats)


if __name__ == "__main__":
    main()
