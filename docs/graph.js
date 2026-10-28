"use strict";

// The oil network for the year picked on the slider. Calculations are in compute.js (OilCompute).
// Everything is loaded from this site; styling lives in style.css (CSP allows no inline style).

const { topFlows, layoutColumn, biggestMoves, shareMoves } = OilCompute;

const TOP_CRUDE_FLOWS = 60;
const TOP_PRODUCT_FLOWS = 60;
const MOVES_SHOWN = 3;

const WIDTH = 1100;
const NODE_W = 12;
const COL_X = [170, 550, 930];
const TOP = 70;
const GAP = 4;
const MIN_NODE_H = 10;
// Node height = value * k, with k fixed per column: VALUE_H pixels for the biggest world total in any year.
// Shown countries are always a part of the world, so a column fits in any year.
const VALUE_H = 600;
const MIN_PLOT_H = 760;

const COLUMNS = [
  { layer: "production", title: "Crude oil production" },
  { layer: "refining_throughput", title: "Refining (crude processed)" },
  { layer: "consumption", title: "Petroleum consumption" },
];

const int = d3.format(",.0f");
const pct = d3.format(".0%");
const pct1 = d3.format(".1%");

const cache = new Map(); // year -> Promise of that year's data, so each file is fetched once
let summary = null;
let years = [];
let latestRequest = 0;

async function getJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function loadYear(year) {
  if (!cache.has(year)) {
    cache.set(year, getJson(`data/${year}.json`).catch((e) => {
      cache.delete(year);
      throw e;
    }));
  }
  return cache.get(year);
}

function fail(message) {
  d3.select("#error").text(message).attr("hidden", null);
  d3.select("#subtitle").text("");
}

function fmtValue(v, unit) {
  return v === null ? "no data" : `${int(v)} ${unit}`;
}

function fmtUsd(kusd) {
  const usd = kusd * 1000;
  const short = usd >= 1e9 ? `${d3.format(".1f")(usd / 1e9)} billion` : `${d3.format(".1f")(usd / 1e6)} million`;
  return `US$${short} (US$${int(usd)})`;
}

function fmtUsdShort(kusd) {
  return `US$${d3.format(",.1f")(kusd / 1e6)} billion`;
}

function fmtTonnes(t) {
  return t === null ? "no quantity reported" : `${int(t)} t (unreliable, not used for line width)`;
}

function describe(summary, label) {
  return `${label}: the ${d3.format(",")(summary.shown.length)} largest flows by value, ` +
    `${pct(summary.share)} of world value (${fmtUsdShort(summary.shownKusd)} of ${fmtUsdShort(summary.allKusd)}; ` +
    `${d3.format(",")(summary.shown.length)} of ${d3.format(",")(summary.total)} flows).`;
}

function drawGraph(data) {
  const names = new Map(data.nodes.map((n) => [n.id, n.name]));
  const crude = topFlows(data.trade.crude, TOP_CRUDE_FLOWS);
  const products = topFlows(data.trade.products, TOP_PRODUCT_FLOWS);

  // Countries at the ends of the shown flows, per column.
  const ids = [
    new Set(crude.shown.map((f) => f.from)),
    new Set([...crude.shown.map((f) => f.to), ...products.shown.map((f) => f.from)]),
    new Set(products.shown.map((f) => f.to)),
  ];
  const columns = COLUMNS.map((c, i) => {
    const layer = data.layers[c.layer];
    const items = [...ids[i]].map((id) => {
      const v = layer.values[id];
      return { id, name: names.get(id) || id, value: v === undefined ? null : v, unit: layer.unit };
    });
    items.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));
    const k = VALUE_H / d3.max(summary.world[c.layer].values);
    return { ...c, layer, items, x: COL_X[i], extent: layoutColumn(items, k, MIN_NODE_H, GAP) };
  });
  const plotH = Math.max(MIN_PLOT_H, d3.max(columns, (c) => c.extent));
  const byId = columns.map((c) => new Map(c.items.map((d) => [d.id, d])));

  // One width scale for both groups and every year.
  const width = d3.scaleSqrt()
    .domain([0, d3.max(Object.values(summary.trade), (g) => g.max_flow)])
    .range([0.75, 14]);

  const svg = d3.select("#chart").append("svg")
    .attr("viewBox", `0 0 ${WIDTH} ${plotH + TOP + 10}`)
    .attr("role", "img")
    .attr("aria-label", `Oil network ${data.year}: production, refining and consumption with trade flows`);
  const plot = svg.append("g").attr("transform", `translate(0,${TOP})`);

  const link = d3.linkHorizontal().x((p) => p[0]).y((p) => p[1]);
  const flows = [
    ...crude.shown.map((f) => ({ ...f, group: "crude", a: 0, b: 1 })),
    ...products.shown.map((f) => ({ ...f, group: "products", a: 1, b: 2 })),
  ].sort((p, q) => q.kusd - p.kusd);

  plot.append("g").selectAll("path").data(flows).join("path")
    .attr("class", (f) => `link ${f.group}`)
    .attr("stroke-width", (f) => width(f.kusd))
    .attr("d", (f) => {
      const s = byId[f.a].get(f.from);
      const t = byId[f.b].get(f.to);
      return link({ source: [columns[f.a].x + NODE_W, s.y + s.h / 2], target: [columns[f.b].x, t.y + t.h / 2] });
    })
    .append("title")
    .text((f) => {
      const group = f.group === "crude" ? "Crude oil" : "Petroleum products";
      return `${group}: ${names.get(f.from) || f.from} → ${names.get(f.to) || f.to}\n` +
        `Value: ${fmtUsd(f.kusd)}\nQuantity: ${fmtTonnes(f.tonnes)}`;
    });

  columns.forEach((c, i) => {
    svg.append("text").attr("class", "col-title").attr("x", c.x + NODE_W / 2).attr("y", 22).text(c.title);
    svg.append("text").attr("class", "col-unit").attr("x", c.x + NODE_W / 2).attr("y", 38).text(`node height: ${c.layer.unit}`);
    const node = plot.append("g").selectAll("g").data(c.items).join("g")
      .attr("class", (d) => (d.value === null ? "node nodata" : "node"))
      .attr("transform", (d) => `translate(${c.x},${d.y})`);
    node.append("rect").attr("width", NODE_W).attr("height", (d) => d.h);
    node.append("text")
      .attr("x", i === 0 ? -6 : NODE_W + 6)
      .attr("y", (d) => d.h / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", i === 0 ? "end" : "start")
      .text((d) => (d.value === null ? `${d.name} (no data)` : d.name));
    node.append("title").text((d) => `${d.name}\n${c.title}: ${fmtValue(d.value, d.unit)}`);
  });

  // Which flows live between which columns.
  [[0, 1, "Crude oil trade →"], [1, 2, "Petroleum products trade →"]].forEach(([a, b, text]) => {
    svg.append("text").attr("class", "col-unit")
      .attr("x", (columns[a].x + columns[b].x + NODE_W) / 2).attr("y", 30).text(text);
  });

  const share = (c) => d3.sum(c.items, (d) => d.value ?? 0) / c.layer.world;
  const cov = d3.select("#coverage");
  cov.append("p").text(describe(crude, "Crude oil trade shown"));
  cov.append("p").text(describe(products, "Petroleum products trade shown"));
  cov.append("p").text(
    "Countries drawn are those at the ends of these flows: " +
    `${columns[0].items.length} producers (${pct(share(columns[0]))} of world production), ` +
    `${columns[1].items.length} refiners or importers (${pct(share(columns[1]))} of reported throughput), ` +
    `${columns[2].items.length} consumers (${pct(share(columns[2]))} of world consumption).`);
}

// Small multiples: world totals over all years, the chosen year marked. Each has its own unit and a zero baseline.
function drawWorld(year) {
  const charts = [
    { title: "World crude oil production", unit: "kb/d", values: summary.world.production.values, fmt: (v) => `${int(v)} kb/d` },
    { title: "World petroleum consumption", unit: "kb/d", values: summary.world.consumption.values, fmt: (v) => `${int(v)} kb/d` },
    { title: "World crude oil trade value", unit: "nominal US$", values: summary.trade.crude.total, fmt: fmtUsdShort },
    { title: "World petroleum products trade value", unit: "nominal US$", values: summary.trade.products.total, fmt: fmtUsdShort },
  ];
  const W = 260, H = 120, pad = { l: 8, r: 8, t: 8, b: 20 };
  const x = d3.scaleLinear().domain(d3.extent(years)).range([pad.l, W - pad.r]);
  const root = d3.select("#world").selectAll("figure").data(charts).join("figure");
  root.append("figcaption").text((c) => `${c.title} (${c.unit})`);
  const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("class", "mini");
  svg.each(function (c) {
    const g = d3.select(this);
    const y = d3.scaleLinear().domain([0, d3.max(c.values)]).range([H - pad.b, pad.t]);
    g.append("line").attr("class", "axis").attr("x1", pad.l).attr("x2", W - pad.r).attr("y1", y(0)).attr("y2", y(0));
    g.append("path").attr("class", "series")
      .attr("d", d3.line().x((_, i) => x(years[i])).y((v) => y(v))(c.values));
    const i = years.indexOf(year);
    g.append("line").attr("class", "marker").attr("x1", x(year)).attr("x2", x(year)).attr("y1", pad.t).attr("y2", y(0));
    g.append("circle").attr("class", "marker").attr("cx", x(year)).attr("cy", y(c.values[i])).attr("r", 3.5);
    g.append("text").attr("class", "tick").attr("x", pad.l).attr("y", H - 6).text(years[0]);
    g.append("text").attr("class", "tick").attr("x", W - pad.r).attr("y", H - 6).attr("text-anchor", "end").text(years[years.length - 1]);
  });
  root.append("p").attr("class", "chosen").text((c) => `${year}: ${c.fmt(c.values[years.indexOf(year)])}`);
}

function list(parent, title, rows) {
  const section = parent.append("div");
  section.append("h4").text(title);
  const ul = section.append("ul");
  if (!rows.length) ul.append("li").text("none");
  rows.forEach((r) => ul.append("li").text(r));
  return section;
}

function drawMoves(data, prev) {
  const root = d3.select("#moves");
  if (!prev) {
    root.append("p").text(`${data.year} is the first year in the data, so there is no year before it to compare with.`);
    return;
  }
  root.append("p").attr("class", "lead").text(`${data.year} compared with ${prev.year}.`);
  const names = new Map([...prev.nodes, ...data.nodes].map((n) => [n.id, n.name]));
  const change = (m) => `${m.name} ${d3.format("+,.0f")(m.delta)} kb/d (${int(m.from)} → ${int(m.to)})`;
  const grid = root.append("div").attr("class", "moves-grid");
  for (const [layer, label] of [["production", "Crude oil production"], ["consumption", "Petroleum consumption"]]) {
    const m = biggestMoves(prev.layers[layer].values, data.layers[layer].values, names, MOVES_SHOWN);
    list(grid, `${label}: largest rises`, m.risers.map(change));
    list(grid, `${label}: largest falls`, m.fallers.map(change));
  }
  for (const [group, label] of [["crude", "crude oil"], ["products", "petroleum products"]]) {
    const rows = shareMoves(prev.trade[group], data.trade[group], MOVES_SHOWN).map((m) =>
      `${names.get(m.from) || m.from} → ${names.get(m.to) || m.to}: ${pct1(m.before)} → ${pct1(m.after)} (${d3.format("+.2f")(m.delta * 100)} points)`);
    list(grid, `Trade flows whose share of world ${label} trade value changed most`, rows);
  }
}

function render(data, prev) {
  d3.select("#error").attr("hidden", "");
  for (const id of ["#chart", "#coverage", "#world", "#moves"]) d3.select(id).selectAll("*").remove();
  d3.select("#subtitle").text(`${data.year}: crude oil production → refining → consumption, with trade flows between countries.`);
  drawGraph(data);
  drawWorld(data.year);
  drawMoves(data, prev);
}

async function show(year) {
  const request = ++latestRequest;
  d3.select("#year").property("value", year);
  d3.select("#year-out").text(year);
  try {
    const [data, prev] = await Promise.all([
      loadYear(year),
      years.includes(year - 1) ? loadYear(year - 1) : Promise.resolve(null),
    ]);
    if (request !== latestRequest) return; // the slider moved on
    render(data, prev);
    history.replaceState(null, "", `#${year}`);
  } catch (e) {
    if (request === latestRequest) fail(`Could not load the data for ${year} (${e.message}).`);
  }
}

function yearFromHash() {
  const y = Number(location.hash.slice(1));
  return years.includes(y) ? y : null;
}

async function main() {
  try {
    [{ years }, summary] = await Promise.all([getJson("data/index.json"), getJson("data/summary.json")]);
  } catch (e) {
    fail(`Could not load the data (${e.message}). This page must be served over HTTP, for example: python3 -m http.server -d docs`);
    return;
  }
  const slider = d3.select("#year")
    .attr("min", d3.min(years)).attr("max", d3.max(years)).attr("step", 1).attr("disabled", null);
  slider.on("input", () => show(Number(slider.property("value"))));
  window.addEventListener("hashchange", () => {
    const y = yearFromHash();
    if (y !== null) show(y);
  });
  show(yearFromHash() ?? d3.max(years));
}

main();
