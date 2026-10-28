"use strict";

// The oil network for the year picked on the slider. Calculations are in compute.js (OilCompute).
// Everything is loaded from this site; styling lives in style.css (CSP allows no inline style).

const { topFlows, layoutColumn, spreadEnds, biggestMoves, parseHash, formatHash, createSelection } = OilCompute;

const TOP_CRUDE_FLOWS = 60;
const TOP_PRODUCT_FLOWS = 60;
const MOVES_SHOWN = 3;
const PARTNERS_SHOWN = 5;

// The graph is drawn at the width it gets (no scaling, so labels keep their size). On a phone it shows one stage at
// a time, two columns, chosen with the "stage" buttons.
const NODE_W = 12;
const NARROW = window.matchMedia("(max-width: 700px)");
let stage = "crude";
const TOP = 70;
const GAP = 4;
const MIN_NODE_H = 10;
// Node height = value * k, with k fixed per column: VALUE_H pixels for the biggest world total in any year.
// Shown countries are always a part of the world, so a column fits in any year.
const VALUE_H = 600;
// Tall enough for every column in 2013–2023 (the tallest is 726), so the graph keeps its height on the slider.
const MIN_PLOT_H = 730;

const COLUMNS = [
  { layer: "production", title: "Crude oil production", short: "Production" },
  { layer: "refining_throughput", title: "Refining (crude processed)", short: "Refining", also: { layer: "refining_capacity", label: "Refining capacity" } },
  { layer: "consumption", title: "Petroleum consumption", short: "Consumption" },
];

const int = d3.format(",.0f");
const pct = d3.format(".0%");

const cache = new Map(); // year -> Promise of that year's data, so each file is fetched once
let summary = null;
let years = [];
let latestRequest = 0;
let lineWidth = null; // one US$ -> pixels scale for both groups, every year, graph and map

// The map (map.json) loads after the first draw; `shadeMeasures` are the layers the map can be shaded by.
const shadeMeasures = {
  production: { label: "Crude oil production", unit: "kb/d", hue: "production" },
  consumption: { label: "Petroleum consumption", unit: "kb/d", hue: "consumption" },
  refining_throughput: { label: "Refining throughput", unit: "kt/yr", hue: "refining" },
};
let mapView = null;
let mapData = null;
let mapPromise = null;

const selection = createSelection(); // the selected country id, or null
let countriesFile = null; // docs/data/countries.json once loaded; null until then, false if it failed
let countriesPromise = null;
let current = null; // what is on screen: {data, prev, drawn}

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

function flowTitle(f, names) {
  const group = f.group === "crude" ? "Crude oil" : "Petroleum products";
  return `${group}: ${names.get(f.from) || f.from} → ${names.get(f.to) || f.to}\n` +
    `Value: ${fmtUsd(f.kusd)}\nQuantity: ${fmtTonnes(f.tonnes)}`;
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
    return { ...c, key: c.layer, layer, items, extent: layoutColumn(items, k, MIN_NODE_H, GAP) };
  });
  const shown = !NARROW.matches ? [0, 1, 2] : stage === "crude" ? [0, 1] : [1, 2];
  const W = Math.max(320, Math.floor(document.querySelector("#chart").clientWidth));
  const L = NARROW.matches ? 128 : 150, R = NARROW.matches ? 112 : 140;
  const plotH = Math.max(MIN_PLOT_H, d3.max(columns, (c) => c.extent));
  const byId = columns.map((c) => new Map(c.items.map((d) => [d.id, d])));

  const svg = d3.select("#chart").append("svg")
    .attr("viewBox", `0 0 ${W} ${plotH + TOP + 10}`)
    .attr("role", "img")
    .attr("aria-label", `Oil network ${data.year}: production, refining and consumption with trade flows`);

  // With all three columns the middle column's labels sit where the product lines leave it. Those lines run straight
  // from their own point on the node to the end of the widest label (bold, as when selected) and curve after that,
  // so every line visibly starts at its own country. The middle column is placed to leave room for that and a curve.
  const threeColumns = shown.length === 3;
  let gutter = 0;
  if (threeColumns) {
    const probe = svg.append("g").attr("class", "node").append("text").attr("class", "measure-bold");
    gutter = NODE_W + 6 + d3.max(columns[1].items, (d) => probe.text(d.value === null ? `${d.name} (no data)` : d.name).node().getComputedTextLength()) + 8;
    probe.node().parentNode.remove();
  }
  const x0 = L, x2 = W - R - NODE_W;
  shown.forEach((ci, k) => { columns[ci].x = x0 + ((x2 - x0) * k) / (shown.length - 1); });
  if (threeColumns) columns[1].x = Math.max(x0 + 170, Math.min(columns[1].x, x2 - gutter - Math.max(80, (x2 - x0) * 0.2)));
  const plot = svg.append("g").attr("transform", `translate(0,${TOP})`);

  const link = d3.linkHorizontal().x((p) => p[0]).y((p) => p[1]);
  const flows = [
    ...crude.shown.map((f) => ({ ...f, group: "crude", a: 0, b: 1 })),
    ...products.shown.map((f) => ({ ...f, group: "products", a: 1, b: 2 })),
  ].filter((f) => shown.includes(f.a) && shown.includes(f.b)).sort((p, q) => q.kusd - p.kusd);

  const centre = (d) => d.y + d.h / 2;
  const ends = (side) => flows.map((f) => {
    const s = byId[f.a].get(f.from), t = byId[f.b].get(f.to);
    return side === "out" ? { node: s, other: centre(t) } : { node: t, other: centre(s) };
  });
  const y0 = spreadEnds(ends("out")), y1 = spreadEnds(ends("in"));

  plot.append("g").selectAll("path").data(flows).join("path")
    .attr("class", (f) => `link ${f.group}`)
    .attr("stroke-width", (f) => lineWidth(f.kusd))
    .attr("d", (f, i) => {
      const sx = columns[f.a].x + NODE_W, tx = columns[f.b].x;
      if (!(threeColumns && f.a === 1)) return link({ source: [sx, y0[i]], target: [tx, y1[i]] });
      const gx = columns[1].x + gutter, mid = (gx + tx) / 2;
      return `M${sx},${y0[i]}H${gx}C${mid},${y0[i]} ${mid},${y1[i]} ${tx},${y1[i]}`;
    })
    .append("title")
    .text((f) => flowTitle(f, names));

  shown.map((ci) => columns[ci]).forEach((c, i) => {
    svg.append("text").attr("class", "col-title").attr("x", c.x + NODE_W / 2).attr("y", 22).text(NARROW.matches ? c.short : c.title);
    svg.append("text").attr("class", "col-unit").attr("x", c.x + NODE_W / 2).attr("y", 38).text(`node height: ${c.layer.unit}`);
    const node = plot.append("g").selectAll("g").data(c.items).join("g")
      .attr("class", (d) => `node ${c.key}${d.value === null ? " nodata" : ""}`)
      .attr("transform", (d) => `translate(${c.x},${d.y})`);
    node.append("rect").attr("width", NODE_W).attr("height", (d) => d.h);
    node.append("text")
      .attr("x", i === 0 ? -6 : NODE_W + 6)
      .attr("y", (d) => d.h / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", i === 0 ? "end" : "start")
      .text((d) => (d.value === null ? `${d.name} (no data)` : d.name));
    // Lines leave the middle column where its labels are: an opaque plate behind each label (fitPlates) keeps it readable.
    if (shown.length === 3 && i === 1) node.insert("rect", "text").attr("class", "plate").attr("rx", 2);
    const also = c.also && data.layers[c.also.layer];
    node.append("title").text((d) => `${d.name}\n${c.title}: ${fmtValue(d.value, d.unit)}` +
      (also ? `\n${c.also.label}: ${fmtValue(also.values[d.id] ?? null, also.unit)}` : ""));
    node.on("click", (_, d) => selection.set(selection.get() === d.id ? null : d.id));
  });

  // Which flows live between which columns.
  [[0, 1, "crude oil trade"], [1, 2, "petroleum products trade"]].filter(([a, b]) => shown.includes(a) && shown.includes(b)).forEach(([a, b, text]) => {
    svg.append("text").attr("class", "col-flow")
      .attr("x", (columns[a].x + columns[b].x + NODE_W) / 2).attr("y", 58).text(text);
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
  return {
    drawn: new Set(columns.flatMap((c) => c.items.map((d) => d.id))),
    flows: [...crude.shown.map((f) => ({ ...f, group: "crude" })), ...products.shown.map((f) => ({ ...f, group: "products" }))]
      .sort((p, q) => q.kusd - p.kusd),
  };
}

// The key under the graph: the two line colours, and line widths for a few US$ values on the shared scale.
function drawKey() {
  const narrow = NARROW.matches;
  d3.select("#key").selectAll("*").remove();
  const svg = d3.select("#key").append("svg").attr("viewBox", narrow ? "0 0 360 98" : "0 0 700 46")
    .attr("role", "img").attr("aria-label", "Key: line colour is the kind of trade, line width is its value in US dollars");
  [["crude", "Crude oil"], ["products", "Petroleum products"]].forEach(([cls, label], i) => {
    const g = svg.append("g").attr("transform", `translate(0,${12 + i * 22})`);
    g.append("line").attr("class", `swatch ${cls}`).attr("x1", 0).attr("x2", 26).attr("stroke-width", 5);
    g.append("text").attr("x", 34).attr("dy", "0.35em").text(label);
  });
  const [hx, hy] = narrow ? [0, 56] : [190, 12];
  svg.append("text").attr("class", "head").attr("x", hx).attr("y", hy).attr("dy", "0.35em").text("Line width: trade value, nominal US$");
  [1e6, 1e7, 5e7, 1e8].forEach((kusd, i) => { // thousand US$: 1e6 is a billion
    const x = narrow ? (i % 2) * 180 : 190 + i * 128, y = narrow ? 76 + Math.floor(i / 2) * 18 : 34;
    svg.append("line").attr("class", "swatch width").attr("x1", x).attr("x2", x + 30).attr("y1", y).attr("y2", y)
      .attr("stroke-width", lineWidth(kusd));
    svg.append("text").attr("x", x + 36).attr("y", y).attr("dy", "0.35em").text(`US$${d3.format(",")(kusd / 1e6)} billion`);
  });
}

// Year labels under the slider. The slider's track is 16 px wider than this row, so 0% and 100% sit under the thumb.
function drawTicks() {
  const svg = d3.select("#year-ticks").append("svg");
  const g = svg.selectAll("g").data(years).join("g");
  const x = (y) => `${(100 * (y - years[0])) / (years[years.length - 1] - years[0])}%`;
  g.append("line").attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", 3);
  g.append("text").attr("x", x).attr("y", 14).text((y) => y);
}

// Small multiples: world totals over all years, the chosen year marked. Each has its own unit and a zero baseline.
function drawWorld(year) {
  const charts = [
    { title: "World crude oil production", unit: "kb/d", values: summary.world.production.values, fmt: (v) => `${int(v)} kb/d` },
    { title: "World petroleum consumption", unit: "kb/d", values: summary.world.consumption.values, fmt: (v) => `${int(v)} kb/d` },
    { title: "World crude oil trade value", unit: "nominal US$", values: summary.trade.crude.total, fmt: fmtUsdShort },
    { title: "World petroleum products trade value", unit: "nominal US$", values: summary.trade.products.total, fmt: fmtUsdShort },
  ];
  const root = d3.select("#world").selectAll("figure").data(charts).join("figure");
  root.append("figcaption").text((c) => `${c.title} (${c.unit})`);
  root.append("svg").each(function (c) {
    OilPanel.lineChart(d3.select(this), years, [{ values: c.values, cls: "a" }], year, c.fmt);
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
}

// Each plate is as wide as its label is now (the selected label is bold, so it is wider).
function fitPlates() {
  d3.selectAll("#chart .plate").each(function () {
    const b = d3.select(this.parentNode).select("text").node().getBBox();
    d3.select(this).attr("x", b.x - 2).attr("y", b.y).attr("width", b.width + 5).attr("height", b.height);
  });
}

function highlight() {
  const sel = selection.get();
  if (mapView) mapView.highlight(sel);
  d3.selectAll("#chart .node").classed("selected", (d) => d.id === sel);
  fitPlates();
  d3.selectAll("#chart .link")
    .classed("dim", (f) => sel !== null && f.from !== sel && f.to !== sel)
    .classed("focus", (f) => sel !== null && (f.from === sel || f.to === sel));
}

function drawPanel() {
  const root = d3.select("#country-panel");
  const sel = selection.get();
  root.attr("hidden", current === null ? "" : null);
  if (sel === null || current === null) {
    root.selectAll("*").remove();
    const p = root.append("p").attr("class", "empty");
    p.append("strong").text("Pick a country");
    p.append("span").text("Click it in the graph or on the map, or choose it from the list, to see its history and its trade partners.");
    return;
  }
  const names = new Map(current.data.nodes.map((n) => [n.id, n.name]));
  const entry = countriesFile ? countriesFile.countries[sel] : countriesFile;
  OilPanel.drawCountry(root, {
    id: sel,
    name: names.get(sel) || (entry && entry.name) || sel,
    year: current.data.year,
    years,
    series: entry, // null while the file loads, false if it could not be loaded, undefined if it lacks this country
    data: current.data,
    drawn: current.drawn.has(sel),
    partnerCount: PARTNERS_SHOWN,
  });
}

function syncHash() {
  if (current) history.replaceState(null, "", formatHash(current.data.year, selection.get()));
}

function syncSelect() {
  d3.select("#country").property("value", selection.get() ?? "");
  d3.select("#clear").attr("hidden", selection.get() === null ? "" : null);
}

function ensureCountries() {
  if (!countriesPromise) {
    countriesPromise = getJson("data/countries.json").then((file) => {
      countriesFile = file;
      const list = Object.entries(file.countries).sort((a, b) => a[1].name.localeCompare(b[1].name));
      d3.select("#country").attr("disabled", null).selectAll("option.country").data(list).join("option")
        .attr("class", "country").attr("value", ([id]) => id).text(([, c]) => c.name);
      if (selection.get() !== null && !(selection.get() in file.countries)) selection.set(null); // a stale link
      syncSelect();
      drawPanel();
      updateMap();
    }).catch(() => {
      countriesFile = false;
      d3.select("#country").attr("hidden", "");
      drawPanel();
    });
  }
  return countriesPromise;
}

function render(data, prev) {
  d3.select("#error").attr("hidden", "");
  for (const id of ["#chart", "#coverage", "#world", "#moves"]) d3.select(id).selectAll("*").remove();
  const graph = drawGraph(data);
  drawKey();
  current = { data, prev, drawn: graph.drawn, flows: graph.flows };
  drawWorld(data.year);
  drawMoves(data, prev);
  updateMap();
  highlight();
  drawPanel();
  syncHash();
  d3.selectAll("#year-ticks text").classed("on", (y) => y === data.year);
  ensureCountries(); // after the first draw, not before
  ensureMap();
}

// The map follows the slider, the selection and the checkboxes. Shading needs countries.json for its fixed colour scale.
function updateMap() {
  if (!mapView || !current) return;
  const measure = shadeMeasures[d3.select("#map-measure").property("value")];
  const layer = d3.select("#map-measure").property("value");
  const shadeOn = d3.select("#map-shade").property("checked");
  d3.select("#map-measure").property("disabled", !shadeOn);
  // year files lack a few small places in some years; countries.json has all their names
  const names = new Map(current.data.nodes.map((n) => [n.id, n.name]));
  if (countriesFile) for (const [id, c] of Object.entries(countriesFile.countries)) if (!names.has(id)) names.set(id, c.name);
  const result = mapView.update({
    names,
    flows: current.flows,
    anchors: mapData.anchors,
    selectable: countriesFile ? new Set(Object.keys(countriesFile.countries)) : null,
    showFlows: d3.select("#map-flows").property("checked"),
    shade: shadeOn
      ? { ...measure, values: current.data.layers[layer].values, max: countriesFile ? OilCompute.shadeMax(countriesFile.countries, layer) : null }
      : null,
    width: lineWidth,
    flowTitle: (f) => flowTitle(f, names),
  });
  d3.select("#map-note").text(result.missing ? `${result.missing} flows have no location on the map.` : "");
  mapView.highlight(selection.get());
}

function ensureMap() {
  if (!mapPromise) {
    mapPromise = getJson("data/map.json").then((file) => {
      mapData = file;
      mapView = OilMap.create(d3.select("#map"), d3.select("#legend"), file, (id) => selection.set(selection.get() === id ? null : id));
      updateMap();
    }).catch(() => d3.select("#map").text("The map could not be loaded."));
  }
  return mapPromise;
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
  } catch (e) {
    if (request === latestRequest) fail(`Could not load the data for ${year} (${e.message}).`);
  }
}

async function main() {
  try {
    [{ years }, summary] = await Promise.all([getJson("data/index.json"), getJson("data/summary.json")]);
  } catch (e) {
    fail(`Could not load the data (${e.message}). This page must be served over HTTP, for example: python3 -m http.server -d docs`);
    return;
  }
  lineWidth = d3.scaleSqrt() // one US$ width scale for both groups and every year
    .domain([0, d3.max(Object.values(summary.trade), (g) => g.max_flow)])
    .range([0.75, 14]);
  d3.select("#subtitle").text(
    "Where crude oil is produced, where it is refined and where petroleum is used, " +
    `with the largest trade flows between countries, ${years[0]}–${years[years.length - 1]}.`);
  drawTicks();
  for (const id of ["#map-flows", "#map-shade", "#map-measure"]) d3.select(id).on("change", updateMap);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateMap); // shading colours follow the theme
  // The graph is drawn for its width: draw it again when that changes, or when the phone's stage buttons change.
  let lastW = document.querySelector("#chart").clientWidth, timer = null;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const w = document.querySelector("#chart").clientWidth;
      if (w !== lastW && current) { lastW = w; render(current.data, current.prev); }
    }, 150);
  });
  d3.selectAll("#stage input").on("change", function () {
    stage = this.value;
    if (current) render(current.data, current.prev);
  });
  const slider = d3.select("#year")
    .attr("min", d3.min(years)).attr("max", d3.max(years)).attr("step", 1).attr("disabled", null); // enabled once the data is there
  slider.on("input", () => show(Number(slider.property("value"))));
  d3.select("#country").on("change", function () { selection.set(this.value || null); });
  d3.select("#clear").on("click", () => selection.set(null));
  selection.subscribe(() => {
    highlight();
    drawPanel();
    syncSelect();
    syncHash();
  });
  const start = parseHash(location.hash, years);
  window.addEventListener("hashchange", () => {
    const h = parseHash(location.hash, years);
    selection.set(h.country && (!countriesFile || h.country in countriesFile.countries) ? h.country : null);
    if (h.year !== null && (!current || h.year !== current.data.year)) show(h.year);
    else syncHash(); // an unknown year: put the address back to what is shown
  });
  selection.set(start.country);
  show(start.year ?? d3.max(years));
}

main();
