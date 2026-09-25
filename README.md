# MLB Player Clusters

An end-to-end Statcast project that groups MLB **pitchers** by arsenal and delivery, groups **batters**
by contact, spray, discipline and swing, and then tests one question:

> **Do similar batters perform similarly against the same kind of pitcher?**
> If batters A and B are comps and A hits cluster X well, does B also hit cluster X well?

A Python pipeline turns about 700k pitches per season into player feature vectors and matchup totals.
A static site on GitHub Pages then does the similarity, graph building and clustering **in the browser**,
so every weight can be tuned live and the clusters and matchup charts update right away.

| | |
|---|---|
| **Data** | Baseball Savant pitch-level Statcast via `pybaseball`, 2025 regular season |
| **Players** | 478 pitchers (≥ 500 pitches), 391 batters (≥ 150 PA), 68k batter-pitcher pairs |
| **Pipeline** | Python: pandas, numpy, pyarrow (no scikit-learn or networkx) |
| **Site** | Vanilla ES modules, [force-graph](https://github.com/vasturiano/force-graph), and a Louvain implementation written from scratch |
| **Automation** | GitHub Actions rebuilds the data every Monday and commits it |

Dated notes, findings and next steps are kept in [PROGRESS.md](PROGRESS.md).

## The site

| Page | What it shows |
|---|---|
| **Pitchers** ([index.html](docs/index.html)) | Network graph where each edge links two pitchers whose arsenals and deliveries look alike (pitch mix, velocity, movement, spin, arm slot, release point, extension). Louvain clusters are colored. |
| **Batters** ([batters.html](docs/batters.html)) | The same kind of network for hitters: batting side, exit velo, launch angle, pull / center / oppo rates and how hard each is hit, plate discipline, bat tracking. |
| **Matchups** ([matchups.html](docs/matchups.html)) | Hot/cold heatmap of batter clusters vs pitcher clusters, a statistical test of the similar-batters hypothesis, and a batter lookup that estimates single matchups. *Rough draft.* |

Every page has a **Tune similarity** drawer. Moving a block or feature weight, k, the minimum similarity
or the Louvain resolution rebuilds the graph and clusters live. Settings are saved in localStorage and
shared across the three pages and across open tabs, so a batter clustering tuned on the Batters page is
the one the Matchups page uses.

## Findings so far

- **The clusters hold up.** The default weights were fit to the data (see below) and checked on a
  holdout half-season. Pair AUC went from 0.74 to 0.89 for pitchers and from 0.79 to 0.91 for batters.
- **The comps look sensible**, e.g. Judge → Alonso, Acuña, Stanton.
- **What the fit chose.** For pitchers, pitch usage dominates (slider, changeup and four-seam share), along
  with arm-side break and spin, while most delivery features lose weight. For batters, contact quality
  (barrel %, EV90) and batting side gain weight, and launch and discipline lose weight.
- **The main hypothesis is not supported yet.** Under the first (hand-picked) weights, for xwOBA with at
  least 40 PA per dot, similar batters did not predict a batter's result against a pitcher cluster any
  better than random batters (r = −0.049 for similar batters, −0.073 for same-cluster batters, and
  −0.064 ± 0.042 for random batters). Faster-stabilizing metrics (whiff %, K %), the data-fit weights and
  pooling several seasons are the next things to try.

## How it works

```
Baseball Savant ──pybaseball──▶ pitch-level rows (~700k / season)
        │  pipeline/fetch.py      (cached month by month in data/raw/*.parquet)
        ▼
  pitchers: clean + mirror LHP, aggregate pitcher × pitch family     pipeline/features.py
  batters:  batted-ball, spray, discipline, swing features           pipeline/batters.py
  matchups: per-pitch outcome counts summed per batter × pitcher     pipeline/matchups.py
        ▼
  docs/data/pitchers.json, batters.json   unweighted z-scored feature columns + default weights
  docs/data/matchups.json                 additive totals per pair / player / league (~3.3 MB)
        ▼
  browser (docs/js/similarity.js): weights → distance → kernel similarity
                                   → kNN graph → Louvain clusters  ──▶  GitHub Pages
```

The pipeline only exports **unweighted** z-scored columns plus the default weights. Every modeling
choice after that happens client-side, so trying a new weighting never needs a rebuild.

### Pitcher features

| Block | Contents | Notes |
|---|---|---|
| Usage | share of each pitch family (4-Seam, Sinker, Cutter, Slider, Sweeper, Curve, Changeup, Splitter, Knuckle) | Savant codes are grouped into families in `config.PITCH_FAMILIES` |
| Pitch shape | velocity, horizontal break, induced vertical break, spin rate, spin axis (sin/cos) for each family | z-scored *within* the family, then multiplied by √usage so pitches thrown often count more |
| Delivery | arm angle, release height, release side, extension | Uses Savant's `arm_angle` column when present |

Horizontal values are mirrored so **+ always means arm side**. That lets lefties and righties with the
same shape land next to each other (set `MIX_HANDEDNESS = False` to keep them apart). A pitch only counts
if it is at least 3% of the arsenal and thrown at least 25 times.

### Batter features (at least `MIN_BATTER_PA` PA)

| Block | Contents |
|---|---|
| Batting side | share of PAs batting left-handed (switch hitters land in between) |
| Contact quality | average EV, 90th-percentile EV, hard-hit %, barrel %, sweet-spot % |
| Launch | average launch angle and its spread, GB / LD / FB / popup % |
| Spray | pull / center / oppo %, average EV in each direction, pulled-air % |
| Plate discipline | swing %, chase %, zone contact %, whiff % |
| Swing tracking | bat speed, swing length, attack angle (slowest 10% of swings dropped) |

Spray angle is mirrored per pitch so **+ always means pull side** (switch hitters are mirrored PA by PA).
Pull / oppo means more than `PULL_ANGLE` (15°) from straightaway center.

### Similarity and clusters (in the browser)

Each column is multiplied by *block weight × feature weight / √(block width)*, so a block does not
outweigh the others just because it has more columns. Similarity is `exp(-d² / 2σ²)` on Euclidean
distance, where σ is the median distance to each player's k-th nearest neighbor. Each player links to
their top-k matches at or above the minimum similarity, and always to their single closest match.
Louvain then clusters the graph; the resolution setting controls how many clusters you get.

**Default weights are fit, not hand-picked.** Starting from every weight at 1, a coordinate search
changed block and feature weights (range 0.25–3) and k / resolution / min similarity to maximize
**pair AUC**: the probability that two players in the same cluster are closer than two players in
different clusters. Each candidate was re-clustered before scoring, and the cluster count was held near
its starting value (pitchers 10–12, batters 6–8) so the score could not be raised just by adding
clusters. Weights were fit on March–June 2025 and checked on July–October 2025:

| Holdout (Jul–Oct) | pair AUC | silhouette | top-10 comps in same cluster |
|---|---|---|---|
| Pitchers: all weights 1 → fit | 0.740 → 0.892 | 0.043 → 0.166 | 62% → 78% |
| Batters: all weights 1 → fit | 0.793 → 0.912 | 0.076 → 0.207 | 70% → 91% |

The fitted values live in `config.WEIGHTS` / `FEATURE_WEIGHTS`, `config.BATTER_WEIGHTS` /
`BATTER_FEATURE_WEIGHTS`, `GRAPH` and `BATTER_GRAPH`. They are what the tuner starts from and what
**Reset** returns to.

**Clusters are not named in advance.** The legend shows *Cluster N* plus the three weighted features
where that cluster's average differs most from the league (in z-scores), e.g.
"Slider usage ↑ · Sweeper usage ↓". What a cluster *means* is read off those profiles.

### Matchup model (rough draft)

`matchups.json` stores additive counts per pitch (pitches, PAs, xwOBA and wOBA numerators, run value,
swings, whiffs, K, BB), summed per batter × pitcher × same-hand. Because the counts add up, the browser
can compute any rate for any grouping of clusters without reading pitches again.

- **Expected value.** For each pair, expected = batter's rate + pitcher's rate − league rate, using
  same-hand or opposite-hand splits (shrunk toward each player's overall rate). *Result vs expected* is
  the matchup effect with talent removed.
- **Heatmap.** Rows are batter clusters and columns are pitcher clusters. Red is better for the batter
  and blue is worse. With shrinkage on, a cell's delta is scaled by `n / (n + k)`, so thin samples fade
  to gray.
- **Hypothesis check.** For every batter × pitcher-cluster pair with enough sample, it compares the
  batter's own delta with the similarity-weighted delta of the other batters against the same cluster.
  It reports r for similarity-weighted neighbors, same-cluster batters, and randomly shuffled batters as
  a baseline. The baseline is slightly negative, not 0, because each batter is left out of their own
  neighbor average, so compare against the baseline.
- **Batter lookup.** A strip of the batter's results against each pitcher cluster (own, similar batters,
  blended) and the pitchers they faced most. For one pitcher it shows a shrinkage chain: similar batters
  vs the pitcher's cluster → the batter vs that cluster → the batter vs pitchers similar to this one →
  the direct matchup. Each step is blended with the one before it by `(Σ delta + k · fallback) / (n + k)`.
- **Controls.** Metric (xwOBA, wOBA, run value per 100 pitches, whiff %, K %), platoon filter (all,
  opposite hand, same hand), color by result vs expected or vs league, and shrinkage strength.

## Configuration

Everything the pipeline uses is in [pipeline/config.py](pipeline/config.py):

| Setting | Default | Purpose |
|---|---|---|
| `SEASON`, `START_DATE`, `END_DATE` | 2025, Mar 18 – Oct 1 | Data window (regular season only) |
| `MIN_TOTAL_PITCHES` | 500 | Pitcher qualification |
| `MIN_PITCH_USAGE`, `MIN_PITCH_COUNT` | 3%, 25 | When a pitch counts as part of an arsenal |
| `MIN_BATTER_PA`, `PULL_ANGLE` | 150, 15° | Batter qualification and the pull/oppo cutoff |
| `MIX_HANDEDNESS` | `True` | Mirror LHP so both hands share one space |
| `WEIGHTS`, `FEATURE_WEIGHTS`, `GRAPH` | fitted | Pitcher defaults for the tuner |
| `BATTER_WEIGHTS`, `BATTER_FEATURE_WEIGHTS`, `BATTER_GRAPH` | fitted | Batter defaults for the tuner |

To keep settings you tuned on the site, use **Copy settings** in the tuner and paste the values into
`config.py`.

## Project layout

```
pipeline/
  config.py        data window, filters, default weights, graph settings
  fetch.py         pybaseball Statcast pull with a month-by-month parquet cache
  features.py      pitcher cleaning, handedness mirroring, arsenal aggregation, feature matrix
  batters.py       batter feature matrix
  matchups.py      per-pitch outcome counts → per-pair / per-player / league totals
  export.py        writes docs/data/*.json
  build.py         entry point
docs/              ← GitHub Pages serves this folder
  index.html, batters.html, matchups.html, style.css
  js/similarity.js   weights → similarity → kNN graph → Louvain (shared by all pages)
  js/settings.js     tuning drawer + saved, cross-tab settings
  js/common.js       colors, headshots, cluster profiles
  js/graph-page.js   force-graph page shared by pitchers.js and batters.js
  js/pitchers.js     pitcher side panel (arsenal table)
  js/batters.js      batter side panel (contact, spray, batted-ball types)
  js/matchups.js     heatmap, hypothesis test, batter lookup
  data/*.json        generated by the pipeline and committed
.github/workflows/update-data.yml   weekly rebuild + commit
PROGRESS.md        dated log of changes, findings and next steps
```

## Quick start

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python pipeline/build.py            # first run downloads a full season (about 15–30 min), then uses the cache

cd docs; python -m http.server 8000 # open http://localhost:8000
```

The pages use ES modules, so open them through a local server, not by double-clicking the HTML file.
The generated JSON is committed, so you can skip the build step and serve `docs/` directly.

## Deploy on GitHub Pages

1. Push the repo with `docs/data/*.json` included.
2. Go to **Settings → Pages → Build and deployment**, choose *Deploy from a branch*, and select `main` and `/docs`.
3. The site goes live at `https://<user>.github.io/<repo>/`.
4. [update-data.yml](.github/workflows/update-data.yml) rebuilds the data every Monday at 10:00 UTC and
   commits it, which redeploys the site. It can also be run by hand from the Actions tab.

## Using the graphs

- Hover over a player to highlight their direct neighbors.
- Click a player to open a side panel with their headshot, key stats, a link to their Baseball Savant page,
  and their 10 most similar players. Click a name in that list to jump to that player. **Matchups →** opens
  the player on the matchup page.
- Use the search box to find and zoom to a player.
- Click a cluster in the legend to show only that cluster; click it again to clear the filter.
- **Tune similarity** opens the weight sliders. **Copy settings** copies the current settings as JSON.
- Deep links: `index.html#player=<mlbam_id>`, `batters.html#player=<mlbam_id>`,
  `matchups.html#batter=<id>&pitcher=<id>`.

## Roadmap

**Matchup plan: built so far**

- [x] Cluster batters the same way pitchers are clustered
- [x] Batter-cluster vs pitcher-cluster heatmap, colored by result vs expected, faded by sample size
- [x] Shrinkage (partial pooling) toward a fallback chain for single matchups
- [x] Similarity weighting instead of hard clusters, on the batter side
- [x] Pitch-level metrics (run value, whiff %) alongside PA-level ones
- [x] Hypothesis test against a random-batter baseline
- [x] Data-fit default weights with a holdout check

**Next**

- [ ] Re-run the hypothesis test with the data-fit weights and with whiff % / K %, which stabilize faster.
- [ ] Pool 2–3 seasons for bigger samples; fit weights on one season and check them on another.
- [ ] Fit the shrinkage `k` from the data (empirical Bayes), or use a hierarchical model.
- [ ] Two-sided similarity (similar batters vs similar pitchers), a collaborative-filtering version of the test.
- [ ] **Pitch-shape model**: predict outcomes from pitch features (velocity, movement, arm slot, type)
      plus batter features, e.g. with gradient boosting, then score a matchup by averaging over the
      pitcher's arsenal weighted by usage. This also covers matchups that have never happened.

**Site and features**

- [ ] **Season selector**: build one data set per season and switch between them from a dropdown.
- [ ] **Role filter**: split starters and relievers (by games started or pitches per appearance).
- [ ] **Better arm slot**: fall back to a height-normalized arm angle for seasons without Savant's `arm_angle`.
- [ ] **Pitch-level matching**: pair each pitch with its closest counterpart in the other pitcher's
      arsenal (a Hungarian-assignment distance) instead of a fixed family vector, so a gyro slider and a
      cutter can still count as partial matches.
- [ ] **UMAP seed layout**: start the force layout from a 2D UMAP embedding so the global structure is easier to read.
- [ ] **Movement plot in the panel**: a small HB-vs-IVB scatter of each pitch, colored by pitch type.
- [ ] **Edge explanations**: show which features drive a given similarity.

---

Built by Hayden Lee
