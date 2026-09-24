# Progress log

## 2026-09-24 (later): data-fit similarity, neutral cluster labels

### Changes made
- **Default weights are fit to the data, not hand-picked.** Starting from all weights = 1, a coordinate
  search maximized pair AUC (P[same-cluster pair closer than cross-cluster pair]), with the number of
  clusters held fixed (P 10–12, B 6–8) so the score cannot be raised by adding clusters. Fit on Mar–Jun 2025,
  checked on Jul–Oct 2025. Results are in the README ("How the default weights were set").
  - Pitchers, full season: AUC 0.726 → 0.906, silhouette 0.063 → 0.149 (15 clusters).
  - Batters, full season: AUC 0.798 → 0.941, silhouette 0.103 → 0.281 (7 clusters).
- New config: `FEATURE_WEIGHTS`, `BATTER_FEATURE_WEIGHTS`, and per-page `GRAPH` / `BATTER_GRAPH` (these
  replace `K_NEIGHBORS`, `MIN_SIMILARITY` and `LOUVAIN_RESOLUTION`). `defaults.features` is exported to the JSON.
- **No predefined cluster names.** Removed the "top-2 pitches + arm slot" and "batting side + 2 standouts"
  templates. Clusters are now "Cluster N" plus a profile of the top-3 standout features (`clusterProfile` /
  `describeCluster` in `common.js`). Pitch-shape columns now carry labels such as "Slider velo".
- The settings key is now `similarity-settings-v2`, so old hand-tuned settings saved in the browser are ignored.

### What the data chose
- Pitchers: pitch usage dominates (Slider, Changeup and 4-Seam usage go up), and so do arm-side break and spin.
  Most delivery features go down. Only about 1/3 of each pitcher's top-10 comps stayed the same.
- Batters: contact quality (barrel, EV90) and batting side go up. Launch and discipline go down.

### Caveats
- A search with no bounds on the weights can put nearly all the weight on near-binary features (LHB share,
  slider or no slider). The 0.25–3 bounds and the holdout check guard against that. Watch for it when retuning.
- Pair AUC rewards more clusters, so always compare settings at the same cluster count.


## 2026-09-24

### Where things stand
- **Pitchers page** (`docs/index.html`): force graph of 478 pitchers (≥ 500 pitches, 2025 regular season).
  The default settings give 11 Louvain clusters.
- **Batters page** (`docs/batters.html`): force graph of 391 batters (≥ 150 PA). The default settings give 7 clusters.
  Features: batting side, contact quality, launch / batted-ball type, spray (pull / center / oppo and
  EV in each direction), plate discipline, and bat tracking.
- **Matchups page** (`docs/matchups.html`), rough draft:
  - A heatmap of batter clusters against pitcher clusters, colored by result vs expected and shrunk by `n / (n + k)`.
  - The similar-batters hypothesis test, with a random-batter baseline.
  - A batter lookup with a shrinkage chain for single matchups.
- **Live tuning:** similarity, kNN and Louvain now run in the browser (`docs/js/similarity.js`), so block
  and feature weights, k, minimum similarity and resolution can be changed live from the
  **Tune similarity** drawer. Settings are saved in the browser's localStorage and shared across pages and tabs.

### Changes made
- `fetch.py` now also keeps batter and outcome columns. Old caches without `batter` are pulled again
  (fast, because pybaseball's own cache already has the full rows).
- New `pipeline/batters.py`, `pipeline/matchups.py` and `pipeline/export.py`. `build.py` writes
  `docs/data/pitchers.json`, `batters.json` (unweighted z-scored columns) and `matchups.json`
  (68,238 batter-pitcher pairs, about 3.3 MB).
- Removed `pipeline/graph.py`, `docs/app.js` and `docs/data/graph.json`, and dropped networkx and scikit-learn.
- The weekly workflow now commits `docs/data/*.json`.

### First findings
- At the default weights, for xwOBA with at least 40 PA per dot, the similarity signal does **not** beat the
  random baseline: r = −0.049 for similar batters, −0.073 for same-cluster batters, and
  −0.064 ± 0.042 for random batters.
- The random baseline is negative because each batter is left out of their own neighbor average
  (a leave-one-out effect). Always compare against the baseline, not against 0.
- The comps look sensible, e.g. Judge → Alonso, Acuña, Stanton.

### Verified / not verified
- Verified in headless Chrome: all three pages render, and slider edits re-cluster the batters and update the
  matchup charts (7 → 17 batter clusters when spray was turned off and resolution set to 2.0).
- Not verified: dragging sliders by hand in a real browser, and the `#player=` deep link opening
  the side panel on the graph pages.

### Next steps
- [ ] Tune weights and try whiff % / K % (they stabilize faster) to see whether any setting beats the baseline.
- [ ] Guard against overfitting the weights to one season: tune on 2024, check on 2025.
- [ ] Pool 2–3 seasons for bigger samples.
- [ ] Pitch-shape model (README idea 4): predict outcomes from pitch features plus batter features.
- [ ] Remaining items in the README's Roadmap / ideas section.
