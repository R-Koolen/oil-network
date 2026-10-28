"use strict";

// Pure calculations for the page (no DOM), so tests can run them under node.
// In the browser this defines the global OilCompute; under node it is module.exports.
(function () {
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  // The n flows with the largest value, and what share of the year's value they hold.
  function topFlows(flows, n) {
    const shown = flows.slice().sort((a, b) => b.kusd - a.kusd).slice(0, n);
    const shownKusd = sum(shown, (f) => f.kusd);
    const allKusd = sum(flows, (f) => f.kusd);
    return { shown, total: flows.length, shownKusd, allKusd, share: shownKusd / allKusd };
  }

  // Stack nodes top to bottom. A value maps to the same height in every year: height = value * k,
  // held at `floor` so small values (and "no data") stay visible. Returns the column's height.
  function layoutColumn(items, k, floor, gap) {
    let y = 0;
    for (const d of items) {
      d.h = Math.max(floor, (d.value || 0) * k);
      d.y = y;
      y += d.h + gap;
    }
    return items.length ? y - gap : 0;
  }

  // Largest rises and falls of a layer's country values between two years (kb/d change).
  // A country missing in either year is left out: no number is not zero.
  function biggestMoves(prevValues, curValues, names, n) {
    const moves = Object.keys(curValues)
      .filter((id) => id in prevValues)
      .map((id) => ({ id, name: names.get(id) || id, from: prevValues[id], to: curValues[id], delta: curValues[id] - prevValues[id] }));
    return {
      risers: moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, n),
      fallers: moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, n),
    };
  }

  // One country's trade in one group for one year: totals as importer and exporter, net (exports minus imports),
  // and its n largest partners each way with their share of that total. kusd, as published by BACI.
  function partners(flows, id, n) {
    const side = (own, other) => {
      const rows = flows.filter((f) => f[own] === id);
      const total = sum(rows, (f) => f.kusd);
      const top = rows.map((f) => ({ id: f[other], kusd: f.kusd, share: f.kusd / total }))
        .sort((a, b) => b.kusd - a.kusd || a.id.localeCompare(b.id))
        .slice(0, n);
      return { total, count: rows.length, top };
    };
    const imports = side("to", "from");
    const exports = side("from", "to");
    return { imports, exports, net: exports.total - imports.total };
  }

  // "#2020/USA" -> {year: 2020, country: "USA"}; anything else gives null parts. The country is only checked for
  // its shape here; the page checks it against the list of countries.
  function parseHash(hash, years) {
    const m = /^#?(\d{4})(?:\/([A-Za-z0-9]{2,5}))?$/.exec(hash || "");
    if (!m) return { year: null, country: null };
    const year = Number(m[1]);
    return { year: years.includes(year) ? year : null, country: m[2] ? m[2].toUpperCase() : null };
  }

  function formatHash(year, country) {
    return `#${year}${country ? `/${country}` : ""}`;
  }

  // The selected country as one piece of state; the graph and the panel (and later the map) subscribe to it.
  function createSelection() {
    let current = null;
    const listeners = [];
    return {
      get: () => current,
      set(id) {
        if (id === current) return;
        current = id;
        listeners.forEach((fn) => fn(current));
      },
      subscribe: (fn) => listeners.push(fn),
    };
  }

  const api = { topFlows, layoutColumn, biggestMoves, partners, parseHash, formatHash, createSelection };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.OilCompute = api;
})();
