// Matchup page: batter clusters × pitcher clusters hot/cold chart, the
// "do similar batters react alike?" check, and a single-batter lookup.
//
// Everything is rebuilt from additive per-pair totals (data/matchups.json), so it
// follows the clusters live as the similarity weights are tuned.
//
// Vocabulary
//   rate      num / den for the chosen metric (e.g. xwOBA = xw / pa)
//   expected  what the batter's overall rate + the pitcher's overall rate − league
//             predicts for a pair, so a delta (observed − expected) is the
//             *matchup* effect with talent removed
//   shrink    delta × den / (den + k), or a blend toward a fallback, so small
//             samples fade toward "nothing to see" instead of looking hot/cold
import {
  applyModel, clusterColor, describeCluster,
  loadError, loadJSON, throttleFrame,
} from "./common.js";
import { mountTuner, onExternalChange } from "./settings.js";
import { buildModel } from "./similarity.js";

const METRICS = {
  xwoba: { label: "xwOBA", num: "xw", den: "pa", unit: "PA", k: 150, better: 1, scale: 1, dec: 3 },
  woba: { label: "wOBA", num: "w", den: "pa", unit: "PA", k: 250, better: 1, scale: 1, dec: 3 },
  rv100: { label: "Run value / 100 pitches", num: "rv", den: "n", unit: "pitches", k: 400, better: 1, scale: 100, dec: 2 },
  whiff: { label: "Whiff %", num: "wh", den: "sw", unit: "swings", k: 80, better: -1, scale: 100, dec: 1, pct: true },
  k: { label: "K %", num: "k", den: "pa", unit: "PA", k: 100, better: -1, scale: 100, dec: 1, pct: true },
};
const N_SHUFFLES = 10;       // random-batter baseline for the hypothesis check
const N_FACED = 20;          // rows in the "pitchers faced" table

// Diverging pair on the dark surface: blue (batter worse) ↔ gray ↔ red (batter better)
const COLD = [57, 135, 229], MID = [56, 56, 53], HOT = [230, 103, 103];

const ui = {
  metric: "xwoba", platoon: "all", mode: "expected", shrink: true,
  k: METRICS.xwoba.k, minDen: 40, batter: null, pitcher: null,
};

let P, B, pModel, bModel, pClusters, bClusters, pairs, M, agg, nbr;

// --- Load -----------------------------------------------------------------------
Promise.all(["data/pitchers.json", "data/batters.json", "data/matchups.json"].map(loadJSON))
  .then(init)
  .catch((err) => loadError(document.getElementById("matchups"), err));

function init([pData, bData, mu]) {
  P = pData; B = bData;
  document.getElementById("meta").textContent =
    `${mu.meta.season} · ${B.nodes.length} batters × ${P.nodes.length} pitchers · ${mu.pairs.length.toLocaleString()} pairs`;
  pairs = preparePairs(mu);

  const tunerBody = document.getElementById("tuner-body");
  const redraw = throttleFrame(() => { recomputeAll(); });
  const pt = mountTuner(tunerBody, { kind: "pitcher", title: "Pitcher similarity", data: P,
    onChange: (s) => { pModel = rebuildModel(P, s, "pitcher"); redraw(); } });
  const bt = mountTuner(tunerBody, { kind: "batter", title: "Batter similarity", data: B,
    onChange: (s) => { bModel = rebuildModel(B, s, "batter"); redraw(); } });
  onExternalChange(() => {
    pModel = rebuildModel(P, pt.reload(), "pitcher");
    bModel = rebuildModel(B, bt.reload(), "batter");
    recomputeAll();
  });
  pModel = rebuildModel(P, pt.settings, "pitcher");
  bModel = rebuildModel(B, bt.settings, "batter");

  wireControls();
  recomputeAll();
}

function rebuildModel(data, settings, kind) {
  const model = buildModel(data, settings);
  const clusters = applyModel(data, model, (members) => describeCluster(members, data, settings));
  if (kind === "pitcher") pClusters = clusters; else bClusters = clusters;
  return model;
}

// Columnar copy of the pair table + per-player and league totals
function preparePairs(mu) {
  const F = Object.fromEntries(mu.fields.map((f, i) => [f, i]));
  const pIdx = new Map(P.nodes.map((n, i) => [n.id, i]));
  const bIdx = new Map(B.nodes.map((n, i) => [n.id, i]));
  const rows = mu.pairs.filter(([b, p]) => bIdx.has(b) && pIdx.has(p));
  const R = rows.length;
  const pb = new Int32Array(R), pp = new Int32Array(R), ps = new Uint8Array(R);
  const col = Object.fromEntries(mu.fields.map((f) => [f, new Float64Array(R)]));
  rows.forEach(([b, p, s, ...v], r) => {
    pb[r] = bIdx.get(b); pp[r] = pIdx.get(p); ps[r] = s;
    mu.fields.forEach((f, i) => (col[f][r] = v[i]));
  });
  const byBatter = B.nodes.map(() => []);
  for (let r = 0; r < R; r++) byBatter[pb[r]].push(r);
  const zero = mu.fields.map(() => 0);
  const splits = (table, id) => [table[id]?.["0"] ?? zero, table[id]?.["1"] ?? zero];
  return {
    R, pb, pp, ps, col, byBatter, F,
    league: [mu.league["0"], mu.league["1"]],
    bTot: B.nodes.map((n) => splits(mu.batters, n.id)),
    pTot: P.nodes.map((n) => splits(mu.pitchers, n.id)),
  };
}

// --- Metric: expected value for every pair -------------------------------------------
function prepareMetric(m) {
  const { F, league } = pairs;
  const rateOf = (a) => a[F[m.num]] / a[F[m.den]];
  const lg = [rateOf(league[0]), rateOf(league[1])];
  const lgAll = (league[0][F[m.num]] + league[1][F[m.num]]) / (league[0][F[m.den]] + league[1][F[m.den]]);

  // A player's same/opposite-hand rate, shrunk toward (their overall rate + league platoon gap)
  const splitRates = ([t0, t1]) => {
    const d = t0[F[m.den]] + t1[F[m.den]];
    const overall = d ? (t0[F[m.num]] + t1[F[m.num]]) / d : lgAll;
    return [t0, t1].map((t, s) => (t[F[m.num]] + m.k * (overall + lg[s] - lgAll)) / (t[F[m.den]] + m.k));
  };
  const bRate = pairs.bTot.map(splitRates);
  const pRate = pairs.pTot.map(splitRates);

  const num = pairs.col[m.num], den = pairs.col[m.den];
  const exp = new Float64Array(pairs.R);
  for (let r = 0; r < pairs.R; r++) {
    const s = pairs.ps[r];
    exp[r] = den[r] * (bRate[pairs.pb[r]][s] + pRate[pairs.pp[r]][s] - lg[s]);
  }
  return { ...m, numArr: num, denArr: den, exp, lg, lgAll, bRate, pRate };
}

const inPlatoon = (s) => ui.platoon === "all" || (ui.platoon === "same") === (s === 1);

function leagueRate() {
  if (ui.platoon === "all") return M.lgAll;
  return M.lg[ui.platoon === "same" ? 1 : 0];
}

// --- Aggregate pairs into cluster cells and batter × pitcher-cluster cells --------------
function aggregate() {
  const nb = bModel.nClusters, np = pModel.nClusters, nB = B.nodes.length;
  const cell = { num: new Float64Array(nb * np), den: new Float64Array(nb * np), exp: new Float64Array(nb * np) };
  const bj = { num: new Float64Array(nB * np), den: new Float64Array(nB * np), exp: new Float64Array(nB * np) };
  const { pb, pp, ps } = pairs;
  for (let r = 0; r < pairs.R; r++) {
    if (!inPlatoon(ps[r])) continue;
    const b = pb[r], j = pModel.cluster[pp[r]], c = bModel.cluster[b] * np + j, i = b * np + j;
    cell.num[c] += M.numArr[r]; cell.den[c] += M.denArr[r]; cell.exp[c] += M.exp[r];
    bj.num[i] += M.numArr[r]; bj.den[i] += M.denArr[r]; bj.exp[i] += M.exp[r];
  }
  return { cell, bj, nb, np };
}

// Similarity-weighted sum of *other* batters' matchup deltas against each pitcher cluster.
// weight(b, b2) defaults to the batter similarity kernel.
function neighborSums(weight = (b, b2) => bModel.sim[b * bModel.n + b2]) {
  const nB = B.nodes.length, np = agg.np, { bj } = agg;
  const N = new Float64Array(nB * np), D = new Float64Array(nB * np);
  for (let b = 0; b < nB; b++) {
    for (let b2 = 0; b2 < nB; b2++) {
      if (b2 === b) continue;
      const w = weight(b, b2);
      if (w < 1e-4) continue;
      for (let j = 0; j < np; j++) {
        const i = b2 * np + j;
        N[b * np + j] += w * (bj.num[i] - bj.exp[i]);
        D[b * np + j] += w * bj.den[i];
      }
    }
  }
  return { N, D };
}

function recomputeAll() {
  M = M && M.id === ui.metric ? M : { ...prepareMetric(METRICS[ui.metric]), id: ui.metric };
  agg = aggregate();
  nbr = neighborSums();
  renderHeatmap();
  renderHypothesis();
  renderBatter();
}

// --- Formatting & color --------------------------------------------------------------
const fmtRate = (v) => {
  if (!Number.isFinite(v)) return "–";
  const x = (v * M.scale).toFixed(M.dec);
  return M.dec === 3 ? x.replace(/^(-?)0\./, "$1.") : `${x}${M.pct ? "%" : ""}`;
};
const fmtDelta = (v) => {
  if (!Number.isFinite(v)) return "–";
  const x = Math.abs(v * M.scale).toFixed(M.dec);
  const body = M.dec === 3 ? x.replace(/^0\./, ".") : x;
  return `${v < 0 ? "−" : "+"}${body}${M.pct ? " pp" : ""}`;
};
// Signed so that + always means "good for the batter"
const good = (delta) => delta * M.better;

function heatColor(t) {
  const a = Math.min(1, Math.abs(t));
  const pole = t > 0 ? HOT : COLD;
  const rgb = MID.map((m, i) => Math.round(m + (pole[i] - m) * a));
  return { bg: `rgb(${rgb})`, ink: a > 0.65 ? "#1e1e24" : "var(--text)" };
}

function paint(el, value, domain) {
  const { bg, ink } = heatColor(value / domain);
  el.style.background = bg;
  el.style.color = ink;
}

// What a cell shows: the delta vs expected (or vs league), shrunk if enabled
function cellShown(num, den, exp) {
  if (!den) return { shown: NaN, obs: NaN, base: NaN, delta: NaN, conf: 0 };
  const obs = num / den;
  const base = ui.mode === "expected" ? exp / den : leagueRate();
  const delta = obs - base;
  const conf = den / (den + ui.k);
  return { shown: good(ui.shrink ? delta * conf : delta), obs, base, delta, conf };
}

// --- Heatmap ---------------------------------------------------------------------------
function renderHeatmap() {
  const { cell, nb, np } = agg;
  const vals = [];
  for (let c = 0; c < nb * np; c++) vals.push(cellShown(cell.num[c], cell.den[c], cell.exp[c]));
  const domain = Math.max(1e-4, ...vals.map((v) => Math.abs(v.shown)).filter(Number.isFinite));

  const head = pClusters.map((c) => `
    <th scope="col"><span class="dot" style="background:${clusterColor(c.id)}"></span>P${c.id + 1}
      <small>${c.label}</small><small class="muted">${c.size} pitchers</small></th>`).join("");
  const body = bClusters.map((bc) => {
    const cells = pClusters.map((pc) => {
      const c = bc.id * np + pc.id;
      const v = vals[c];
      return `<td data-c="${c}"><span>${fmtDelta(v.shown * M.better)}</span><small>${Math.round(cell.den[c])}</small></td>`;
    }).join("");
    return `<tr><th scope="row"><span class="dot" style="background:${clusterColor(bc.id)}"></span>B${bc.id + 1}
      <small>${bc.label}</small><small class="muted">${bc.size} batters</small></th>${cells}</tr>`;
  }).join("");

  const table = document.getElementById("heatmap");
  table.innerHTML = `<thead><tr><th class="corner">Batters ↓ · Pitchers →</th>${head}</tr></thead><tbody>${body}</tbody>`;
  table.querySelectorAll("td").forEach((td) => {
    const c = Number(td.dataset.c);
    const v = vals[c];
    paint(td, v.shown, domain);
    const bc = bClusters[Math.floor(c / np)], pc = pClusters[c % np];
    td.addEventListener("mousemove", (e) => showTip(e, `
      <b>B${bc.id + 1}</b> ${bc.label}<br><b>vs P${pc.id + 1}</b> ${pc.label}<hr>
      Observed ${M.label}: <b>${fmtRate(v.obs)}</b><br>
      ${ui.mode === "expected" ? "Expected" : "League"}: ${fmtRate(v.base)}<br>
      Difference: ${fmtDelta(v.delta)}${ui.shrink ? `<br>After shrinkage: ${fmtDelta(v.shown * M.better)}` : ""}<br>
      Sample: ${Math.round(cell.den[c]).toLocaleString()} ${M.unit} (weight ${Math.round(v.conf * 100)}%)`));
    td.addEventListener("mouseleave", hideTip);
  });

  document.getElementById("heat-hint").innerHTML =
    `Each cell is how one batter cluster did against one pitcher cluster in <b>${M.label}</b>, compared with
    ${ui.mode === "expected"
      ? "what the specific batters' and pitchers' overall numbers predict (so it isolates the matchup, not talent)"
      : "the league average"}.
    <span class="hot-text">Red</span> = better for the batters, <span class="cold-text">blue</span> = worse.
    ${ui.shrink ? `Cells are shrunk toward zero by sample size (k = ${ui.k} ${M.unit}), so thin samples fade to gray.` : ""}
    The small number is the sample in ${M.unit}.`;
  legend(document.getElementById("heat-legend"), domain);
}

function legend(el, domain) {
  el.innerHTML = `
    <span>Batter worse</span>
    <span class="ramp" style="background:linear-gradient(90deg, rgb(${COLD}), rgb(${MID}), rgb(${HOT}))"></span>
    <span>Batter better</span>
    <span class="muted">${fmtDelta(-domain * M.better)} … ${fmtDelta(domain * M.better)}</span>`;
}

// --- Hypothesis check ------------------------------------------------------------------
function correlationPoints(sums) {
  const { bj, np } = agg;
  const xs = [], ys = [];
  for (let i = 0; i < bj.den.length; i++) {
    if (bj.den[i] < ui.minDen || sums.D[i] < ui.minDen / 2) continue;
    ys.push(good((bj.num[i] - bj.exp[i]) / bj.den[i]));
    xs.push(good(sums.N[i] / sums.D[i]));
  }
  return { xs, ys, np };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function renderHypothesis() {
  const sim = correlationPoints(nbr);
  const rSim = pearson(sim.xs, sim.ys);

  const bc = bModel.cluster;
  const mates = correlationPoints(neighborSums((b, b2) => (bc[b] === bc[b2] ? 1 : 0)));
  const rMates = pearson(mates.xs, mates.ys);

  // Baseline: same similarity weights, but handed to randomly chosen batters
  const nB = B.nodes.length;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rs = [];
  for (let t = 0; t < N_SHUFFLES; t++) {
    const perm = [...Array(nB).keys()];
    for (let i = nB - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const pts = correlationPoints(neighborSums((b, b2) => (perm[b2] === b ? 0 : bModel.sim[b * nB + perm[b2]])));
    const r = pearson(pts.xs, pts.ys);
    if (Number.isFinite(r)) rs.push(r);
  }
  const mean = rs.reduce((a, b) => a + b, 0) / (rs.length || 1);
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (rs.length || 1));

  const f = (r) => (Number.isFinite(r) ? r.toFixed(3) : "–");
  document.getElementById("min-out").textContent = `${ui.minDen} ${M.unit}`;
  document.getElementById("hypothesis").innerHTML = `
    <div class="stats wide">
      <div><b>${f(rSim)}</b><span>r, similar batters (weighted by similarity)</span></div>
      <div><b>${f(rMates)}</b><span>r, same-cluster batters</span></div>
      <div><b>${f(mean)} ± ${f(2 * sd)}</b><span>r, random batters (${rs.length} shuffles, ±2 sd)</span></div>
      <div><b>${sim.xs.length.toLocaleString()}</b><span>dots (batter × pitcher cluster, ≥ ${ui.minDen} ${M.unit})</span></div>
    </div>
    ${scatter(sim.xs, sim.ys)}
    <p class="hint">${verdict(rSim, mean, sd)}</p>`;
}

function verdict(r, mean, sd) {
  if (!Number.isFinite(r)) return "Not enough data at this minimum sample; lower it.";
  if (r > mean + 2 * sd) return `The similarity signal clears the random baseline: for ${M.label}, a batter's matchup results against a pitcher cluster lean the same way as their comps' results.`;
  return `The similarity signal does not clear the random baseline for ${M.label} at these settings. Try other weights, a larger minimum sample, or a metric that stabilizes faster (whiff %, K %).`;
}

function scatter(xs, ys) {
  if (xs.length < 3) return "";
  const W = 560, H = 300, pad = 40;
  const q = (arr) => { const s = arr.map(Math.abs).sort((a, b) => a - b); return s[Math.floor(s.length * 0.98)] || 1e-3; };
  const dx = q(xs), dy = q(ys);
  const sx = (x) => pad + ((Math.max(-dx, Math.min(dx, x)) + dx) / (2 * dx)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((Math.max(-dy, Math.min(dy, y)) + dy) / (2 * dy)) * (H - 2 * pad);
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  const line = (x) => my + slope * (x - mx);
  const dots = xs.map((x, i) => `<circle cx="${sx(x).toFixed(1)}" cy="${sy(ys[i]).toFixed(1)}" r="2.6"/>`).join("");
  return `
  <svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of batters' matchup deltas against their similar batters' deltas">
    <line class="axis" x1="${pad}" x2="${W - pad}" y1="${sy(0)}" y2="${sy(0)}"/>
    <line class="axis" y1="${pad}" y2="${H - pad}" x1="${sx(0)}" x2="${sx(0)}"/>
    <g class="dots">${dots}</g>
    <line class="fit" x1="${sx(-dx)}" y1="${sy(line(-dx))}" x2="${sx(dx)}" y2="${sy(line(dx))}"/>
    <text x="${W - pad}" y="${H - 12}" text-anchor="end">Similar batters vs this cluster → ${fmtDelta(dx * M.better)}</text>
    <text x="${pad}" y="${H - 12}">${fmtDelta(-dx * M.better)}</text>
    <text x="${pad - 6}" y="${pad - 10}">↑ This batter vs this cluster (${fmtDelta(dy * M.better)})</text>
  </svg>`;
}

// --- Single batter ------------------------------------------------------------------------
function expectedRate(b, p) {
  const stands = B.nodes[b].stands, throws = P.nodes[p].throws;
  const s = stands === "S" ? 0 : Number(stands === throws);
  return M.bRate[b][s] + M.pRate[p][s] - M.lg[s];
}

// Shrinkage chain for one batter vs one pitcher. Each level's delta is blended
// with the level above it: est = (sum_of_deltas + k * fallback) / (sample + k).
function chain(b, p) {
  const np = agg.np, j = pModel.cluster[p], k = ui.k, nP = pModel.n;
  let dN = 0, dD = 0, sN = 0, sD = 0;
  for (const r of pairs.byBatter[b]) {
    if (!inPlatoon(pairs.ps[r])) continue;
    const q = pairs.pp[r], d = M.numArr[r] - M.exp[r];
    if (q === p) { dN += d; dD += M.denArr[r]; continue; }
    const w = pModel.sim[p * nP + q];
    sN += w * d; sD += w * M.denArr[r];
  }
  const i = b * np + j;
  const cN = agg.bj.num[i] - agg.bj.exp[i] - dN, cD = agg.bj.den[i] - dD;

  const levels = [
    { label: `Similar batters vs P${j + 1}`, N: nbr.N[i], D: nbr.D[i] },
    { label: `This batter vs P${j + 1} (other pitchers)`, N: cN, D: cD },
    { label: `This batter vs pitchers similar to ${P.nodes[p].name}`, N: sN, D: sD },
    { label: `This batter vs ${P.nodes[p].name}`, N: dN, D: dD },
  ];
  let est = 0;
  levels.forEach((L) => {
    L.raw = L.D > 0 ? L.N / L.D : NaN;
    est = (L.N + k * est) / (L.D + k || 1);
    L.est = est;
  });
  const exp = expectedRate(b, p);
  return { levels, delta: est, expected: exp, estimate: exp + est, direct: dD ? (dN / dD) + exp : NaN, n: dD };
}

function renderBatter() {
  const view = document.getElementById("batter-view");
  if (ui.batter === null) {
    view.innerHTML = `<p class="hint">${ui.pitcher !== null ? `${P.nodes[ui.pitcher].name} is selected. ` : ""}Pick a batter above.</p>`;
    return;
  }
  const b = ui.batter, bn = B.nodes[b], np = agg.np, k = ui.k;
  const { bj } = agg;

  const rows = [
    { label: "This batter", cell: (j) => { const i = b * np + j; const d = bj.den[i];
      return { v: d ? (bj.num[i] - bj.exp[i]) / d * (ui.shrink ? d / (d + k) : 1) : NaN, n: d }; } },
    { label: "Similar batters", cell: (j) => { const i = b * np + j; const d = nbr.D[i];
      return { v: d ? nbr.N[i] / (d + (ui.shrink ? k : 0)) : NaN, n: d }; } },
    { label: "Blended estimate", cell: (j) => { const i = b * np + j;
      const prior = nbr.N[i] / (nbr.D[i] + k);
      return { v: (bj.num[i] - bj.exp[i] + k * prior) / (bj.den[i] + k), n: bj.den[i] + nbr.D[i] }; } },
  ].map((row) => ({ ...row, cells: pClusters.map((c) => row.cell(c.id)) }));
  const domain = Math.max(1e-4, ...rows.flatMap((r) => r.cells.map((c) => Math.abs(c.v))).filter(Number.isFinite));

  const head = pClusters.map((c) => `<th scope="col" title="${c.label}"><span class="dot" style="background:${clusterColor(c.id)}"></span>P${c.id + 1}</th>`).join("");
  const strip = rows.map((row) => `<tr><th scope="row">${row.label}</th>${row.cells.map((c) =>
    `<td data-v="${good(c.v)}"><span>${fmtDelta(c.v)}</span><small>${Math.round(c.n)}</small></td>`).join("")}</tr>`).join("");

  // Pitchers faced, most sample first
  const faced = new Map();
  for (const r of pairs.byBatter[b]) {
    if (!inPlatoon(pairs.ps[r])) continue;
    faced.set(pairs.pp[r], (faced.get(pairs.pp[r]) || 0) + M.denArr[r]);
  }
  const top = [...faced].sort((a, b2) => b2[1] - a[1]).slice(0, N_FACED).map(([p]) => ({ p, ...chain(b, p) }));
  const facedDomain = Math.max(1e-4, ...top.map((t) => Math.abs(t.delta)));
  const facedRows = top.map((t) => `
    <tr data-p="${t.p}" class="${t.p === ui.pitcher ? "active" : ""}">
      <td><span class="dot" style="background:${clusterColor(P.nodes[t.p].cluster)}"></span>${P.nodes[t.p].name}</td>
      <td>${Math.round(t.n)}</td><td>${fmtRate(t.direct)}</td><td>${fmtRate(t.expected)}</td>
      <td>${fmtRate(t.estimate)}</td><td class="heat-cell" data-v="${good(t.delta)}">${fmtDelta(t.delta)}</td>
    </tr>`).join("");

  let chainHtml = "";
  if (ui.pitcher !== null) {
    const c = chain(b, ui.pitcher);
    chainHtml = `
      <h3>How the estimate for ${bn.name} vs ${P.nodes[ui.pitcher].name} is built</h3>
      <table class="chain">
        <thead><tr><th>Step</th><th>Observed Δ</th><th>Sample (${M.unit})</th><th>Running estimate Δ</th></tr></thead>
        <tbody>${c.levels.map((L) => `<tr><td>${L.label}</td><td>${fmtDelta(L.raw)}</td>
          <td>${L.D.toFixed(L.D < 10 ? 1 : 0)}</td><td>${fmtDelta(L.est)}</td></tr>`).join("")}</tbody>
      </table>
      <p class="hint">Expected ${M.label} from overall numbers: <b>${fmtRate(c.expected)}</b>.
        Matchup adjustment: <b>${fmtDelta(c.delta)}</b>. Estimate: <b>${fmtRate(c.estimate)}</b>
        ${c.n ? ` (they actually posted ${fmtRate(c.direct)} over ${Math.round(c.n)} ${M.unit})` : " (they have not faced each other under this filter)"}.</p>`;
  }

  view.innerHTML = `
    <div class="player-line"><b>${bn.name}</b>
      <span class="muted">${{ L: "Bats left", R: "Bats right", S: "Switch" }[bn.stands]} · ${bn.pa} PA ·</span>
      <span style="color:${clusterColor(bn.cluster)}">B${bn.cluster + 1} ${bClusters[bn.cluster].label}</span></div>
    <h3>${M.label} vs expected, by pitcher cluster</h3>
    <div class="scroll-x"><table class="heat strip"><thead><tr><th></th>${head}</tr></thead><tbody>${strip}</tbody></table></div>
    ${chainHtml}
    <h3>Pitchers faced most</h3>
    <div class="scroll-x"><table class="faced">
      <thead><tr><th>Pitcher</th><th>${M.unit}</th><th>Observed</th><th>Expected</th><th>Estimate</th><th>Estimate vs exp.</th></tr></thead>
      <tbody>${facedRows}</tbody>
    </table></div>`;

  view.querySelectorAll(".strip td").forEach((td) => paint(td, Number(td.dataset.v) || 0, domain));
  view.querySelectorAll(".faced td.heat-cell").forEach((td) => paint(td, Number(td.dataset.v) || 0, facedDomain));
  view.querySelectorAll(".faced tbody tr").forEach((tr) => tr.addEventListener("click", () => {
    setPitcher(Number(tr.dataset.p));
  }));
}

// --- Controls ---------------------------------------------------------------------------
function wireControls() {
  const $ = (id) => document.getElementById(id);
  const kInput = $("k");
  const syncK = () => { kInput.value = ui.k; $("k-out").textContent = `${ui.k} ${METRICS[ui.metric].unit}`; };
  syncK();

  $("metric").onchange = (e) => { ui.metric = e.target.value; ui.k = METRICS[ui.metric].k; syncK(); recomputeAll(); };
  $("platoon").onchange = (e) => { ui.platoon = e.target.value; recomputeAll(); };
  $("mode").onchange = (e) => { ui.mode = e.target.value; recomputeAll(); };
  $("shrink").onchange = (e) => { ui.shrink = e.target.checked; recomputeAll(); };
  const redraw = throttleFrame(recomputeAll);
  kInput.oninput = () => { ui.k = Number(kInput.value); syncK(); redraw(); };
  $("min-den").oninput = (e) => { ui.minDen = Number(e.target.value); throttleHyp(); };
  const throttleHyp = throttleFrame(renderHypothesis);

  // Player search
  const fill = (dl, nodes) => nodes.map((n, i) => [n.name, i]).sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([name]) => dl.insertAdjacentHTML("beforeend", `<option value="${name}">`));
  fill($("batter-names"), B.nodes);
  fill($("pitcher-names"), P.nodes);
  const find = (nodes, name) => nodes.findIndex((n) => n.name.toLowerCase() === name.trim().toLowerCase());
  $("batter-search").addEventListener("change", (e) => {
    const i = find(B.nodes, e.target.value);
    ui.batter = i >= 0 ? i : null; updateHash(); renderBatter();
  });
  $("pitcher-search").addEventListener("change", (e) => {
    const i = find(P.nodes, e.target.value);
    setPitcher(i >= 0 ? i : null);
  });

  // Deep links: matchups.html#batter=592450&pitcher=669203
  const idOf = (key) => Number(location.hash.match(new RegExp(`${key}=(\\d+)`))?.[1]);
  const bi = B.nodes.findIndex((n) => n.id === idOf("batter"));
  const pi = P.nodes.findIndex((n) => n.id === idOf("pitcher"));
  if (bi >= 0) { ui.batter = bi; $("batter-search").value = B.nodes[bi].name; }
  if (pi >= 0) { ui.pitcher = pi; $("pitcher-search").value = P.nodes[pi].name; }
  if (bi >= 0 || pi >= 0) requestAnimationFrame(() => $("batter-view").scrollIntoView({ block: "start" }));

  // Tuner drawer
  const tunerEl = $("tuner");
  $("tuner-toggle").onclick = () => (tunerEl.hidden = !tunerEl.hidden);
  $("tuner-close").onclick = () => (tunerEl.hidden = true);
}

function setPitcher(p) {
  ui.pitcher = p;
  document.getElementById("pitcher-search").value = p === null ? "" : P.nodes[p].name;
  updateHash();
  renderBatter();
}

function updateHash() {
  const parts = [];
  if (ui.batter !== null) parts.push(`batter=${B.nodes[ui.batter].id}`);
  if (ui.pitcher !== null) parts.push(`pitcher=${P.nodes[ui.pitcher].id}`);
  history.replaceState(null, "", parts.length ? `#${parts.join("&")}` : location.pathname);
}

// --- Tooltip ------------------------------------------------------------------------------
const tip = document.getElementById("tip");
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { tip.hidden = true; }
