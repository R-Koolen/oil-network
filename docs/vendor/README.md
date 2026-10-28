# Vendored libraries

The site loads nothing from outside itself, so these are served from this folder. `tests/test_site.py` checks that
every `.js` file here has a row below, that its sha256 matches, and that its licence file exists.

| File | Library | Version | Source | sha256 | Licence |
|---|---|---|---|---|---|
| `d3.min.js` | D3 (full bundle) | 7.9.0 | https://registry.npmjs.org/d3/-/d3-7.9.0.tgz, `package/dist/d3.min.js` | `f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539` | `LICENSE-d3` (ISC) |
| `topojson-client.min.js` | topojson-client | 3.1.0 | https://registry.npmjs.org/topojson-client/-/topojson-client-3.1.0.tgz, `package/dist/topojson-client.min.js` | `25cd02ae486cc5063e0215a4e4cfb15de83700c87ac48bac4d57dc6aaf3ebb89` | `LICENSE-topojson-client` (ISC) |

`LICENSE-world-atlas` is the licence of the npm package `world-atlas` 2.0.2 (ISC, © Michael Bostock), whose
Natural Earth shapes are the base of `docs/data/map.json` after the pipeline converts them (see `pipeline/README.md`).
