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

  // The flows whose share of the year's world trade value changed most. Shares, not USD, so the
  // oil price doesn't drive the ranking. A flow absent in one year has a share of 0 that year.
  function shareMoves(prevFlows, curFlows, n) {
    const prevTotal = sum(prevFlows, (f) => f.kusd);
    const curTotal = sum(curFlows, (f) => f.kusd);
    const rows = new Map();
    for (const f of prevFlows) rows.set(`${f.from}>${f.to}`, { from: f.from, to: f.to, before: f.kusd / prevTotal, after: 0 });
    for (const f of curFlows) {
      const key = `${f.from}>${f.to}`;
      const row = rows.get(key) || { from: f.from, to: f.to, before: 0, after: 0 };
      row.after = f.kusd / curTotal;
      rows.set(key, row);
    }
    return [...rows.values()]
      .map((r) => ({ ...r, delta: r.after - r.before }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.from + a.to).localeCompare(b.from + b.to))
      .slice(0, n);
  }

  const api = { topFlows, layoutColumn, biggestMoves, shareMoves };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.OilCompute = api;
})();
