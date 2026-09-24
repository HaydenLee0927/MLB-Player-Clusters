// Similarity model shared by every page:
//   feature columns × weights -> Euclidean distance -> Gaussian-kernel similarity
//   -> kNN graph -> Louvain clusters.
// It runs in the browser (not in the Python pipeline) so weights can be tuned live.

export const TOP_SIMILAR = 10; // "most similar" list length

export const featureKey = (c) => `${c.block}.${c.feature}`;

// Per-column multiplier: block weight × feature weight / sqrt(block width),
// so a block counts by its weight, not by how many columns it has.
export function columnWeights(data, settings) {
  const width = {};
  data.columns.forEach((c) => (width[c.block] = (width[c.block] || 0) + 1));
  return data.columns.map((c) =>
    (settings.blocks[c.block] ?? 0) * (settings.features[featureKey(c)] ?? 1) / Math.sqrt(width[c.block]));
}

export function buildModel(data, settings) {
  const nodes = data.nodes;
  const n = nodes.length;
  const w = columnWeights(data, settings);
  const X = nodes.map((nd) => nd.f.map((v, j) => v * w[j]));

  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let j = i + 1; j < n; j++) {
      const xj = X[j];
      let s = 0;
      for (let c = 0; c < xi.length; c++) { const d = xi[c] - xj[c]; s += d * d; }
      D[i * n + j] = D[j * n + i] = Math.sqrt(s);
    }
  }

  const k = Math.max(1, Math.min(settings.k, n - 1));
  const keep = Math.max(k, TOP_SIMILAR);
  const all = [...Array(n).keys()];
  const top = all.map((i) =>
    all.filter((j) => j !== i).sort((a, b) => D[i * n + a] - D[i * n + b]).slice(0, keep));

  // Kernel bandwidth: median distance to each player's k-th nearest neighbour
  const kth = top.map((t, i) => D[i * n + t[k - 1]]).sort((a, b) => a - b);
  const sigma = kth[Math.floor(n / 2)] || 1;
  const S = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) S[i] = Math.exp(-(D[i] * D[i]) / (2 * sigma * sigma));

  // kNN graph: top-k above the threshold, plus always the single closest match
  const edges = new Map();
  top.forEach((t, i) => t.slice(0, k).forEach((j, rank) => {
    const s = S[i * n + j];
    if (s < settings.minSim && rank > 0) return;
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    edges.set(key, Math.max(edges.get(key) ?? 0, s));
  }));
  const edgeList = [...edges].map(([key, s]) => [...key.split(",").map(Number), s]);

  const cluster = louvain(n, edgeList, settings.resolution);
  return {
    n,
    sim: S,
    top,
    cluster,
    nClusters: Math.max(...cluster) + 1,
    links: edgeList.map(([i, j, s]) => ({ source: nodes[i].id, target: nodes[j].id, value: s })),
  };
}

// Louvain community detection (weighted modularity with resolution γ).
// Returns a cluster id per node, numbered by cluster size (0 = largest).
export function louvain(n, edges, resolution = 1, seed = 42) {
  const rng = mulberry32(seed);
  let adj = Array.from({ length: n }, () => new Map());
  const add = (m, j, w) => m.set(j, (m.get(j) || 0) + w);
  for (const [i, j, w] of edges) { add(adj[i], j, w); add(adj[j], i, w); }
  let membership = [...Array(n).keys()];

  for (let level = 0; level < 20; level++) {
    const N = adj.length;
    const k = adj.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
    const m2 = k.reduce((a, b) => a + b, 0) || 1;
    const comm = [...Array(N).keys()];
    const tot = k.slice();
    const order = shuffle([...Array(N).keys()], rng);

    let anyMove = false;
    for (let pass = 0, moved = true; moved && pass < 100; pass++) {
      moved = false;
      for (const i of order) {
        const ci = comm[i];
        const wc = new Map();
        for (const [j, w] of adj[i]) if (j !== i) add(wc, comm[j], w);
        tot[ci] -= k[i];
        let best = ci;
        let bestGain = (wc.get(ci) || 0) - resolution * tot[ci] * k[i] / m2;
        for (const [c, w] of wc) {
          const gain = w - resolution * tot[c] * k[i] / m2;
          if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
        }
        tot[best] += k[i];
        if (best !== ci) { comm[i] = best; moved = anyMove = true; }
      }
    }
    if (!anyMove) break;

    // Collapse each community into one node and repeat
    const remap = new Map();
    comm.forEach((c) => { if (!remap.has(c)) remap.set(c, remap.size); });
    const next = Array.from({ length: remap.size }, () => new Map());
    for (let i = 0; i < N; i++) {
      for (const [j, w] of adj[i]) add(next[remap.get(comm[i])], remap.get(comm[j]), w);
    }
    membership = membership.map((c) => remap.get(comm[c]));
    adj = next;
  }

  const sizes = new Map();
  membership.forEach((c) => sizes.set(c, (sizes.get(c) || 0) + 1));
  const bySize = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
  const rank = new Map(bySize.map((c, r) => [c, r]));
  return membership.map((c) => rank.get(c));
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
