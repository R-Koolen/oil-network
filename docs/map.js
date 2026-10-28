"use strict";

// The world map: country shading, trade lines and end markers. DOM only; the numbers come from the caller.
// Defines the global OilMap. Needs d3 and topojson-client.
(function () {
  const W = 760;
  const int = d3.format(",.0f");
  const ramp = d3.interpolateYlOrBr;

  // Legend for a sqrt colour scale from 0 to max: a gradient bar with ticks at powers of ten, and a "no data" swatch.
  function drawLegend(root, shade) {
    root.selectAll("*").remove();
    const w = 320, h = 44, x0 = 6, bar = 220;
    const svg = root.append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("class", "legend");
    if (!shade || shade.max === null) {
      svg.append("text").attr("class", "tick").attr("x", x0).attr("y", 14).text(shade ? "Loading the colour scale…" : "Shading is off");
      return;
    }
    const grad = svg.append("defs").append("linearGradient").attr("id", "shade-ramp");
    d3.range(0, 1.0001, 0.1).forEach((t) => grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", ramp(t)));
    svg.append("text").attr("class", "tick").attr("x", x0).attr("y", 9).text(`${shade.label} (${shade.unit}), same scale in every year`);
    svg.append("rect").attr("x", x0).attr("y", 14).attr("width", bar).attr("height", 8).attr("fill", "url(#shade-ramp)");
    const pos = (v) => x0 + bar * Math.sqrt(v / shade.max);
    const ticks = [0];
    for (let t = Math.pow(10, Math.ceil(Math.log10(shade.max / 300))); t <= shade.max; t *= 10) ticks.push(t);
    ticks.forEach((v) => {
      svg.append("line").attr("class", "axis").attr("x1", pos(v)).attr("x2", pos(v)).attr("y1", 22).attr("y2", 26);
      svg.append("text").attr("class", "tick").attr("x", pos(v)).attr("y", 36).attr("text-anchor", "middle").text(d3.format(",")(v));
    });
    svg.append("rect").attr("class", "country nodata").attr("x", x0 + bar + 22).attr("y", 14).attr("width", 12).attr("height", 8);
    svg.append("text").attr("class", "tick").attr("x", x0 + bar + 38).attr("y", 22).text("no data");
  }

  // root: where the map goes; legendRoot: where the legend goes; onSelect(id): a country or marker was clicked.
  function create(root, legendRoot, mapData, onSelect) {
    const topo = mapData.topology;
    const features = topojson.feature(topo, topo.objects.countries).features;
    const sphere = { type: "Sphere" };
    const projection = d3.geoEqualEarth().fitWidth(W, sphere);
    const path = d3.geoPath(projection);
    const height = Math.ceil(path.bounds(sphere)[1][1]);
    const svg = root.append("svg").attr("viewBox", `-2 -2 ${W + 4} ${height + 4}`)
      .attr("role", "img").attr("aria-label", "World map: trade flows and country shading");
    svg.append("path").attr("class", "sphere").attr("d", path(sphere));
    const land = svg.append("g").selectAll("path").data(features).join("path")
      .attr("class", "country").attr("d", path)
      .on("click", function (_, d) { if (d.id && !d3.select(this).classed("inert")) onSelect(d.id); });
    // Great circles, except a flow over the date line: the map is cut there, so it is drawn as a straight line in
    // longitude and latitude (OilCompute.wrapLine) that leaves one edge and enters the other at the same height.
    const line = d3.line();
    const flowPath = (f) => {
      const runs = OilCompute.wrapLine(f.a, f.b, 48);
      if (runs.length === 1) return path({ type: "LineString", coordinates: [f.a, f.b] });
      return runs.map((r) => line(r.map(projection))).join("");
    };
    const flowLayer = svg.append("g");
    const endLayer = svg.append("g");

    // s: {names, flows, anchors, showFlows, shade ({values, max, label, unit} | null), width}
    function update(s) {
      const color = s.shade && s.shade.max !== null
        ? (v) => ramp(Math.sqrt(Math.min(v, s.shade.max) / s.shade.max))
        : null;
      land.each(function (d) {
        const el = d3.select(this);
        // a shape the data has nothing for (Isle of Man, South Georgia, ...) is plain land that cannot be selected
        el.classed("inert", !d.id || (s.selectable !== null && !s.selectable.has(d.id)));
        const v = color && d.id ? s.shade.values[d.id] : undefined;
        el.classed("plain", !color || !d.id).classed("nodata", !!color && (!d.id || v === undefined));
        if (color && d.id && v !== undefined) el.attr("fill", color(v)); else el.attr("fill", null);
        el.select("title").remove();
        if (d.id && !el.classed("inert")) {
          const name = s.names.get(d.id) || d.id;
          el.append("title").text(color ? `${name}\n${s.shade.label}: ${v === undefined ? "no data" : `${int(v)} ${s.shade.unit}`}` : name);
        }
      });
      flowLayer.selectAll("*").remove();
      endLayer.selectAll("*").remove();
      drawLegend(legendRoot, s.shade);
      const { lines, missing } = OilCompute.mapLines(s.flows, s.anchors);
      if (s.showFlows) {
        flowLayer.selectAll("path").data(lines).join("path")
          .attr("class", (f) => `link ${f.group}`)
          .attr("stroke-width", (f) => s.width(f.kusd))
          .attr("d", flowPath)
          .append("title").text(s.flowTitle);
        const ends = [...new Set(lines.flatMap((f) => [f.from, f.to]))];
        endLayer.selectAll("circle").data(ends).join("circle")
          .attr("class", "end").attr("r", 2.6)
          .attr("cx", (id) => projection(s.anchors[id])[0]).attr("cy", (id) => projection(s.anchors[id])[1])
          .on("click", (_, id) => onSelect(id))
          .append("title").text((id) => s.names.get(id) || id);
      }
      return { drawn: lines.length, missing };
    }

    function highlight(sel) {
      land.classed("selected", (d) => sel !== null && d.id === sel);
      endLayer.selectAll(".end").classed("selected", (id) => id === sel);
      flowLayer.selectAll(".link")
        .classed("dim", (f) => sel !== null && f.from !== sel && f.to !== sel)
        .classed("focus", (f) => sel !== null && (f.from === sel || f.to === sel));
    }

    return { update, highlight };
  }

  globalThis.OilMap = { create };
})();
