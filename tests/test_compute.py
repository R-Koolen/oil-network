"""Cross-checks docs/compute.js (run under node) against an independent calculation in Python.

Skipped when node is not installed. Run from the repository root: python3 -m unittest discover -s tests
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
YEARS = json.loads((DATA / "index.json").read_text())["years"]


def load(year):
    return json.loads((DATA / f"{year}.json").read_text(encoding="utf-8"))


def node_result(year):
    out = subprocess.run(["node", str(ROOT / "tests" / "compute_check.js"), str(year)],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class ComputeMatchesPython(unittest.TestCase):
    def check_year(self, year):
        prev, cur, got = load(year - 1), load(year), node_result(year)
        for layer in ("production", "consumption"):
            a, b = prev["layers"][layer]["values"], cur["layers"][layer]["values"]
            deltas = {i: b[i] - a[i] for i in b if i in a}  # a country missing in either year is left out
            rises = sorted((i for i in deltas if deltas[i] > 0), key=lambda i: -deltas[i])[:3]
            falls = sorted((i for i in deltas if deltas[i] < 0), key=lambda i: deltas[i])[:3]
            self.assertEqual([m["id"] for m in got["moves"][layer]["risers"]], rises, f"{year} {layer}")
            self.assertEqual([m["id"] for m in got["moves"][layer]["fallers"]], falls, f"{year} {layer}")
            for m in got["moves"][layer]["risers"] + got["moves"][layer]["fallers"]:
                self.assertAlmostEqual(m["delta"], deltas[m["id"]], places=6)
        for group in ("crude", "products"):
            ct = sum(f["kusd"] for f in cur["trade"][group])
            flows = sorted(cur["trade"][group], key=lambda f: -f["kusd"])[:60]
            self.assertEqual(got["top"][group]["total"], len(cur["trade"][group]))
            self.assertAlmostEqual(got["top"][group]["share"], sum(f["kusd"] for f in flows) / ct, places=9)
            self.assertEqual(sorted(map(tuple, got["top"][group]["shown"])), sorted((f["from"], f["to"]) for f in flows))

    def test_latest_year(self):
        self.check_year(YEARS[-1])

    def test_a_year_with_a_big_swing(self):
        self.check_year(2020)

    def test_first_year_pair(self):
        self.check_year(YEARS[1])


if __name__ == "__main__":
    unittest.main()
