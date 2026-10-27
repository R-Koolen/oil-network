# Data pipeline

Turns openly licensed oil statistics into one JSON file per year in `docs/data/`, for the network-graph site.
Sources, licences and the required attribution are in [docs/SOURCES.md](../docs/SOURCES.md).

Standard library only (Python 3.14 tested). From the repository root:

```sh
python3 pipeline/fetch.py                       # download raw files into data/raw/ (gitignored), about 1.3 GB
python3 pipeline/build.py                       # write docs/data/<year>.json and index.json, about 3 minutes
python3 -m unittest discover -s pipeline -v     # checks; the ones that compare with data/raw/ skip without it
```

`fetch.py` skips files that already exist. Re-running `build.py` on the same raw files reproduces
`docs/data/` byte for byte. The committed files were built from:

| File | Source | sha256 |
|---|---|---|
| `INTL.zip` | EIA International Energy Statistics bulk file, updated 2026-10-19 | `367a8d8f…483216` |
| `undata_refining.csv` | UNdata Energy Statistics, trIDs 131 and 086, paged from the HTML view (the CSV download now redirects to a JavaScript app) | `12673e07…a3674b` |
| `BACI_HS12_V202601.zip` | CEPII BACI, HS12, version 202601 | `2dd0dd61…b75bf9` |
| `m49.html` | UNSD M49 overview page (code matching only) | `b9048114…a7a1fb` |

EIA and UNdata revise their files, so a later fetch can produce different numbers.

## Years

`docs/data/index.json` lists the years: `{"years": [2012, …, 2023]}`. **2012–2023**: every layer has data
for all of them. The start is set by BACI HS12, which begins in 2012. The end is set by UNdata refining:
2024 has only 27 countries for capacity and 47 for throughput, with no China or India.

## Format of `docs/data/<year>.json`

```json
{
  "year": 2023,
  "nodes": [{"id": "USA", "name": "United States"}, …],
  "layers": {
    "production":          {"unit": "kb/d",  "world": 82086.9, "world_from": "source", "values": {"USA": 12935.4, …}},
    "consumption":         {"unit": "kb/d",  "world": 101503.6, "world_from": "source", "values": {…}},
    "refining_capacity":   {"unit": "kt/yr", "world": 5147943.0, "world_from": "sum",    "values": {…}},
    "refining_throughput": {"unit": "kt/yr", "world": 3974338.0, "world_from": "sum",    "values": {…}}
  },
  "trade": {
    "crude":    [{"from": "SAU", "to": "CHN", "tonnes": 86000000.0, "kusd": 52000000.0}, …],
    "products": [ … ]
  }
}
```

(Numbers above are illustrative.)

- `nodes`: every area that appears in any layer or flow that year, sorted by `id`. `name` comes from EIA,
  or from BACI for areas EIA doesn't list.
- `layers.<layer>.values`: area id → value. An area is missing when the source has no number for it that
  year ("NA", "--", or not listed). `0` means the source reported zero.
- `layers.<layer>.world`: for `production` and `consumption`, EIA's own World total (`"world_from": "source"`).
  It equals the sum of `values`. For refining, UNdata has no world total, so it is the sum of `values`
  (`"world_from": "sum"`).
- `trade.<group>`: one entry per exporter→importer pair, sorted by `from`, then `to`. `tonnes` is `null`
  when BACI has a value but no quantity for the flow (about 0.4–3% of flows). `kusd` is thousands of US dollars.
- Values are rounded to 3 decimals.
- UNdata footnote markers (numeric references such as `1`, which UNdata's page explains, e.g. "Estimate") are fetched into `data/raw/undata_refining.csv` but not
  carried into the JSON.

### What each layer measures

| Layer | Source series | Unit |
|---|---|---|
| `production` | EIA "Crude oil including lease condensate production" (57-1) | thousand barrels per day |
| `consumption` | EIA "Petroleum and other liquids consumption" (5-2) | thousand barrels per day |
| `refining_capacity` | UNdata "Crude petroleum - refinery capacity" | thousand metric tons per year |
| `refining_throughput` | UNdata "Conventional crude oil - transformation in oil refineries" (crude input only; excludes NGL and other feedstocks) | thousand metric tons per year |
| `trade.crude` | BACI HS 270900, crude petroleum oils | tonnes, thousand USD |
| `trade.products` | BACI HS 271000, petroleum oils other than crude: all of HS 2710, which in BACI HS12 also includes a small amount of waste oils | tonnes, thousand USD |

UNdata's throughput sometimes exceeds its capacity. India, for example, ran at 101–111% of capacity in
2012–2019, 2022 and 2023 (111% in 2023). Overall, 38 country-years across 15 countries exceed 100%. We haven't
established why; the pipeline passes both through unchanged.

**Units are not consistent across layers.** Production and consumption are volumes (kb/d), refining and trade
are masses. To put mass on the same scale, a common approximation for crude is 7.33 barrels per tonne:
`kb/d ≈ kt/yr × 7.33 / 365`. Products vary more in density, so no single factor is exact. The pipeline does
not convert, so the published numbers stay the source's own.

### Identifiers

`id` is the ISO 3166-1 alpha-3 code wherever one exists, so areas match across sources. Exceptions:

- EIA areas without a 3-letter code that are real areas, not aggregates: `NLDA` (Netherlands Antilles, which EIA
  still reports as one area), `USIQ` (U.S. Pacific Islands); `HITZ` and `DEUW` also count, but have no data in
  these years.
- EIA's own 3-letter codes: `XKS` (Kosovo) and `WAK` (Wake Island).
- UNdata uses UN statistical codes for four countries, mapped to the ISO3 of the country itself: 251→`FRA`,
  382→`ITA`, 579→`NOR`, 757→`CHE`. UNdata 158 ("Other Asia") is mapped to `TWN`.
- BACI ships its own ISO3 column. Its "Other Asia, nes" (`S19`) is the UN trade-statistics label for Taiwan,
  and is mapped to `TWN`.

### Matching across sources (2023)

EIA has 220 areas, UNdata refining 112 and BACI 226. Areas that are only in one of them:

- UNdata only: `CUW` (Curaçao). EIA reports it within `NLDA`.
- BACI only: small territories (Andorra, Anguilla, Bonaire/Sint Eustatius/Saba, Curaçao, Sint Maarten,
  Marshall Islands, Palau, San Marino, Tuvalu and others), which EIA doesn't list.
- EIA only: `PRI`, `VIR`, `GLP`, `GUF`, `MTQ`, `REU`, `FRO`, `ESH`, `XKS`, `NLDA`, `USIQ`, `WAK`, `ATA`.
  BACI counts Puerto Rico and the US Virgin Islands within `USA`, and the French overseas departments
  within `FRA` (customs territories).

### Aggregates

No aggregate is published as a node. From EIA, the World row becomes `world`. Every other non-country EIA
area (regions, OECD, OPEC, EU27, the `WP..` and other region codes) is dropped. UNdata and BACI here are
by country only. There are no "Other X" residual nodes: EIA's World total equals the sum of its areas exactly,
so nothing is left over.

### Trade

- Country to country, for **every year 2012–2023**, crude and products separately.
- Flows within a country don't exist in the data. Flows within a region (for example, between EU countries)
  are included as ordinary country-to-country flows.
- BACI reconciles what exporters and importers report, so a flow appears once, not once per reporter.
- **Some BACI quantities are implausible.** In some years a few large flows have tonnes far above what their
  value implies. For example, 2023 crude ARE→THA is 214.9 Mt at $64/t, when the median is $649/t; 214.9 Mt is
  ~4.3 mb/d, several times Thailand's total crude imports. Flows below a quarter of the year's median unit
  value hold ~15% of 2023 crude tonnes and ~16% of 2020 product tonnes, but ~0% in 2015. The pipeline passes
  BACI's numbers through unchanged. `kusd` looks reliable; `tonnes` does not. **Sizing graph edges by
  `tonnes` will mislead**, so size them by `kusd`.
- Trade isn't linked to production or consumption: imports minus exports won't exactly equal consumption
  minus production (stocks, bunkers, re-exports and differences in definitions all play a part).
