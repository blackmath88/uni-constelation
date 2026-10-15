import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from unicon.citation import fold, parse_citation  # noqa: E402
from build_graph import Identities  # noqa: E402

FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "citations.json").read_text("utf-8"))


class CitationFixtures(unittest.TestCase):
    def test_fixtures(self):
        for fx in FIXTURES:
            with self.subTest(fx["name"]):
                pc = parse_citation(fx["html"], fx["urls"])
                exp = fx["expect"]
                if "year" in exp:
                    self.assertEqual(pc.year, exp["year"])
                if "type" in exp:
                    self.assertEqual(pc.publication_type, exp["type"])
                if "doi" in exp:
                    self.assertEqual(pc.doi, exp["doi"])
                if "etAl" in exp:
                    self.assertEqual(pc.et_al, exp["etAl"])
                if "editor" in exp:
                    self.assertEqual(pc.editor_role, exp["editor"])
                if "authors" in exp:
                    self.assertEqual([[a.family, a.given] for a in pc.authors], exp["authors"])
                if "initialsOnly" in exp:
                    self.assertEqual([a.initials_only for a in pc.authors], exp["initialsOnly"])
                if "title" in exp:
                    self.assertEqual(pc.title, exp["title"])
                if "container" in exp:
                    self.assertEqual(pc.container, exp["container"])
                if "warningContains" in exp:
                    self.assertTrue(any(exp["warningContains"] in w for w in pc.warnings), pc.warnings)
                # the original string is always preserved
                self.assertTrue(pc.raw_text)

    def test_fold(self):
        self.assertEqual(fold("Müller, Straße"), "muller strasse")


class IdentityRules(unittest.TestCase):
    def test_initials_never_merge_with_full_name(self):
        ids = Identities()
        full = ids.resolve_name("Gless", "Sabine")
        init = ids.resolve_name("Gless", "S.")
        self.assertNotEqual(full, init)
        self.assertEqual(ids.people[init]["identityStatus"], "initials-only")

    def test_literal_and_inverted_full_names_meet(self):
        ids = Identities()
        self.assertEqual(ids.resolve_name("Gless", "Sabine"), ids.resolve_name("Gless", "Sabine"))
        # literal "Sabine Gless" parsed as family=Gless, given=Sabine → same key
        self.assertEqual(Identities.name_key("Gless", "Sabine"), Identities.name_key("Sabine", "Gless"))

    def test_edoc_authority_is_stable_and_absorbs_exact_full_name(self):
        ids = Identities()
        a = ids.register_authority("20f0cedb-fe7b-40dc-9455-51e022c75cc0", "Geth", "Christopher")
        self.assertEqual(ids.resolve_name("Geth", "Christopher"), a)
        self.assertNotEqual(ids.resolve_name("Geth", "C."), a)
        self.assertEqual(ids.people[a]["sourcePersonId"], "edoc-authority:20f0cedb-fe7b-40dc-9455-51e022c75cc0")

    def test_two_authorities_with_same_name_stay_separate(self):
        ids = Identities()
        a = ids.register_authority("aaaa", "Meier", "Anna")
        b = ids.register_authority("bbbb", "Meier", "Anna")
        self.assertNotEqual(a, b)
        # ambiguous: a plain name occurrence must not be attached to either
        c = ids.resolve_name("Meier", "Anna")
        self.assertNotIn(c, (a, b))


if __name__ == "__main__":
    unittest.main()
