"""UNIverse public research portal — org-unit publication listing.

Observed (2026-10-15, anonymous): the public listing page at
https://universe.unibas.ch/org-units/<id>/publications is an Angular app that
calls POST {API}/public/prp/orgUnits/publications with
{"orgUnitId": <id>, "paginationRequest": {"page": <0-based>, "size": <n>}}.
The response holds {data: [{id, bibliography (CSL HTML), urls{}}], pagination
{page, pageSize, total}}. The UI offers page sizes 100/200/500; we use 500.

We never assume a page parameter works: each page's IDs are compared with the
IDs already seen, and collection stops on an empty page, on a page with no new
IDs (repeated page), or when the record cap is reached.
"""
from __future__ import annotations

import time

from ..http import PoliteClient

API = "https://universe-intern.unibas.ch/api"
LISTING_URL = "https://universe.unibas.ch/org-units/{org}/publications"
ENDPOINT = API + "/public/prp/orgUnits/publications"
HEADERS = {"Origin": "https://universe.unibas.ch", "Referer": "https://universe.unibas.ch/"}


def collect(client: PoliteClient, org_unit_id: str, max_records: int, page_size: int = 500,
            log=print) -> dict:
    seen: dict[int, dict] = {}
    pages = []
    reported_total = None
    duplicates = 0
    page = 0
    stop_reason = "max_records reached"
    while len(seen) < max_records:
        payload = {"orgUnitId": str(org_unit_id), "paginationRequest": {"page": page, "size": page_size}}
        try:
            resp = client.request_json("POST", ENDPOINT, payload, headers=HEADERS)
        except Exception as exc:  # noqa: BLE001 - record and stop; resume will retry
            pages.append({"page": page, "error": str(exc)})
            stop_reason = f"request failed on page {page}: {exc}"
            break
        fetched_at = client.last_fetched_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        data = resp.get("data") or []
        pag = resp.get("pagination") or {}
        reported_total = pag.get("total", reported_total)
        new = 0
        for pos, rec in enumerate(data):
            rid = rec.get("id")
            if rid is None:
                continue
            if rid in seen:
                duplicates += 1
                continue
            if len(seen) >= max_records:
                break
            seen[rid] = {
                "sourceRecordId": str(rid),
                "listPosition": page * page_size + pos,
                "bibliographyHtml": rec.get("bibliography") or "",
                "urls": rec.get("urls") or {},
                "fetchedAt": fetched_at,
            }
            new += 1
        pages.append({"page": page, "size": page_size, "returned": len(data), "new": new,
                      "reportedPage": pag.get("page"), "reportedTotal": pag.get("total")})
        log(f"  universe page {page}: {len(data)} returned, {new} new, total seen {len(seen)}")
        if not data:
            stop_reason = "empty page (results exhausted)"
            break
        if new == 0:
            stop_reason = "repeated page (no new IDs)"
            break
        if reported_total is not None and len(seen) >= reported_total:
            stop_reason = "source-reported total reached"
            break
        page += 1
    return {
        "source": "UNIverse public org-unit publication listing",
        "listingUrl": LISTING_URL.format(org=org_unit_id),
        "endpoint": ENDPOINT,
        "orgUnitId": str(org_unit_id),
        "reportedTotal": reported_total,
        "maxRecords": max_records,
        "pageSize": page_size,
        "pages": pages,
        "duplicatesSkipped": duplicates,
        "stopReason": stop_reason,
        "records": sorted(seen.values(), key=lambda r: r["listPosition"]),
    }
