# Pitcher Graph

Clusters MLB pitchers and batters from Statcast data, then asks whether **similar batters perform
similarly against the same kind of pitcher**. The static site has three pages:

| Page | What it shows |
|---|---|
| **Pitchers** (`index.html`) | Obsidian-style network: each edge links two pitchers whose arsenals and deliveries look alike (pitch mix, velocity, movement, spin, arm slot, release point, extension). Louvain clusters are colored. |
| **Batters** (`batters.html`) | Same network for hitters: batting side, exit velo, launch angle, pull / center / oppo rates and how hard each is hit, plate discipline, bat tracking. |
| **Matchups** (`matchups.html`) | Hot/cold chart of batter clusters against pitcher clusters, a test of the similar-batters hypothesis, and a batter lookup that estimates single matchups. *Rough draft.* |

Similarity and clustering run **in the browser**, so every page has a **Tune similarity** drawer:
move a block or feature weight and the graph, clusters and matchup charts update live. Tuned
settings are saved in the browser and shared across the three pages (and across open tabs).

Status, findings so far and next steps are in [PROGRESS.md](PROGRESS.md).

## How it works

```
Baseball Savant ──pybaseball──▶ pitch-level rows (~700k / season)
        │  pipeline/fetch.py      (cached month-by-month in data/raw/*.parquet)
        ▼
  pitchers: clean + mirror LHP, aggregate pitcher × pitch family     pipeline/features.py
  batters:  batted-ball, spray, discipline, swing features           pipeline/batters.py
  matchups: per-pitch outcome counts summed per batter × pitcher     pipeline/matchups.py
        ▼
  docs/data/pitchers.json, batters.json   unweighted z-scored feature columns
  docs/data/matchups.json                 additive totals per pair / player / league
        ▼
  browser (docs/js/similarity.js): weights → distance → kernel similarity
                                   → kNN graph → Louvain clusters  ──▶  GitHub Pages
```

### Feature vector (per pitcher)

| Block | Contents | Notes |
|---|---|---|
| Usage | share of each pitch family (4-Seam, Sinker, Cutter, Slider, Sweeper, Curve, Changeup, Splitter, Knuckle) | Savant codes are grouped into families in `config.PITCH_FAMILIES` |
| Pitch shape | velocity, horizontal break, induced vertical break, spin rate, spin axis (sin/cos) for each family | z-scored *within* the family, then multiplied by √usage so pitches thrown often count more |
| Delivery | arm angle, release height, release side, extension | Savant's `arm_angle` column is used when it's present |

Horizontal values are mirrored so **+ always means arm side**, which lets lefties and
righties with the same shape land next to each other (set `MIX_HANDEDNESS = False` to keep them apart).

### Feature vector (per batter, at least `MIN_BATTER_PA` PA)

| Block | Contents |
|---|---|
| Batting side | share of PAs batting left-handed (switch hitters land in between) |
| Contact quality | average EV, 90th-percentile EV, hard-hit %, barrel %, sweet-spot % |
| Launch | average launch angle and its spread, GB / LD / FB / popup % |
| Spray | pull / center / oppo %, average EV in each direction, pulled-air % |
| Plate discipline | swing %, chase %, zone contact %, whiff % |
| Swing tracking | bat speed, swing length, attack angle (the slowest 10% of swings dropped) |

Spray angle is mirrored per pitch so **+ always means pull side**; pull / oppo means more than
`PULL_ANGLE` (15°) from straightaway center.

### Similarity and clusters (in the browser)

Each column is multiplied by *block weight × feature weight / √(block width)*, so no block
outweighs the others just because it has more columns. Similarity is `exp(-d² / 2σ²)` on Euclidean
distance, where σ is the median distance to each player's k-th nearest neighbor. Each player links to
their top-k matches that are at or above the minimum similarity, and always to their single closest
match. Louvain then clusters the graph (the resolution setting controls how many clusters you get).
`config.WEIGHTS` / `FEATURE_WEIGHTS`, `config.BATTER_WEIGHTS` / `BATTER_FEATURE_WEIGHTS`, `GRAPH` and
`BATTER_GRAPH` are the defaults the tuner starts from and the values **Reset** returns to.

**How the default weights were set.** The weights were not picked by hand. Starting from every weight at 1,
a coordinate search changed block and feature weights (range 0.25–3) and k / resolution / min similarity
to maximize **pair AUC**: the probability that two players in the same cluster are closer than two players
in different clusters. Each candidate was re-clustered and then scored. The number of clusters was held
near its starting value (pitchers 10–12, batters 6–8), so the score could not be raised just by adding
clusters. Weights were fit on March–June 2025 and checked on July–October 2025:

| Holdout (Jul–Oct) | pair AUC | silhouette | top-10 comps in same cluster |
|---|---|---|---|
| Pitchers: all weights 1 → fit | 0.740 → 0.892 | 0.043 → 0.166 | 62% → 78% |
| Batters: all weights 1 → fit | 0.793 → 0.912 | 0.076 → 0.207 | 70% → 91% |

**Clusters are not named in advance.** The legend shows *Cluster N* plus the three features where that
cluster's average differs most from the league (z-scores, among weighted features), e.g.
"Slider usage ↑ · Sweeper usage ↓". What a cluster *means* is read off those profiles.

### Matchup page (rough draft)

- **Expected value.** For each batter-pitcher pair, expected = batter's overall rate + pitcher's
  overall rate − league rate, using same-hand or opposite-hand splits (shrunk toward the player's
  overall rate). *Result vs expected* is therefore the matchup effect with talent removed.
- **Heatmap.** Rows are batter clusters and columns are pitcher clusters. Red means better for the
  batter and blue means worse. With shrinkage on, a cell's delta is scaled by `n / (n + k)`, so
  thin samples fade to gray.
- **Hypothesis check.** For every batter × pitcher-cluster pair with enough sample, it compares
  the batter's own delta with the similarity-weighted delta of the other batters against the same
  cluster. It reports r for similarity-weighted neighbors, for same-cluster batters, and for
  randomly shuffled batters as a baseline. (The baseline is not 0: leaving the batter out makes the
  random r slightly negative, so compare against the baseline, not against zero.)
- **Batter lookup.** Shows a strip of the batter's results against each pitcher cluster (own,
  similar batters, blended) and the pitchers they faced most. For one pitcher it shows the shrinkage
  chain: similar batters vs the pitcher's cluster → the batter vs that cluster → the batter vs
  pitchers similar to this one → the direct matchup. Each step is blended with the step before it by
  `(Σ delta + k · fallback) / (n + k)`.
- Metrics: xwOBA, wOBA, run value per 100 pitches, whiff %, K %. Platoon filter: all, opposite hand, same hand.

## Project layout

```
pipeline/
  config.py      data window, filters, default weights, k, thresholds
  fetch.py       pybaseball Statcast pull with a parquet cache
  features.py    pitcher cleaning, aggregation, feature matrix
  batters.py     batter feature matrix
  matchups.py    per-pair / per-player outcome totals
  export.py      writes docs/data/*.json
  build.py       entry point
docs/            ← GitHub Pages serves this folder
  index.html, batters.html, matchups.html, style.css
  js/similarity.js   weights → similarity → kNN graph → Louvain (shared)
  js/settings.js     tuning drawer + saved settings
  js/graph-page.js   force-graph page used by pitchers.js and batters.js
  js/matchups.js     matchup page
  data/*.json        generated by the pipeline and committed
.github/workflows/update-data.yml   optional weekly rebuild
```

## Quick start

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python pipeline/build.py            # first run downloads a full season (roughly 15–30 min), then uses the cache

cd docs; python -m http.server 8000 # open http://localhost:8000
```

The pages use ES modules, so open them through a local server, not by double-clicking the HTML file.

## Publish on GitHub Pages

1. `git init`, commit, and push to a new GitHub repo (commit `docs/data/*.json` as well).
2. In the repo, go to **Settings → Pages → Build and deployment**, choose *Deploy from a branch*, and select `main` and `/docs`.
3. The site goes live at `https://<user>.github.io/<repo>/`.
4. Optional: the workflow in `.github/workflows/update-data.yml` rebuilds the data every Monday and can also be run by hand from the Actions tab.

## Using the graphs

- Hover over a player to highlight their direct neighbors.
- Click a player to open a side panel with their headshot, key stats and 10 most similar players. Click a name in that list to jump to it. **Matchups →** opens that player on the matchup page.
- Use the search box to find and zoom to a player.
- Click a cluster in the legend to show only that cluster; click it again to clear the filter.
- **Tune similarity** opens the weight sliders. **Copy settings** copies the current settings as JSON, so you can move good values into `config.py`.
- Deep links: `index.html#player=<mlbam_id>`, `batters.html#player=<mlbam_id>`, `matchups.html#batter=<id>&pitcher=<id>`.

## Future direction: batter clusters and matchups (rough draft built: see the Matchups page)

**Main goal:** find out whether pitchers and batters can be clustered in a meaningful way, and
whether **similar batters perform similarly against the same cluster of pitchers**.
For example, if batters A and B are similar and A hits well against pitcher cluster X, does B
also hit well against cluster X?

1. **Cluster batters** the same way pitchers are clustered, using features such as:
   - batting side (L / R / switch)
   - launch angle and exit velocity
   - pull / center / push ratios
   - how hard the ball is hit on pulled balls versus pushed balls
   - (possibly) plate discipline: chase rate, whiff rate, zone contact
2. **Batter-cluster vs pitcher-cluster matchups**: combine the two sets of clusters and measure
   outcomes (wOBA, xwOBA, K%, BB%, hard-hit %, etc.) for each batter cluster against each pitcher cluster.
3. **Test the hypothesis**: check whether batters in the same cluster show similar performance
   against a given pitcher cluster (for example, compare within-cluster and between-cluster
   variance in matchup results, or predict a batter's results against cluster X from their
   cluster-mates' results against it).

### Planned visual: matchup hot/cold chart

This works like a hot/cold zone chart: a cell is **red** when the batter does well against a
pitcher (or pitcher cluster) and **blue** when the batter does poorly.

**The problem:** a single batter against a single pitcher gives only a few plate appearances,
which is too few to trust. Pooling against a whole cluster gives more data but hides how much
the pitchers inside that cluster differ from each other.

**Ideas to fix it:**

1. **Shrinkage (partial pooling):** blend the direct matchup with a fallback, weighted by sample size:
   `estimate = (n · batter_vs_pitcher + k · fallback) / (n + k)`.
   The fallback chain runs batter vs pitcher cluster → batter cluster vs pitcher cluster → the
   batter's overall line. Fit `k` from the data (empirical Bayes), or use a mixed-effects or
   Bayesian hierarchical model.
2. **Weight by similarity instead of hard clusters:** estimate batter B against pitcher P as a
   similarity-weighted average of B's results against every pitcher, using the kernel that
   already builds the pitcher graph. Close comps count more and distant cluster-mates count
   less. Doing this on the batter side too (similar batters against similar pitchers) gives a
   collaborative-filtering setup that tests the main hypothesis directly.
3. **Use pitch-level outcomes and expected stats:** use run value per pitch, whiff %, and xwOBA
   on contact (about 4× the sample of PA-level stats, and they stabilize faster). Pool 2–3 seasons.
4. **Model pitch shape instead of pitcher identity:** predict outcomes from pitch features (velocity,
   movement, arm slot, pitch type) together with batter features, for example with gradient
   boosting. Then score a matchup by averaging over the pitcher's arsenal, weighted by usage.
   This also works for matchups that have never happened.
5. **Build uncertainty into the chart:**
   - Color by performance **relative to expectation** (a log5 or odds-ratio baseline from the
     batter's and pitcher's overall numbers), not by raw performance.
   - Set color saturation or opacity by sample size or confidence, and gray out cells with too little data.

**Suggested first version:** pitch-level xwOBA or run value, plus similarity weighting (2),
plus shrinkage (1), shown as "vs expected" with opacity for confidence. Move to the pitch-shape
model (4) if that version shows promise.

## Roadmap / ideas

- [ ] **Tune weights**: check that known comps come out as neighbors (e.g. the sweeper-heavy righties).
- [ ] **Season selector**: build `graph_2023.json`, `graph_2024.json`, etc. and add a dropdown to switch between them.
- [ ] **Role filter**: split SP and RP (by games started, or by pitches per appearance).
- [ ] **Better arm slot**: fall back to a height-normalized arm angle for seasons without Savant's `arm_angle`.
- [ ] **Pitch-level matching**: pair each pitch with its closest counterpart in the other pitcher's arsenal (a Hungarian-assignment distance) instead of a fixed family vector, so "gyro slider" and "cutter" can still count as partial matches.
- [ ] **UMAP seed layout**: start the force layout from a 2D UMAP embedding so the global structure is easier to read.
- [ ] **Movement plot in the panel**: a small HB-vs-IVB scatter of each pitch, colored by pitch type.
- [ ] **Edge explanations**: show which features drive a given similarity.
