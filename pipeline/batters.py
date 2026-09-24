"""Turn pitch-level Statcast rows into one feature vector per batter.

Conventions
-----------
* Spray angle is mirrored per pitch so that **positive = pull side** for both
  sides of the plate (switch hitters are mirrored PA by PA).
* A ball is pulled / oppo when it leaves more than PULL_ANGLE degrees from
  straightaway center.
* Every column is z-scored; block weights are applied in the browser.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import MIN_BATTER_PA, PULL_ANGLE
from features import _zscore

SWINGS = {"swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
          "hit_into_play", "foul_bunt", "missed_bunt", "bunt_foul_tip"}
WHIFFS = {"swinging_strike", "swinging_strike_blocked", "foul_tip", "missed_bunt"}

# (block, column, label) — label is used for auto cluster names and the panel
BATTER_COLUMNS = [
    ("side", "lhb_share", "LHB share"),
    ("contact", "ev_mean", "EV"),
    ("contact", "ev_90", "EV90"),
    ("contact", "hard_hit", "Hard-hit"),
    ("contact", "barrel", "Barrel"),
    ("contact", "sweet_spot", "Sweet-spot"),
    ("launch", "la_mean", "Launch angle"),
    ("launch", "la_std", "LA spread"),
    ("launch", "gb", "GB"),
    ("launch", "ld", "LD"),
    ("launch", "fb", "FB"),
    ("launch", "pu", "Popup"),
    ("spray", "pull", "Pull"),
    ("spray", "center", "Center"),
    ("spray", "oppo", "Oppo"),
    ("spray", "ev_pull", "Pull EV"),
    ("spray", "ev_center", "Center EV"),
    ("spray", "ev_oppo", "Oppo EV"),
    ("spray", "pull_air", "Pulled air"),
    ("discipline", "swing", "Swing"),
    ("discipline", "chase", "Chase"),
    ("discipline", "z_contact", "Z-contact"),
    ("discipline", "whiff", "Whiff"),
    ("swing", "bat_speed", "Bat speed"),
    ("swing", "swing_length", "Swing length"),
    ("swing", "attack_angle", "Attack angle"),
]


def batter_features(df: pd.DataFrame) -> pd.DataFrame:
    """Raw (unscaled) feature values, one row per qualifying batter."""
    df = df[df["batter"].notna()]
    pa = df.groupby("batter")["woba_denom"].sum()
    df = df[df["batter"].isin(pa[pa >= MIN_BATTER_PA].index)].copy()

    ends = df[df["woba_denom"].eq(1)]
    out = pd.DataFrame({"pa": pa.reindex(df["batter"].unique()).astype(int)})
    out["lhb_share"] = ends.groupby("batter")["stand"].agg(lambda s: s.eq("L").mean())

    # Batted balls ---------------------------------------------------------------
    bip = df[df["type"].eq("X") & df["launch_speed"].notna()].copy()
    ls, la = bip["launch_speed"], bip["launch_angle"]
    bip["hard"] = ls.ge(95)
    bip["barrel"] = bip["launch_speed_angle"].eq(6)
    bip["sweet"] = la.between(8, 32)
    for t, col in [("ground_ball", "gb"), ("line_drive", "ld"), ("fly_ball", "fb"), ("popup", "pu")]:
        bip[col] = bip["bb_type"].eq(t)

    spray = np.degrees(np.arctan2(bip["hc_x"] - 125.42, 198.27 - bip["hc_y"]))
    pull_angle = np.where(bip["stand"].eq("R"), -spray, spray)
    bip["dir"] = np.select([pull_angle > PULL_ANGLE, pull_angle < -PULL_ANGLE], ["pull", "oppo"], "center")
    bip.loc[spray.isna(), "dir"] = None
    bip["pull_air"] = bip["dir"].eq("pull") & bip["bb_type"].isin(["line_drive", "fly_ball"])

    g = bip.groupby("batter")
    out["ev_mean"] = g["launch_speed"].mean()
    out["ev_90"] = g["launch_speed"].quantile(0.9)
    out["hard_hit"] = g["hard"].mean()
    out["barrel"] = g["barrel"].mean()
    out["sweet_spot"] = g["sweet"].mean()
    out["la_mean"] = g["launch_angle"].mean()
    out["la_std"] = g["launch_angle"].std()
    for col in ["gb", "ld", "fb", "pu", "pull_air"]:
        out[col] = g[col].mean()

    sprayed = bip[bip["dir"].notna()]
    shares = pd.crosstab(sprayed["batter"], sprayed["dir"], normalize="index")
    ev_dir = sprayed.pivot_table(index="batter", columns="dir", values="launch_speed", aggfunc="mean")
    for d in ["pull", "center", "oppo"]:
        out[d] = shares.get(d)
        out[f"ev_{d}"] = ev_dir.get(d)

    # Plate discipline -------------------------------------------------------------
    desc = df["description"]
    swing, whiff = desc.isin(SWINGS), desc.isin(WHIFFS)
    in_zone, out_zone = df["zone"].between(1, 9), df["zone"].between(11, 14)
    tmp = pd.DataFrame({
        "batter": df["batter"], "sw": swing, "wh": whiff,
        "o_sw": swing & out_zone, "o": out_zone,
        "z_sw": swing & in_zone, "z_wh": whiff & in_zone,
    }).groupby("batter").sum()
    out["swing"] = df.assign(sw=swing).groupby("batter")["sw"].mean()
    out["chase"] = tmp["o_sw"] / tmp["o"]
    out["z_contact"] = 1 - tmp["z_wh"] / tmp["z_sw"]
    out["whiff"] = tmp["wh"] / tmp["sw"]

    # Swing tracking: drop each batter's slowest 10% of swings (checked swings, bunts)
    sw = df[df["bat_speed"].notna()]
    floor = sw.groupby("batter")["bat_speed"].transform(lambda s: s.quantile(0.1))
    sw = sw[sw["bat_speed"] >= floor].groupby("batter")
    for col in ["bat_speed", "swing_length", "attack_angle"]:
        out[col] = sw[col].mean() if col in df.columns else np.nan

    return out


def build_batter_matrix(feats: pd.DataFrame):
    """z-scored feature matrix + column tags, in BATTER_COLUMNS order."""
    cols = [c for _, c, _ in BATTER_COLUMNS]
    X = _zscore(feats[cols].astype(float))
    columns = [{"block": b, "feature": c, "label": lab} for b, c, lab in BATTER_COLUMNS]
    return X, columns
