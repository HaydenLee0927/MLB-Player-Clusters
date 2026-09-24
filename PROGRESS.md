# Progress log

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
