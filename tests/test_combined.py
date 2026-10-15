import json
import tempfile
import unittest
from pathlib import Path

from scripts.unicon.combined import load_and_combine


class CombinedSourcesTest(unittest.TestCase):
    def test_shared_universe_id_is_one_publication_with_both_memberships(self):
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "raw"
            raw.mkdir()
            common = {"source": "test", "endpoint": "https://example/api", "reportedTotal": 2,
                      "maxRecords": 2, "pages": [], "duplicatesSkipped": 0, "stopReason": "source-reported total reached"}
            for key, org, ids in (("law", "47838", ["shared", "law-only"]),
                                  ("economics", "47827", ["shared", "econ-only"])):
                listing = {**common, "orgUnitId": org, "listingUrl": f"https://example/{org}",
                           "records": [{"sourceRecordId": rid, "listPosition": i, "bibliographyHtml": rid,
                                        "urls": {}, "fetchedAt": "2026-10-15T00:00:00Z"} for i, rid in enumerate(ids)]}
                (raw / f"universe-listing-{key}.json").write_text(json.dumps(listing))
                (raw / f"edoc-enrichment-{key}.json").write_text(json.dumps({"matches": {}, "unresolved": {}}))
            listing, _enrichment, report = load_and_combine(Path(td))
            self.assertEqual(len(listing["records"]), 3)
            shared = next(r for r in listing["records"] if r["sourceRecordId"] == "shared")
            self.assertEqual(shared["facultyMemberships"], ["economics", "law"])
            self.assertEqual({r["orgUnitId"] for r in shared["sourceRecords"]}, {"47827", "47838"})
            self.assertEqual(report["missingSources"], [])

    def test_missing_source_is_explicit(self):
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "raw"
            raw.mkdir()
            listing = {"source": "test", "endpoint": "x", "orgUnitId": "47838", "listingUrl": "x",
                       "reportedTotal": 0, "maxRecords": 1, "pages": [], "duplicatesSkipped": 0,
                       "stopReason": "empty page", "records": []}
            (raw / "universe-listing-law.json").write_text(json.dumps(listing))
            _listing, _enrichment, report = load_and_combine(Path(td))
            self.assertEqual(report["missingSources"], ["economics"])


if __name__ == "__main__":
    unittest.main()
