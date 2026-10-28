"""Checks on the committed docs/data/ files, and on how they match the raw sources.

    python3 -m unittest discover -s pipeline -v

Tests that compare with data/raw/ are skipped when those files are absent (run pipeline/fetch.py first).
"""
import csv
import io
import json
import unittest
import zipfile
from collections import defaultdict

import build

LAYERS = ("production", "consumption", "refining_capacity", "refining_throughput")
DOCS = {y: json.loads((build.OUT / f"{y}.json").read_text(encoding="utf-8")) for y in build.YEARS}


def need(*names):
    missing = [n for n in names if not (build.RAW / n).exists()]
    return unittest.skipIf(missing, f"raw files missing: {missing}")


class Shape(unittest.TestCase):
    def test_at_least_ten_recent_years(self):
        index = json.loads((build.OUT / "index.json").read_text())
        self.assertEqual(index["years"], list(build.YEARS))
        self.assertGreaterEqual(len(index["years"]), 10)
        self.assertEqual(sorted(p.stem for p in build.OUT.glob("*.json")),
                         sorted([str(y) for y in build.YEARS] + ["index", "summary"]))

    def test_every_year_has_all_layers_and_trade(self):
        for y, d in DOCS.items():
            self.assertEqual(d["year"], y)
            for layer in LAYERS:
                self.assertGreater(len(d["layers"][layer]["values"]), 100, f"{y} {layer}")
            for group in ("crude", "products"):
                self.assertGreater(len(d["trade"][group]), 1000, f"{y} {group}")

    def test_everything_references_known_nodes(self):
        for y, d in DOCS.items():
            ids = [n["id"] for n in d["nodes"]]
            self.assertEqual(len(ids), len(set(ids)), y)
            for layer in LAYERS:
                self.assertLessEqual(set(d["layers"][layer]["values"]), set(ids), f"{y} {layer}")
            for group, flows in d["trade"].items():
                for f in flows:
                    self.assertIn(f["from"], ids)
                    self.assertIn(f["to"], ids)
                    self.assertNotEqual(f["from"], f["to"])
                pairs = [(f["from"], f["to"]) for f in flows]
                self.assertEqual(len(pairs), len(set(pairs)), f"{y} {group}")

    def test_no_aggregates_among_nodes(self):
        for y, d in DOCS.items():
            for n in d["nodes"]:
                self.assertTrue(len(n["id"]) == 3 or n["id"] in build.EIA_EXTRA_AREAS, n)
                self.assertNotRegex(n["name"], r"(?i)\b(world|total|OECD|OPEC|union)\b", n)

    def test_names_are_clean_text(self):
        for d in DOCS.values():
            for n in d["nodes"]:
                self.assertNotRegex(n["name"], "[ÃÂ]", n)  # signs of double-encoded UTF-8

    def test_world_totals_equal_sum_of_countries(self):
        # EIA's own World total equals the sum of its country rows; the refining world total is that sum.
        for y, d in DOCS.items():
            for layer in LAYERS:
                l = d["layers"][layer]
                tolerance = 0.0005 * len(l["values"]) + 1e-6  # values are rounded to 3 decimals
                self.assertAlmostEqual(sum(l["values"].values()), l["world"], delta=tolerance, msg=f"{y} {layer}")


class Summary(unittest.TestCase):
    SUMMARY = json.loads((build.OUT / "summary.json").read_text(encoding="utf-8"))

    def test_years_match_index(self):
        self.assertEqual(self.SUMMARY["years"], list(build.YEARS))
        self.assertEqual(self.SUMMARY["years"], json.loads((build.OUT / "index.json").read_text())["years"])

    def test_world_values_equal_the_year_files(self):
        self.assertEqual(list(self.SUMMARY["world"]), list(LAYERS))
        for layer, s in self.SUMMARY["world"].items():
            self.assertEqual(len(s["values"]), len(build.YEARS))
            for y, v in zip(build.YEARS, s["values"]):
                self.assertEqual(v, DOCS[y]["layers"][layer]["world"], f"{y} {layer}")
            self.assertEqual({DOCS[y]["layers"][layer]["unit"] for y in build.YEARS}, {s["unit"]})

    def test_trade_totals_equal_the_year_files(self):
        self.assertEqual(list(self.SUMMARY["trade"]), ["crude", "products"])
        for group, s in self.SUMMARY["trade"].items():
            self.assertEqual(len(s["total"]), len(build.YEARS))
            for y, t in zip(build.YEARS, s["total"]):
                flows = DOCS[y]["trade"][group]
                self.assertAlmostEqual(t, sum(f["kusd"] for f in flows), delta=0.0005, msg=f"{y} {group}")
            self.assertEqual(s["max_flow"], max(f["kusd"] for y in build.YEARS for f in DOCS[y]["trade"][group]))

    def test_summary_is_small(self):
        self.assertLess((build.OUT / "summary.json").stat().st_size, 5000)


class MatchesSource(unittest.TestCase):
    @need("INTL.zip")
    def test_eia_world_totals(self):
        world = defaultdict(dict)
        series = {f"INTL.{c}-WORL-TBPD.A": l for l, c in build.EIA_SERIES.items()}
        with zipfile.ZipFile(build.RAW / "INTL.zip") as z, z.open("INTL.txt") as f:
            for line in f:
                d = json.loads(line)
                if d.get("series_id") in series:
                    world[series[d["series_id"]]] = {int(y): v for y, v in d["data"]}
        for y, d in DOCS.items():
            for layer in build.EIA_SERIES:
                self.assertAlmostEqual(d["layers"][layer]["world"], world[layer][y], places=3)

    @need("undata_refining.csv")
    def test_undata_totals(self):
        total = defaultdict(float)
        with open(build.RAW / "undata_refining.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if int(r["year"]) in build.YEARS and build.number(r["quantity"]) is not None:
                    total[(build.UNDATA_LAYERS[r["transaction"]], int(r["year"]))] += build.number(r["quantity"])
        for y, d in DOCS.items():
            for layer in build.UNDATA_LAYERS.values():
                self.assertAlmostEqual(d["layers"][layer]["world"], total[(layer, y)], places=2)

    @need("BACI_HS12_V202601.zip")
    def test_baci_totals_latest_year(self):
        y = build.YEARS[-1]
        tonnes, kusd = defaultdict(float), defaultdict(float)
        with zipfile.ZipFile(build.RAW / "BACI_HS12_V202601.zip") as z:
            for r in csv.DictReader(io.TextIOWrapper(z.open(f"BACI_HS12_Y{y}_V202601.csv"), encoding="utf-8")):
                group = build.BACI_GROUPS.get(r["k"].strip())
                if group:
                    kusd[group] += float(r["v"])
                    tonnes[group] += build.number(r["q"]) or 0.0
        for group, flows in DOCS[y]["trade"].items():
            self.assertAlmostEqual(sum(f["kusd"] for f in flows), kusd[group], delta=0.0005 * len(flows) + 1e-6)
            # a flow's tonnes is null exactly where BACI has no quantity
            self.assertAlmostEqual(sum(f["tonnes"] or 0 for f in flows), tonnes[group], delta=0.0005 * len(flows))


class Parsing(unittest.TestCase):
    def test_number(self):
        self.assertEqual(build.number("1,234.5"), 1234.5)
        self.assertEqual(build.number(" 7 "), 7.0)
        self.assertEqual(build.number(0), 0.0)
        for marker in ("NA", "--", "ie", "", "  NA", None):
            self.assertIsNone(build.number(marker))


if __name__ == "__main__":
    unittest.main()
