// Prints docs/compute.js results for a year pair as JSON: node tests/compute_check.js <year>
// tests/test_compute.py recomputes the same numbers in Python and compares.
"use strict";
const fs = require("fs");
const path = require("path");
const C = require("../docs/compute.js");
const read = (y) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "data", `${y}.json`), "utf8"));
const year = Number(process.argv[2]);
const prev = read(year - 1), cur = read(year);
const names = new Map([...prev.nodes, ...cur.nodes].map((n) => [n.id, n.name]));
const out = { moves: {}, top: {}, partners: {} };
for (const id of ["USA", "CHN", "SGP", "TWN", "NLD", "MLT", "ATG"]) {
  out.partners[id] = {};
  for (const group of ["crude", "products"]) out.partners[id][group] = C.partners(cur.trade[group], id, 5);
}
for (const layer of ["production", "consumption"]) out.moves[layer] = C.biggestMoves(prev.layers[layer].values, cur.layers[layer].values, names, 3);
for (const group of ["crude", "products"]) {
  const t = C.topFlows(cur.trade[group], 60);
  out.top[group] = { total: t.total, share: t.share, shown: t.shown.map((f) => [f.from, f.to]) };
}
console.log(JSON.stringify(out));
