"use strict";

// Slice 02: the oil network for one year (the latest in data/index.json).
// Everything is loaded from this site; styling lives in style.css (CSP allows no inline style).

const TOP_CRUDE_FLOWS = 60;
const TOP_PRODUCT_FLOWS = 60;

const WIDTH = 1100;
const NODE_W = 12;
const COL_X = [170, 550, 930];
const TOP = 70;
const GAP = 4;
const MIN_NODE_H = 10;
// Height shared out by value on top of what the tallest column needs for its floors and gaps.
// Without it the longest column has no spare height and every node falls to the floor.
const VALUE_H = 400;

const COLUMNS = [
  { layer: "production", title: "Crude oil production" },
  { layer: "refining_throughput", title: "Refining (crude processed)" },
  { layer: "consumption", title: "Petroleum consumption" },
];

const int = d3.format(",.0f");
const pct = d3.format(".0%");

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

function topFlows(flows, n) {
  const sorted = flows.slice().sort((a, b) => b.kusd - a.kusd);
  const shown = sorted.slice(0, n);
  const sum = (list) => d3.sum(list, (f) => f.kusd);
  return { shown, total: flows.length, share: sum(shown) / sum(flows), shownKusd: sum(shown), allKusd: sum(flows) };
}

// Heights are proportional to value within the column; small values are held at a floor so every node has a label.
function layoutColumn(items, plotH) {
  const flexible = items.filter((d) => d.value > 0);
  const fixed = new Set(items.filter((d) => !(d.value > 0)));
  let k = 0;
  for (let i = 0; i < flexible.length + 1; i++) {
    const rest = flexible.filter((d) => !fixed.has(d));
    k = (plotH - GAP * (items.length - 1) - MIN_NODE_H * fixed.size) / d3.sum(rest, (d) => d.value);
    const small = rest.filter((d) => d.value * k < MIN_NODE_H);
    if (!small.length) break;
    small.forEach((d) => fixed.add(d));
  }
  let y = 0;
  for (const d of items) {
    d.h = fixed.has(d) ? MIN_NODE_H : d.value * k;
    d.y = y;
    y += d.h + GAP;
  }
  return y - GAP;
}

function describe(summary, label) {
  return `${label}: the ${d3.format(",")(summary.shown.length)} largest flows by value, ` +
    `${pct(summary.share)} of world value (${fmtUsdShort(summary.shownKusd)} of ${fmtUsdShort(summary.allKusd)}; ` +
    `${d3.format(",")(summary.shown.length)} of ${d3.format(",")(summary.total)} flows).`;
}

function draw(data) {
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
    return { ...c, layer, items, x: COL_X[i] };
  });

  const plotH = d3.max(columns, (c) => c.items.length) * (MIN_NODE_H + GAP) - GAP + VALUE_H;
  columns.forEach((c) => layoutColumn(c.items, plotH));
  const byId = columns.map((c) => new Map(c.items.map((d) => [d.id, d])));

  const width = d3.scaleSqrt()
    .domain([0, d3.max([...crude.shown, ...products.shown], (f) => f.kusd)])
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
    svg.append("text").attr("class", "col-unit").attr("x", c.x + NODE_W / 2).attr("y", 38).text(`node size: ${c.layer.unit}`);
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

  d3.select("#subtitle").text(
    `${data.year}: crude oil production → refining → consumption, with trade flows between countries.`);

  const share = (c, i) => d3.sum(c.items, (d) => d.value ?? 0) / c.layer.world;
  const cov = d3.select("#coverage");
  cov.append("p").text(describe(crude, "Crude oil trade shown"));
  cov.append("p").text(describe(products, "Petroleum products trade shown"));
  cov.append("p").text(
    "Countries drawn are those at the ends of these flows: " +
    `${columns[0].items.length} producers (${pct(share(columns[0]))} of world production), ` +
    `${columns[1].items.length} refiners or importers (${pct(share(columns[1]))} of reported throughput), ` +
    `${columns[2].items.length} consumers (${pct(share(columns[2]))} of world consumption).`);
}

async function load() {
  const get = async (path) => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  try {
    const index = await get("data/index.json");
    draw(await get(`data/${d3.max(index.years)}.json`));
  } catch (e) {
    fail(`Could not load the data (${e.message}). This page must be served over HTTP, for example: python3 -m http.server -d docs`);
  }
}

load();
