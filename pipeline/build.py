"""Build docs/data/<year>.json from the raw files in data/raw/ (see fetch.py).

    python3 pipeline/build.py

Standard library only. The output is deterministic: rerunning on the same raw files gives identical bytes.
The JSON format is documented in pipeline/README.md.
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
YEARS = range(2012, 2024)  # every layer has data for these years; UNdata 2024 lacks China, India and most others

EIA_SERIES = {"production": "57-1", "consumption": "5-2"}  # crude oil incl. lease condensate; petroleum and other liquids
# EIA areas that are countries/territories but have no 3-letter code. Every other non-3-letter code is an aggregate.
EIA_EXTRA_AREAS = {"NLDA", "USIQ", "HITZ", "DEUW"}
UNDATA_LAYERS = {"131": "refining_capacity", "086": "refining_throughput"}
# UNdata/UN statistics codes that differ from ISO 3166 numeric (those include overseas territories).
UNDATA_M49_FIX = {251: "FRA", 382: "ITA", 579: "NOR", 757: "CHE", 158: "TWN"}
# BACI "Other Asia, nes" is the UN trade-statistics label for Taiwan.
BACI_ISO3_FIX = {"S19": "TWN"}
# Areas missing from the M49 table, so they have no name or region there.
EXTRA_AREAS = {
    "TWN": ("Taiwan", "Asia", "Eastern Asia"),
    "XKS": ("Kosovo", "Europe", "Southern Europe"),
}
# BACI HS12 folds all of HS 2710 (including waste oils) into one code.
BACI_GROUPS = {"270900": "crude", "271000": "products"}


def number(s):
    """Source cell -> float, or None for 'NA', '--', 'ie', blanks and other markers."""
    if isinstance(s, (int, float)):
        return float(s)
    try:
        return float(str(s).replace(",", "").strip())
    except ValueError:
        return None


def read_m49(path):
    """ISO3 -> (name, region, sub-region) from the UNSD M49 overview page."""
    text = path.read_text(encoding="utf-8")
    table = re.search(r'(?s)<table id = "downloadTableEN"[^>]*>(.*?)</table>', text).group(1)
    areas = {}
    for row in re.findall(r"(?s)<tr[^>]*>(.*?)</tr>", table):
        c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"(?s)<td[^>]*>(.*?)</td>", row)]
        if c and c[9].isdigit() and c[11]:
            areas[c[11]] = (c[8], c[3] or None, c[5] or None, int(c[9]))
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
                    names[area] = d["name"].split(", ")[1]
    return values, world, names


def read_undata(path, m49):
    """layer -> year -> {iso3: thousand tonnes}, plus names for areas outside M49."""
    by_code = {v[3]: iso for iso, v in m49.items()} | UNDATA_M49_FIX
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
            names.setdefault(iso, r["country_name"])
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
        if area in m49:
            name, region, subregion, _ = m49[area]
        elif area in EXTRA_AREAS:
            name, region, subregion = EXTRA_AREAS[area]
        else:
            name, region, subregion = eia_names.get(area) or baci_names[area], None, None
        return {"id": area, "name": name, "region": region, "subregion": subregion}

    OUT.mkdir(parents=True, exist_ok=True)
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
        print(f"wrote {year}.json")
    (OUT / "index.json").write_text(json.dumps({"years": list(YEARS)}) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
