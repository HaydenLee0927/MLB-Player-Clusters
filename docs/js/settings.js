// Similarity settings: defaults come from the data file (pipeline/config.py),
// edits are kept in localStorage so every page — and every open tab — uses the
// same tuned weights.
import { featureKey } from "./similarity.js";

const KEY = "similarity-settings-v2"; // v2: data-fit defaults replaced the hand-picked v1 weights

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function defaultSettings(data) {
  return {
    blocks: Object.fromEntries(data.defaults.blocks.map((b) => [b.id, b.weight])),
    features: { ...data.defaults.features },
    k: data.defaults.k,
    minSim: data.defaults.min_sim,
    resolution: data.defaults.resolution,
  };
}

export function loadSettings(kind, data) {
  const d = defaultSettings(data);
  const s = readAll()[kind] || {};
  return { ...d, ...s, blocks: { ...d.blocks, ...s.blocks }, features: { ...d.features, ...s.features } };
}

export function saveSettings(kind, settings) {
  const all = readAll();
  all[kind] = settings;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: live tuning still works */ }
}

// Fires when another tab changes the settings
export function onExternalChange(cb) {
  window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); });
}

// Slider panel. Calls onChange(settings) on every edit (the caller debounces).
export function mountTuner(root, { kind, title, data, onChange }) {
  let settings = loadSettings(kind, data);
  const section = document.createElement("section");
  section.className = "tuner-group";
  root.appendChild(section);

  const slider = (label, value, attrs) => `
    <label class="slider"><span>${label}</span><output>${fmt(value, attrs.step)}</output>
      <input type="range" min="${attrs.min}" max="${attrs.max}" step="${attrs.step}" value="${value}" ${attrs.data}></label>`;

  function render() {
    const blocks = data.defaults.blocks.map((b) => {
      const cols = data.columns.filter((c) => c.block === b.id);
      // A key shared by several columns (e.g. pitch velo for every pitch type) is labeled by feature
      const feats = [...new Map(cols.map((c) => [featureKey(c),
        cols.filter((o) => featureKey(o) === featureKey(c)).length > 1 ? c.feature : c.label ?? c.feature]))];
      const inner = feats.length > 1
        ? `<details><summary>${feats.length} features</summary>${feats.map(([key, label]) =>
            slider(label, settings.features[key] ?? 1, { min: 0, max: 3, step: 0.05, data: `data-feature="${key}"` })).join("")}</details>`
        : "";
      return `<div class="tuner-block">${slider(`<b>${b.label}</b>`, settings.blocks[b.id],
        { min: 0, max: 3, step: 0.05, data: `data-block="${b.id}"` })}${inner}</div>`;
    }).join("");

    section.innerHTML = `
      <h3>${title}</h3>
      <p class="tuner-note">Block weights (0 turns a block off). Open a block to weight single features.</p>
      ${blocks}
      <h4>Graph and clusters</h4>
      ${slider("Neighbors per player (k)", settings.k, { min: 1, max: 15, step: 1, data: 'data-key="k"' })}
      ${slider("Min similarity for a link", settings.minSim, { min: 0, max: 0.95, step: 0.05, data: 'data-key="minSim"' })}
      ${slider("Cluster resolution", settings.resolution, { min: 0.2, max: 3, step: 0.05, data: 'data-key="resolution"' })}
      <div class="tuner-actions">
        <button type="button" data-act="reset">Reset to defaults</button>
        <button type="button" data-act="copy">Copy settings</button>
      </div>`;

    section.querySelectorAll("input[type=range]").forEach((input) => {
      input.addEventListener("input", () => {
        const v = Number(input.value);
        input.previousElementSibling.textContent = fmt(v, input.step);
        if (input.dataset.block) settings.blocks[input.dataset.block] = v;
        else if (input.dataset.feature) settings.features[input.dataset.feature] = v;
        else settings[input.dataset.key] = v;
        saveSettings(kind, settings);
        onChange(settings);
      });
    });
    section.querySelector("[data-act=reset]").onclick = () => {
      settings = defaultSettings(data);
      saveSettings(kind, settings);
      render();
      onChange(settings);
    };
    section.querySelector("[data-act=copy]").onclick = (e) => {
      navigator.clipboard?.writeText(JSON.stringify(settings, null, 2));
      e.target.textContent = "Copied";
      setTimeout(() => (e.target.textContent = "Copy settings"), 1200);
    };
  }
  render();

  return {
    get settings() { return settings; },
    reload() { settings = loadSettings(kind, data); render(); return settings; },
  };
}

function fmt(v, step) {
  return Number(step) >= 1 ? String(v) : Number(v).toFixed(2);
}
