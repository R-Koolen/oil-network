"use strict";

// Line charts and the country panel. DOM only; the numbers come from compute.js and the data files.
// Defines the global OilPanel.
(function () {
  const int = d3.format(",.0f");
  const pct = d3.format(".0%");
  const usd = (kusd) => `US$${d3.format(",.1f")(kusd / 1e6)} billion`;
  const signedUsd = (kusd) => `${kusd < 0 ? "−" : "+"}${usd(Math.abs(kusd))}`;

  // Source gaps worth saying out loud where they apply: country id -> why its numbers need care.
  const CAVEATS = {
    TWN: "BACI's “Other Asia, nes” is counted as Taiwan here and seems to include trade that is not Taiwan's. " +
      "For example, Iran appears as its largest crude supplier in 2020–2022, under sanctions.",
  };

  const W = 260, H = 120, PAD = { l: 8, r: 8, t: 16, b: 20 };

  // Draws lines on a zero baseline into an svg selection. `lines` is [{values, cls}] aligned with `years`; a null value
  // is a gap, never zero. Every real point gets a dot, so a lone point between gaps still shows.
  function lineChart(svg, years, lines, year, fmtMax) {
    const x = d3.scaleLinear().domain(d3.extent(years)).range([PAD.l, W - PAD.r]);
    const max = d3.max(lines, (l) => d3.max(l.values, (v) => v)) || 0;
    const y = d3.scaleLinear().domain([0, max || 1]).range([H - PAD.b, PAD.t]);
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("class", "mini");
    svg.append("line").attr("class", "axis").attr("x1", PAD.l).attr("x2", W - PAD.r).attr("y1", y(0)).attr("y2", y(0));
    const i = years.indexOf(year);
    svg.append("line").attr("class", "marker").attr("x1", x(year)).attr("x2", x(year)).attr("y1", PAD.t).attr("y2", y(0));
    for (const l of lines) {
      svg.append("path").attr("class", `series ${l.cls}`)
        .attr("d", d3.line().defined((v) => v !== null).x((_, k) => x(years[k])).y((v) => y(v))(l.values));
      svg.append("g").selectAll("circle").data(l.values.map((v, k) => [v, k]).filter(([v]) => v !== null))
        .join("circle").attr("class", `dot ${l.cls}`).attr("cx", ([, k]) => x(years[k])).attr("cy", ([v]) => y(v)).attr("r", 1.8);
      if (l.values[i] !== null) {
        svg.append("circle").attr("class", "marker").attr("cx", x(year)).attr("cy", y(l.values[i])).attr("r", 3.5);
      }
    }
    svg.append("text").attr("class", "tick").attr("x", PAD.l).attr("y", 10).text(max ? `max ${fmtMax(max)}` : "");
    svg.append("text").attr("class", "tick").attr("x", PAD.l).attr("y", H - 6).text(years[0]);
    svg.append("text").attr("class", "tick").attr("x", W - PAD.r).attr("y", H - 6).attr("text-anchor", "end").text(years[years.length - 1]);
  }

  function figure(parent, caption) {
    const fig = parent.append("figure");
    fig.append("figcaption").text(caption);
    return { fig, svg: fig.append("svg") };
  }

  function list(parent, title, rows, names) {
    const div = parent.append("div");
    div.append("h4").text(title);
    const ul = div.append("ul");
    if (!rows.length) ul.append("li").text("none listed");
    rows.forEach((r) => ul.append("li").text(`${names.get(r.id) || r.id}: ${pct(r.share)} (${usd(r.kusd)})`));
  }

  function tradeSection(root, ctx) {
    const names = new Map(ctx.data.nodes.map((n) => [n.id, n.name]));
    root.append("h3").text(`Trade partners in ${ctx.year}`);
    for (const [group, label, from, to] of [["crude", "Crude oil", "suppliers", "buyers"], ["products", "Petroleum products", "suppliers", "buyers"]]) {
      const t = OilCompute.partners(ctx.data.trade[group], ctx.id, ctx.partnerCount);
      const block = root.append("div").attr("class", "trade");
      if (!t.imports.count && !t.exports.count) {
        block.append("p").text(`${label}: no flows listed for ${ctx.name} in ${ctx.year}.`);
        continue;
      }
      block.append("p").attr("class", "lead").text(
        `${label}: imports ${usd(t.imports.total)} (${t.imports.count} flows), exports ${usd(t.exports.total)} ` +
        `(${t.exports.count} flows), net exports ${signedUsd(t.net)}.`);
      const grid = block.append("div").attr("class", "partners");
      list(grid, `Largest ${from}`, t.imports.top, names);
      list(grid, `Largest ${to}`, t.exports.top, names);
    }
    root.append("p").attr("class", "hint").text(
      "Partners and values are BACI as published, in nominal US dollars; tonnes are not used. " +
      "A flow can be missing from the source for a single year: that is a gap in the data, not a real stop.");
  }

  // ctx: {id, name, year, years, series (a countries.json entry, or null while loading, undefined if unavailable),
  //       data (the year file), drawn (is the country in the graph), partnerCount}
  function drawCountry(root, ctx) {
    root.selectAll("*").remove();
    root.append("h2").text(`${ctx.name}`);
    if (!ctx.drawn) {
      root.append("p").attr("class", "notice").text(
        `${ctx.name} is not drawn in the graph for ${ctx.year}: none of its flows is among the largest ` +
        "crude and product flows shown (the page says how many above the graph).");
    }
    if (CAVEATS[ctx.id]) root.append("p").attr("class", "notice").text(CAVEATS[ctx.id]);

    const charts = root.append("div").attr("class", "country-charts");
    const s = ctx.series;
    if (!s) {
      charts.append("p").attr("class", "hint").text(s === null ? "Loading the history…" : "The history could not be loaded.");
    } else {
      const i = ctx.years.indexOf(ctx.year);
      const at = (values, fmt) => (values[i] === null ? "no data" : fmt(values[i]));
      const kbd = (v) => `${int(v)} kb/d`, kty = (v) => `${int(v)} kt/yr`;
      const specs = [
        { title: "Crude oil production (kb/d)", lines: [{ values: s.production, cls: "a" }], fmt: kbd,
          chosen: () => at(s.production, kbd) },
        { title: "Refining (kt/yr): solid throughput, dashed capacity",
          lines: [{ values: s.refining_throughput, cls: "a" }, { values: s.refining_capacity, cls: "b" }], fmt: kty,
          chosen: () => `throughput ${at(s.refining_throughput, kty)}, capacity ${at(s.refining_capacity, kty)}` },
        { title: "Petroleum consumption (kb/d)", lines: [{ values: s.consumption, cls: "a" }], fmt: kbd,
          chosen: () => at(s.consumption, kbd) },
        { title: "Crude oil trade (nominal US$): solid imports, dashed exports",
          lines: [{ values: s.crude.imports, cls: "a" }, { values: s.crude.exports, cls: "b" }], fmt: (v) => usd(v),
          chosen: () => `imports ${at(s.crude.imports, usd)}, exports ${at(s.crude.exports, usd)}` },
        { title: "Petroleum products trade (nominal US$): solid imports, dashed exports",
          lines: [{ values: s.products.imports, cls: "a" }, { values: s.products.exports, cls: "b" }], fmt: (v) => usd(v),
          chosen: () => `imports ${at(s.products.imports, usd)}, exports ${at(s.products.exports, usd)}` },
      ];
      for (const spec of specs) {
        const { fig, svg } = figure(charts, spec.title);
        lineChart(svg, ctx.years, spec.lines, ctx.year, spec.fmt);
        fig.append("p").attr("class", "chosen").text(`${ctx.year}: ${spec.chosen()}`);
      }
    }
    tradeSection(root.append("div").attr("class", "trade-year"), ctx);
  }

  globalThis.OilPanel = { lineChart, drawCountry };
})();
