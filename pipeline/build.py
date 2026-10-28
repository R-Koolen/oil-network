"""Build docs/data/<year>.json from the raw files in data/raw/ (see fetch.py).

    python3 pipeline/build.py

Also writes docs/data/summary.json: the numbers the page needs across years (world totals, trade totals, largest
single flow), so it doesn't have to load every year file. Standard library only. The output is deterministic:
rerunning on the same raw files gives identical bytes. The JSON format is documented in pipeline/README.md.
"""
import csv
import html
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "docs" / "data"
# Every layer has data for these years. UNdata 2024 lacks China, India and most others. BACI 2012 has implausible
# crude imports to Taiwan (US$278 bn, against US$16-51 bn in every other year), so the series starts in 2013.
YEARS = range(2013, 2024)

EIA_SERIES = {"production": "57-1", "consumption": "5-2"}  # crude oil incl. lease condensate; petroleum and other liquids
# EIA areas that are countries/territories but have no 3-letter code. Every other non-3-letter code is an aggregate.
EIA_EXTRA_AREAS = {"NLDA", "USIQ", "HITZ", "DEUW"}
UNDATA_LAYERS = {"131": "refining_capacity", "086": "refining_throughput"}
# UNdata/UN statistics codes that differ from ISO 3166 numeric (those include overseas territories).
UNDATA_M49_FIX = {251: "FRA", 382: "ITA", 579: "NOR", 757: "CHE", 158: "TWN"}
# BACI "Other Asia, nes" is the UN trade-statistics label for Taiwan.
BACI_ISO3_FIX = {"S19": "TWN"}
# BACI HS12 folds all of HS 2710 (including waste oils) into one code.
BACI_GROUPS = {"270900": "crude", "271000": "products"}
LAYER_ORDER = ("production", "consumption", "refining_capacity", "refining_throughput")


def number(s):
    """Source cell -> float, or None for 'NA', '--', 'ie', blanks and other markers."""
    if isinstance(s, (int, float)):
        return float(s)
    try:
        return float(str(s).replace(",", "").strip())
    except ValueError:
        return None


def read_m49(path):
    """M49 numeric code -> ISO3, from the UNSD M49 overview page.

    Used only to translate UNdata's codes. Its names and regions are not republished: the UN's general
    copyright terms require written permission (see docs/SOURCES.md)."""
    text = path.read_text(encoding="utf-8")
    table = re.search(r'(?s)<table id = "downloadTableEN"[^>]*>(.*?)</table>', text).group(1)
    areas = {}
    for row in re.findall(r"(?s)<tr[^>]*>(.*?)</tr>", table):
        c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"(?s)<td[^>]*>(.*?)</td>", row)]
        if c and c[9].isdigit() and c[11]:
            areas[int(c[9])] = c[11]
    return areas


def read_eia(path):
    """layer -> year -> {area: kb/d}, plus layer -> year -> world total, plus area names."""
    wanted = {f"INTL.{code}-": layer for layer, code in EIA_SERIES.items()}
    values = {layer: defaultdict(dict) for layer in EIA_SERIES}
    world = {layer: {} for layer in EIA_SERIES}
    names = {}
    with zipfile.ZipFile(path) as z, z.open("INTL.txt") as f:
        for line in f:
            d = json.loads(line)
            sid = d.get("series_id", "")
            if d.get("f") != "A" or not sid.endswith("-TBPD.A"):
                continue
            layer = next((l for p, l in wanted.items() if sid.startswith(p)), None)
            if layer is None:
                continue
            area = sid.split("-")[2]
            for year, v in d["data"]:
                v = number(v)
                if v is None or int(year) not in YEARS:
                    continue
                if area == "WORL":
                    world[layer][int(year)] = v
                elif len(area) == 3 or area in EIA_EXTRA_AREAS:
                    values[layer][int(year)][area] = v
                    names[area] = d["name"].split(", ", 1)[1].rsplit(", ", 1)[0]  # "<series>, <area>, Annual"
    return values, world, names


def read_undata(path, m49):
    """layer -> year -> {iso3: thousand tonnes}."""
    by_code = m49 | UNDATA_M49_FIX
    values = {layer: defaultdict(dict) for layer in UNDATA_LAYERS.values()}
    unmatched = set()
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            year, v = int(r["year"]), number(r["quantity"])
            if year not in YEARS or v is None:
                continue
            iso = by_code.get(int(r["m49"]))
            if iso is None:
                unmatched.add(r["country"])
                continue
            values[UNDATA_LAYERS[r["transaction"]]][year][iso] = v
    if unmatched:
        raise SystemExit(f"UNdata areas with no ISO3 code in {YEARS}: {sorted(unmatched)}")
    return values


def read_baci(path):
    """year -> group -> {(exporter, importer): [tonnes, thousand USD]}, plus area names."""
    flows = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))
    with zipfile.ZipFile(path) as z:
        codes = {}
        names = {}
        for r in csv.DictReader(io.TextIOWrapper(z.open("country_codes_V202601.csv"), encoding="utf-8")):
            iso = BACI_ISO3_FIX.get(r["country_iso3"], r["country_iso3"])
            codes[r["country_code"]] = iso
            # the file's non-ASCII names are UTF-8 encoded twice ("CuraÃ§ao")
            names.setdefault(iso, r["country_name"].encode("latin-1").decode("utf-8"))
        for year in YEARS:
            with z.open(f"BACI_HS12_Y{year}_V202601.csv") as f:
                next(f)
                for line in f:
                    t, i, j, k, v, q = line.decode().rstrip("\n").split(",")
                    group = BACI_GROUPS.get(k.strip())
                    if group is None:
                        continue
                    cell = flows[year][group][(codes[i], codes[j])]
                    q = number(q)
                    cell[0] = None if (q is None or cell[0] is None) else cell[0] + q
                    cell[1] += number(v)
    return flows, names


def build():
    m49 = read_m49(RAW / "m49.html")
    eia, eia_world, eia_names = read_eia(RAW / "INTL.zip")
    undata = read_undata(RAW / "undata_refining.csv", m49)
    baci, baci_names = read_baci(RAW / "BACI_HS12_V202601.zip")

    def node(area):
        return {"id": area, "name": eia_names.get(area) or baci_names[area]}

    OUT.mkdir(parents=True, exist_ok=True)
    summary = {"years": list(YEARS),
               "world": {layer: {"unit": None, "values": []} for layer in LAYER_ORDER},
               "trade": {group: {"unit": "kusd", "total": [], "max_flow": 0} for group in BACI_GROUPS.values()}}
    for year in YEARS:
        layers = {}
        for layer in EIA_SERIES:
            layers[layer] = {"unit": "kb/d", "world": round(eia_world[layer][year], 3), "world_from": "source",
                             "values": {a: round(v, 3) for a, v in sorted(eia[layer][year].items())}}
        for layer in UNDATA_LAYERS.values():
            vals = undata[layer][year]
            layers[layer] = {"unit": "kt/yr", "world": round(sum(vals.values()), 3), "world_from": "sum",
                             "values": {a: round(v, 3) for a, v in sorted(vals.items())}}
        trade = {}
        for group in ("crude", "products"):
            rows = sorted(baci[year][group].items())
            trade[group] = [{"from": i, "to": j, "tonnes": None if q is None else round(q, 3), "kusd": round(v, 3)}
                            for (i, j), (q, v) in rows]
        ids = {a for l in layers.values() for a in l["values"]}
        ids |= {a for g in trade.values() for f in g for a in (f["from"], f["to"])}
        doc = {"year": year, "nodes": [node(a) for a in sorted(ids)], "layers": layers, "trade": trade}
        (OUT / f"{year}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                                          encoding="utf-8")
        for layer, l in layers.items():
            summary["world"][layer]["unit"] = l["unit"]
            summary["world"][layer]["values"].append(l["world"])
        for group, flows in trade.items():
            summary["trade"][group]["total"].append(round(sum(f["kusd"] for f in flows), 3))
            summary["trade"][group]["max_flow"] = max(summary["trade"][group]["max_flow"], max(f["kusd"] for f in flows))
        print(f"wrote {year}.json")
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")) + "\n", encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps({"years": list(YEARS)}) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
