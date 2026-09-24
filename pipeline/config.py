"""Central knobs for the pipeline. Tweak these, re-run build.py, refresh the site."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "raw"          # parquet cache of raw Statcast pulls (git-ignored)
OUTPUT_DIR = ROOT / "docs" / "data"           # pitchers.json, batters.json, matchups.json

# --- Data window -------------------------------------------------------------
SEASON = 2025
START_DATE = f"{SEASON}-03-18"
END_DATE = f"{SEASON}-10-01"

# --- Filters -----------------------------------------------------------------
MIN_TOTAL_PITCHES = 500      # pitcher must throw at least this many pitches
MIN_PITCH_USAGE = 0.03       # a pitch type must be >= 3% of arsenal to count
MIN_PITCH_COUNT = 25         # ...and thrown at least this many times

# --- Pitch families ----------------------------------------------------------
# Savant has many pitch codes; collapse them into families so a "SV" and an "ST"
# pitcher can still be compared. Codes not listed here are dropped (PO, EP, etc.).
PITCH_FAMILIES = {
    "FF": "4-Seam",
    "SI": "Sinker",
    "FC": "Cutter",
    "SL": "Slider",
    "ST": "Sweeper",
    "SV": "Sweeper",   # slurve behaves most like a sweeper
    "CU": "Curve",
    "KC": "Curve",
    "CS": "Curve",
    "CH": "Changeup",
    "FS": "Splitter",
    "FO": "Splitter",
    "SC": "Changeup",  # screwball ~ arm-side fade
    "KN": "Knuckle",
}
FAMILY_ORDER = ["4-Seam", "Sinker", "Cutter", "Slider", "Sweeper",
                "Curve", "Changeup", "Splitter", "Knuckle"]

# Per-pitch features aggregated for each (pitcher, family)
PITCH_FEATURES = ["velo", "h_break", "v_break", "spin", "spin_axis_sin", "spin_axis_cos"]

# Pitcher-level (delivery) features
DELIVERY_FEATURES = ["arm_angle", "release_height", "release_side", "extension"]

# --- Weighting ---------------------------------------------------------------
# Default block and feature weights. The site applies them in the browser, so they
# can also be tuned live there (any feature not listed has weight 1).
# These are NOT hand-picked: starting from all weights = 1, they were fit to the
# data so that players in the same cluster are closer than players in different
# clusters (pair AUC), fit on Mar-Jun 2025 and checked on Jul-Oct 2025.
# What each cluster represents is read off the clusters afterwards.
WEIGHTS = {"usage": 2.0, "pitch": 1.0, "delivery": 1.0}
FEATURE_WEIGHTS = {
    "usage.4-Seam": 2.0, "usage.Cutter": 0.25, "usage.Slider": 3.0, "usage.Curve": 0.5,
    "usage.Changeup": 3.0,
    "pitch.h_break": 2.0, "pitch.v_break": 0.4, "pitch.spin": 2.0,
    "delivery.arm_angle": 0.9, "delivery.release_height": 0.5, "delivery.release_side": 0.25,
}
# If True, LHP and RHP can be neighbors (horizontal features are mirrored to
# "arm-side positive"). If False, handedness is added as a heavy feature.
MIX_HANDEDNESS = True

# --- Batters -----------------------------------------------------------------
MIN_BATTER_PA = 150          # batter must have at least this many plate appearances
PULL_ANGLE = 15              # spray angle (deg from center) beyond which a ball is pull / oppo
BATTER_WEIGHTS = {"side": 3.0, "contact": 2.0, "launch": 0.45, "spray": 1.0,
                  "discipline": 0.4, "swing": 1.0}
BATTER_FEATURE_WEIGHTS = {
    "contact.ev_90": 2.0, "contact.barrel": 3.0, "contact.sweet_spot": 0.25,
    "launch.la_mean": 0.65, "launch.la_std": 1.5, "launch.ld": 1.5,
    "spray.pull": 0.5, "spray.oppo": 0.8, "spray.pull_air": 0.65,
    "discipline.swing": 1.5, "discipline.z_contact": 0.5, "discipline.whiff": 0.5,
    "swing.attack_angle": 0.8,
}

# --- Graph (defaults; tunable live on the site) --------------------------------
# k: each player links to its top-k most similar
# min_sim: drop edges weaker than this (0-1); the nearest match is always kept
# resolution: Louvain resolution, higher = more, smaller clusters
GRAPH = {"k": 5, "min_sim": 0.40, "resolution": 1.0}
BATTER_GRAPH = {"k": 7, "min_sim": 0.20, "resolution": 0.6}
