"""Build docs/data/<year>.json from the raw files in data/raw/ (see fetch.py).

    python3 pipeline/build.py

Also writes docs/data/summary.json (world totals, trade totals and the largest single flow for every year) and
docs/data/countries.json (every country's layer values and trade totals for every year), so the page doesn't have
to load every year file for a time series, and docs/data/map.json (country shapes with ISO3 ids, and a map
location for every country). Standard library only. The output is deterministic:
rerunning on the same raw files gives identical bytes. The JSON format is documented in pipeline/README.md.
"""
import csv
import html
import io
import json
import math
import re
import tarfile
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
WORLD_ATLAS = "world-atlas-2.0.2.tgz"
# world-atlas (Natural Earth 4.1.0) ids are ISO 3166 numeric codes; the M49 table translates them to ISO3.
MAP_ID_FIX = {158: "TWN"}  # Natural Earth's Taiwan id, which the M49 table has no row for
MAP_NAME_FIX = {"Kosovo": "XKS"}  # Natural Earth gives Kosovo no id
# Areas BACI reports trade for that the 50 m map has no shape for, as [longitude, latitude] of the main island or
# town. Approximate; they only place the end of a trade line and a small marker.
MAP_POINTS = {
    "BES": [-68.27, 12.15],   # Bonaire, Sint Eustatius and Saba (Caribbean Netherlands)
    "CCK": [96.83, -12.16],   # Cocos (Keeling) Islands
    "CXR": [105.69, -10.49],  # Christmas Island
    "GIB": [-5.35, 36.14],    # Gibraltar
    "MYT": [45.17, -12.82],   # Mayotte
    "TKL": [-171.85, -9.17],  # Tokelau
    "TUV": [179.20, -8.52],   # Tuvalu
}
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


def read_world_atlas(path):
    with tarfile.open(path, "r:gz") as t:
        return json.load(t.extractfile("package/countries-50m.json"))


def arc_points(topo, i):
    """The points of arc i (a negative i is arc ~i reversed) in degrees."""
    (sx, sy), (tx, ty) = topo["transform"]["scale"], topo["transform"]["translate"]
    x = y = 0
    pts = []
    for dx, dy in topo["arcs"][i if i >= 0 else ~i]:
        x += dx
        y += dy
        pts.append((x * sx + tx, y * sy + ty))
    return pts if i >= 0 else pts[::-1]


def ring_points(topo, ring):
    """The ring's points with longitudes made continuous: a polygon that crosses the antimeridian (Russia, Fiji)
    then runs past 180 instead of jumping to -180."""
    pts = []
    for a in ring:
        p = arc_points(topo, a)
        pts += p if not pts else p[1:]
    out, shift = pts[:1], 0.0
    for (x0, _), (x1, y1) in zip(pts, pts[1:]):
        shift += -360.0 if x1 - x0 > 180 else 360.0 if x1 - x0 < -180 else 0.0
        out.append((x1 + shift, y1))
    return out


def ring_centroid(pts):
    """(area, lon, lat) of a ring, flat in longitude scaled by cos(latitude); good enough to pick a main landmass."""
    k = math.cos(math.radians(sum(y for _, y in pts) / len(pts)))
    q = [(x * k, y) for x, y in pts]
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(q, q[1:] + q[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:
        return 0.0, sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)
    return abs(a) / 2, cx / (3 * a) / k, cy / (3 * a)


def main_landmass_point(topo, geometry):
    """Longitude and latitude of the centre of a country's largest polygon (so France is Paris-ish, not the
    middle of the Atlantic)."""
    polygons = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
    best = max((ring_centroid(ring_points(topo, p[0])) for p in polygons), key=lambda r: r[0])
    return [round((best[1] + 180) % 360 - 180, 2), round(best[2], 2)]


def build_map(topo, m49):
    """The shapes with ISO3 ids (names dropped, unused arcs removed) and a [lon, lat] per country."""
    geoms, anchors, seen = [], {}, set()
    for g in topo["objects"]["countries"]["geometries"]:
        iso = MAP_NAME_FIX.get(g["properties"]["name"]) if g.get("id") is None else \
            MAP_ID_FIX.get(int(g["id"])) or m49.get(int(g["id"]))
        if iso in seen:
            iso = None  # a second shape with the same code (Ashmore and Cartier Islands, under Australia)
        out = {"type": g["type"], "arcs": g["arcs"]}
        if iso:
            seen.add(iso)
            out["id"] = iso
            anchors[iso] = main_landmass_point(topo, g)
        geoms.append(out)
    for iso, point in MAP_POINTS.items():
        assert iso not in anchors, iso
        anchors[iso] = point
    used = set()

    def walk(a):
        for x in a:
            if isinstance(x, list):
                walk(x)
            else:
                used.add(x if x >= 0 else ~x)

    for g in geoms:
        walk(g["arcs"])
    new = {old: n for n, old in enumerate(sorted(used))}

    def renumber(a):
        return [renumber(x) if isinstance(x, list) else (new[x] if x >= 0 else ~new[~x]) for x in a]

    for g in geoms:
        g["arcs"] = renumber(g["arcs"])
    topology = {"type": "Topology", "transform": topo["transform"],
                "objects": {"countries": {"type": "GeometryCollection", "geometries": geoms}},
                "arcs": [topo["arcs"][i] for i in sorted(used)]}
    return {"topology": topology, "anchors": dict(sorted(anchors.items()))}


def write_map():
    doc = build_map(read_world_atlas(RAW / WORLD_ATLAS), read_m49(RAW / "m49.html"))
    (OUT / "map.json").write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")


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
    n_years = len(YEARS)
    countries = {}  # id -> {"name": ..., "production": [per year], ..., "crude": {"imports": [...], "exports": [...]}}

    def country(area, name):
        c = countries.get(area)
        if c is None:
            c = {"name": name}
            for layer in LAYER_ORDER:
                c[layer] = [None] * n_years
            for group in BACI_GROUPS.values():
                c[group] = {"imports": [None] * n_years, "exports": [None] * n_years}
            countries[area] = c
        c["name"] = name
        return c

    for i, year in enumerate(YEARS):
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
        for n in doc["nodes"]:
            country(n["id"], n["name"])
        for layer, l in layers.items():
            for a, v in l["values"].items():
                countries[a][layer][i] = v
        for group, flows in trade.items():
            imports, exports = defaultdict(float), defaultdict(float)
            for f in flows:
                exports[f["from"]] += f["kusd"]
                imports[f["to"]] += f["kusd"]
            for a in imports.keys() | exports.keys():  # a country with no flow in this group that year stays None
                countries[a][group]["imports"][i] = round(imports[a], 3)
                countries[a][group]["exports"][i] = round(exports[a], 3)
        for layer, l in layers.items():
            summary["world"][layer]["unit"] = l["unit"]
            summary["world"][layer]["values"].append(l["world"])
        for group, flows in trade.items():
            summary["trade"][group]["total"].append(round(sum(f["kusd"] for f in flows), 3))
            summary["trade"][group]["max_flow"] = max(summary["trade"][group]["max_flow"], max(f["kusd"] for f in flows))
        print(f"wrote {year}.json")
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")) + "\n", encoding="utf-8")
    (OUT / "countries.json").write_text(
        json.dumps({"years": list(YEARS), "countries": dict(sorted(countries.items()))}, ensure_ascii=False,
                   separators=(",", ":")) + "\n", encoding="utf-8")
    write_map()
    (OUT / "index.json").write_text(json.dumps({"years": list(YEARS)}) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
