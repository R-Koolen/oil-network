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

    def check_partners(self, year):
        cur, got = load(year), node_result(year)
        for cid, groups in got["partners"].items():
            for group, g in groups.items():
                flows = cur["trade"][group]
                for side, own, other in (("imports", "to", "from"), ("exports", "from", "to")):
                    rows = sorted(((f[other], f["kusd"]) for f in flows if f[own] == cid), key=lambda r: (-r[1], r[0]))
                    total = sum(k for _, k in rows)
                    s = g[side]
                    self.assertEqual(s["count"], len(rows), f"{year} {cid} {group} {side}")
                    self.assertAlmostEqual(s["total"], total, places=3)
                    self.assertEqual([(t["id"], t["kusd"]) for t in s["top"]], rows[:5])
                    for t in s["top"]:
                        self.assertAlmostEqual(t["share"], t["kusd"] / total, places=9)
                self.assertAlmostEqual(g["net"], g["exports"]["total"] - g["imports"]["total"], places=3)

    def test_partners_latest_year(self):
        self.check_partners(YEARS[-1])

    def test_partners_a_year_with_a_swing(self):
        self.check_partners(2020)

    def test_over_capacity_years_match_the_data(self):
        countries = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
        js = ("const C=require('./docs/compute.js');const d=require('./docs/data/countries.json');"
              "const out={};for(const [id,c] of Object.entries(d.countries)){const o=C.overCapacityYears("
              "c.refining_throughput,c.refining_capacity,d.years);if(o.length)out[id]=o;}console.log(JSON.stringify(out))")
        got = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        want = {}
        for a, c in countries["countries"].items():
            ys = [y for y, t, k in zip(countries["years"], c["refining_throughput"], c["refining_capacity"])
                  if t is not None and k is not None and t > k]
            if ys:
                want[a] = ys
        self.assertEqual(got, want)
        self.assertEqual(len(got), 14)  # the countries the README's "exceed 100%" statement counts

    def test_shade_max_is_the_largest_country_value_in_any_year(self):
        countries = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))["countries"]
        js = ("const C=require('./docs/compute.js');const d=require('./docs/data/countries.json');"
              "console.log(JSON.stringify(['production','consumption','refining_throughput'].map(l=>C.shadeMax(d.countries,l))))")
        got = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        want = [max(v for c in countries.values() for v in c[l] if v is not None)
                for l in ("production", "consumption", "refining_throughput")]
        self.assertEqual(got, want)

    def test_every_flow_the_graph_draws_has_a_place_on_the_map_in_every_year(self):
        js = ("const C=require('./docs/compute.js');const fs=require('fs');const m=require('./docs/data/map.json');"
              "const out={};for(const y of require('./docs/data/index.json').years){const d=JSON.parse(fs.readFileSync('docs/data/'+y+'.json'));"
              "let drawn=0,missing=0;for(const g of ['crude','products']){const r=C.mapLines(C.topFlows(d.trade[g],60).shown,m.anchors);drawn+=r.lines.length;missing+=r.missing}"
              "out[y]=[drawn,missing]}console.log(JSON.stringify(out))")
        got = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        self.assertEqual(len(got), len(YEARS))
        for y, (drawn, missing) in got.items():
            self.assertEqual((drawn, missing), (120, 0), y)

    def test_map_lines_skip_and_count_flows_without_a_location(self):
        js = ("const C=require('./docs/compute.js');console.log(JSON.stringify(C.mapLines("
              "[{from:'A',to:'B',kusd:1},{from:'A',to:'Z',kusd:2}],{A:[1,2],B:[3,4]})))")
        got = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        self.assertEqual(got["missing"], 1)
        self.assertEqual(got["lines"], [{"from": "A", "to": "B", "kusd": 1, "a": [1, 2], "b": [3, 4]}])

    def test_a_line_over_the_date_line_is_two_runs_that_meet_at_the_edge(self):
        js = ("const C=require('./docs/compute.js');const fs=require('fs');const m=require('./docs/data/map.json');"
              "const out={cross:0,bad:[]};for(const y of require('./docs/data/index.json').years){const d=JSON.parse(fs.readFileSync('docs/data/'+y+'.json'));"
              "for(const g of ['crude','products'])for(const f of C.topFlows(d.trade[g],60).shown){const a=m.anchors[f.from],b=m.anchors[f.to];"
              "const r=C.wrapLine(a,b,48);const first=r[0][0],last=r[r.length-1][r[r.length-1].length-1];"
              "const ok=r.length<=2&&Math.abs(first[0]-a[0])<1e-9&&Math.abs(last[0]-b[0])<1e-9&&Math.abs(last[1]-b[1])<1e-9&&r.flat().every(p=>Math.abs(p[0])<=180)&&"
              "(r.length===1||(Math.abs(r[0][r[0].length-1][0])===180&&r[0][r[0].length-1][0]===-r[1][0][0]&&r[0][r[0].length-1][1]===r[1][0][1]));"
              "if(r.length===2)out.cross++;if(!ok)out.bad.push([y,f.from,f.to])}}console.log(JSON.stringify(out))")
        out = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        self.assertEqual(out["bad"], [])
        self.assertGreater(out["cross"], 0)  # the Pacific routes are in the data, so the cut is exercised

    def test_hash_round_trip(self):
        js = ("const C=require('./docs/compute.js');const y=[2013,2020,2023];"
              "console.log(JSON.stringify([C.parseHash('#2020/usa',y),C.parseHash('#2020',y),C.parseHash('#1999/USA',y),"
              "C.parseHash('#2020/',y),C.parseHash('',y),C.parseHash('#2020/<b>',y),C.formatHash(2020,'USA'),C.formatHash(2013,null)]))")
        out = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        self.assertEqual(out, [{"year": 2020, "country": "USA"}, {"year": 2020, "country": None},
                               {"year": None, "country": "USA"}, {"year": None, "country": None},
                               {"year": None, "country": None}, {"year": None, "country": None},
                               "#2020/USA", "#2013"])

    def test_small_shares_read_less_than_one_percent_not_zero(self):
        js = ("const C=require('./docs/compute.js');console.log(JSON.stringify([0,0.00001,0.0049,0.005,0.0149,0.0151,0.5,1].map(C.formatShare)))")
        out = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        self.assertEqual(out, ["0%", "<1%", "<1%", "1%", "1%", "2%", "50%", "100%"])

    def test_selection_notifies_only_on_change(self):
        js = ("const C=require('./docs/compute.js');const s=C.createSelection();let n=[];s.subscribe(v=>n.push(v));"
              "s.set('USA');s.set('USA');s.set(null);s.set(null);console.log(JSON.stringify([n,s.get()]))")
        out = json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
        self.assertEqual(out, [["USA", None], None])

    def test_latest_year(self):
        self.check_year(YEARS[-1])

    def test_a_year_with_a_big_swing(self):
        self.check_year(2020)

    def test_first_year_pair(self):
        self.check_year(YEARS[1])


if __name__ == "__main__":
    unittest.main()
