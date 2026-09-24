// Obsidian-style force graph, shared by the pitcher and batter pages.
// Similarity, links and clusters are rebuilt in the browser whenever the tuning
// sliders move, and node positions carry over so the layout settles smoothly.
import {
  applyModel, clusterColor, describeCluster, headshot, loadError, loadJSON, throttleFrame,
} from "./common.js";
import { mountTuner, onExternalChange } from "./settings.js";
import { buildModel } from "./similarity.js";

/**
 * @param {object} cfg
 * @param {"pitcher"|"batter"} cfg.kind
 * @param {string} cfg.dataUrl
 * @param {string} cfg.noun             plural, for the header ("pitchers")
 * @param {(n, cluster) => string} cfg.subtitle   line under the name in the panel
 * @param {(n) => string} cfg.details             panel HTML between the header and the similar list
 */
export async function initGraphPage(cfg) {
  let data;
  try { data = await loadJSON(cfg.dataUrl); } catch (err) { return loadError(document.getElementById("graph"), err); }

  const state = {
    hoverNode: null,
    selected: null,
    focusCluster: null,
    highlight: new Set(),     // node ids to emphasise
    alwaysLabels: false,
  };
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  let neighbors = new Map();
  let clusters = [];

  const isDimmed = (n) =>
    (state.highlight.size && !state.highlight.has(n.id)) ||
    (state.focusCluster !== null && n.cluster !== state.focusCluster);
  const focusId = () => state.hoverNode ?? state.selected;

  const Graph = ForceGraph()(document.getElementById("graph"))
    .backgroundColor("#1e1e24")
    .autoPauseRedraw(false) // repaint when hover/filter state changes
    .nodeId("id")
    .nodeVal((n) => 1 + n.degree * 0.6)
    .nodeLabel(() => "") // we draw our own labels
    .linkColor((l) => {
      const active = state.highlight.size &&
        state.highlight.has(l.source.id) && state.highlight.has(l.target.id) &&
        (l.source.id === focusId() || l.target.id === focusId());
      return active ? "rgba(167,139,250,0.9)" : "rgba(160,160,180,0.12)";
    })
    .linkWidth((l) => (state.highlight.has(l.source.id) && state.highlight.has(l.target.id) ? 1.6 : 0.6))
    .d3VelocityDecay(0.3)
    .cooldownTicks(300)
    .nodeCanvasObject((n, ctx, scale) => {
      const r = 2.2 + Math.sqrt(n.degree) * 1.3;
      const dim = isDimmed(n);
      ctx.globalAlpha = dim ? 0.12 : 1;

      // soft glow
      if (!dim && (n.id === focusId() || state.highlight.has(n.id))) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 2.2, 0, 2 * Math.PI);
        ctx.fillStyle = clusterColor(n.cluster) + "33";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = clusterColor(n.cluster);
      ctx.fill();

      const showLabel = state.alwaysLabels || scale > 2.2 ||
        n.id === focusId() || (state.highlight.has(n.id) && !dim);
      if (showLabel && !dim) {
        const fontSize = Math.max(11 / scale, 1.5);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#dcdce4";
        ctx.fillText(n.name, n.x, n.y + r + 1.5);
      }
      ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((n, color, ctx) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 4 + Math.sqrt(n.degree) * 1.3, 0, 2 * Math.PI);
      ctx.fill();
    })
    .onNodeHover((n) => {
      state.hoverNode = n ? n.id : null;
      refreshHighlight();
      document.body.style.cursor = n ? "pointer" : "";
    })
    .onNodeClick((n) => select(n.id))
    .onBackgroundClick(() => select(null));

  // Spread clusters a bit more than the default
  Graph.d3Force("charge").strength(-40);
  Graph.d3Force("link").distance((l) => 20 + (1 - l.value) * 60);

  // --- (Re)build similarity, links and clusters from the current settings ------
  function rebuild(settings) {
    const model = buildModel(data, settings);
    clusters = applyModel(data, model, (members) => describeCluster(members, data, settings));

    neighbors = new Map(data.nodes.map((n) => [n.id, new Set()]));
    model.links.forEach((l) => {
      neighbors.get(l.source).add(l.target);
      neighbors.get(l.target).add(l.source);
    });
    data.nodes.forEach((n) => (n.degree = neighbors.get(n.id).size));

    Graph.graphData({ nodes: data.nodes, links: model.links });
    document.getElementById("meta").textContent =
      `${data.meta.season} · ${data.nodes.length} ${cfg.noun} · ${clusters.length} clusters`;
    if (state.focusCluster !== null && state.focusCluster >= clusters.length) state.focusCluster = null;
    renderLegend();
    refreshHighlight();
    if (state.selected !== null) renderPanel(byId.get(state.selected));
  }

  function refreshHighlight() {
    state.highlight.clear();
    const id = focusId();
    if (id !== null) {
      state.highlight.add(id);
      neighbors.get(id).forEach((j) => state.highlight.add(j));
    }
  }

  function select(id, { zoom = false } = {}) {
    state.selected = id;
    refreshHighlight();
    const panel = document.getElementById("panel");
    if (id === null) { panel.hidden = true; return; }
    const n = byId.get(id);
    renderPanel(n);
    panel.hidden = false;
    if (zoom) {
      Graph.centerAt(n.x, n.y, 600);
      Graph.zoom(4, 600);
    }
  }

  function renderPanel(n) {
    const sims = n.similar.map((s) => {
      const o = byId.get(s.id);
      return `<li data-id="${o.id}"><span>${o.name} <small style="color:${clusterColor(o.cluster)}">●</small></span>
                 <span class="bar">${Math.round(s.sim * 100)}</span></li>`;
    }).join("");

    const cluster = clusters[n.cluster];
    document.getElementById("panel-body").innerHTML = `
      <div class="player-head">
        <img src="${headshot(n.id)}" alt="" onerror="this.style.visibility='hidden'">
        <div>
          <h2>${n.name}</h2>
          <div class="sub">${cfg.subtitle(n)} · <span style="color:${clusterColor(n.cluster)}" title="${cluster.label}">Cluster ${cluster.id + 1}</span></div>
        </div>
      </div>
      ${cfg.details(n)}
      <h3>Most similar</h3>
      <ul class="similar">${sims}</ul>
      <p class="panel-links">
        <a href="matchups.html#${cfg.kind}=${n.id}">Matchups →</a>
        <a target="_blank" rel="noopener" href="https://baseballsavant.mlb.com/savant-player/${n.id}">Baseball Savant ↗</a>
      </p>`;

    document.querySelectorAll(".similar li").forEach((li) =>
      li.addEventListener("click", () => select(Number(li.dataset.id), { zoom: true })));
  }

  // --- Legend / cluster filter ---------------------------------------------
  const list = document.getElementById("cluster-list");
  function renderLegend() {
    list.innerHTML = "";
    clusters.forEach((c) => {
      const li = document.createElement("li");
      if (state.focusCluster === c.id) li.classList.add("active");
      li.innerHTML = `<span class="swatch" style="background:${clusterColor(c.id)}"></span>
                      <span class="cluster-name"><b>Cluster ${c.id + 1}</b><small>${c.label}</small></span>
                      <span class="count">${c.size}</span>`;
      li.onclick = () => {
        state.focusCluster = state.focusCluster === c.id ? null : c.id;
        list.querySelectorAll("li").forEach((x) => x.classList.remove("active"));
        if (state.focusCluster !== null) li.classList.add("active");
      };
      list.appendChild(li);
    });
  }

  // --- Tuning panel -----------------------------------------------------------
  const tuner = mountTuner(document.getElementById("tuner-body"), {
    kind: cfg.kind,
    title: `${cfg.noun[0].toUpperCase()}${cfg.noun.slice(1)} similarity`,
    data,
    onChange: throttleFrame(rebuild),
  });
  onExternalChange(() => rebuild(tuner.reload()));
  const tunerEl = document.getElementById("tuner");
  document.getElementById("tuner-toggle").onclick = () => {
    tunerEl.hidden = !tunerEl.hidden;
    document.body.classList.toggle("tuning", !tunerEl.hidden);
  };
  document.getElementById("tuner-close").onclick = () => {
    tunerEl.hidden = true;
    document.body.classList.remove("tuning");
  };

  rebuild(tuner.settings);

  // --- Search ---------------------------------------------------------------
  const dl = document.getElementById("player-names");
  const nameToId = new Map();
  data.nodes.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((n) => {
    nameToId.set(n.name.toLowerCase(), n.id);
    dl.insertAdjacentHTML("beforeend", `<option value="${n.name}">`);
  });
  document.getElementById("search").addEventListener("change", (e) => {
    const id = nameToId.get(e.target.value.trim().toLowerCase());
    if (id !== undefined) select(id, { zoom: true });
  });

  document.getElementById("labels-toggle").addEventListener("change", (e) => {
    state.alwaysLabels = e.target.checked;
  });
  document.getElementById("panel-close").onclick = () => select(null);

  // Allow deep links: ...#player=543037
  const m = location.hash.match(/player=(\d+)/);
  if (m && byId.has(Number(m[1]))) {
    Graph.onEngineStop(() => { select(Number(m[1]), { zoom: true }); Graph.onEngineStop(() => {}); });
  }
}
