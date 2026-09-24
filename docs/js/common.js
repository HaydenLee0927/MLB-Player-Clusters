// Helpers shared by all pages.
import { columnWeights } from "./similarity.js";

export const PALETTE = [
  "#a78bfa", "#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#f87171",
  "#22d3ee", "#c084fc", "#a3e635", "#fb923c", "#818cf8", "#2dd4bf",
];
export const clusterColor = (c) => PALETTE[c % PALETTE.length];

export const headshot = (id) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;

export async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export function loadError(el, err) {
  el.innerHTML = `<p class="load-error">Could not load the data files. Run <code>python pipeline/build.py</code>
    first and serve <code>docs/</code> over http.<br>${err}</p>`;
}

// Run fn at most once per animation frame, with the latest arguments
export function throttleFrame(fn) {
  let pending = null;
  return (...args) => {
    if (pending) { pending.args = args; return; }
    pending = { args };
    requestAnimationFrame(() => { const a = pending.args; pending = null; fn(...a); });
  };
}

// --- Cluster profiles --------------------------------------------------------
// Clusters are not named from a template: each one is described by the features
// where its average stands out most from the league (column z-scores), among the
// features that currently carry weight. Reading those is how a cluster gets its meaning.

export function clusterProfile(members, data, settings, top = 3) {
  const w = columnWeights(data, settings);
  return data.columns
    .map((c, j) => ({ label: c.label ?? c.feature, z: members.reduce((a, m) => a + m.f[j], 0) / members.length, w: w[j] }))
    .filter((x) => x.w > 0)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, top);
}

// e.g. "Slider usage ↑ · 4-Seam usage ↓ · Slider spin ↑"
export function describeCluster(members, data, settings) {
  return clusterProfile(members, data, settings)
    .map((x) => `${x.label} ${x.z > 0 ? "↑" : "↓"}`).join(" · ");
}

// Apply a similarity model to a data file's nodes: cluster, similar list, cluster table
export function applyModel(data, model, describe) {
  const nodes = data.nodes;
  nodes.forEach((nd, i) => {
    nd.cluster = model.cluster[i];
    nd.similar = model.top[i].slice(0, 10).map((j) => ({ id: nodes[j].id, sim: model.sim[i * model.n + j] }));
  });
  const clusters = [];
  for (let c = 0; c < model.nClusters; c++) {
    const members = nodes.filter((nd) => nd.cluster === c);
    clusters.push({ id: c, size: members.length, label: describe(members) });
  }
  return clusters;
}
