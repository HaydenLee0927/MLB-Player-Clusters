"""Turn pitch-level Statcast rows into one feature vector per pitcher.

Conventions
-----------
* Horizontal quantities are mirrored so that **positive = arm side** for both
  RHP and LHP. That lets a lefty sinker-baller match a righty sinker-baller.
* Movement is in inches (Statcast pfx_* is in feet). v_break is induced
  vertical break (gravity removed), which is what Savant shows as "IVB".
* Pitch features are z-scored *within each pitch family*, so a value of 0
  means "league-average version of this pitch". They are then scaled by
  sqrt(usage) so a 4% show-me curveball barely moves the vector while a 50%
  fastball dominates it.
* No block weights are applied here; the site applies them so they can be tuned.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (DELIVERY_FEATURES, FAMILY_ORDER, MIN_PITCH_COUNT,
                    MIN_PITCH_USAGE, MIN_TOTAL_PITCHES, MIX_HANDEDNESS,
                    PITCH_FAMILIES, PITCH_FEATURES)


# ---------------------------------------------------------------------------
# 1. Clean pitch-level data
# ---------------------------------------------------------------------------
def clean_pitches(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["family"] = df["pitch_type"].map(PITCH_FAMILIES)
    df = df.dropna(subset=["family", "release_speed", "pfx_x", "pfx_z"])

    lefty = df["p_throws"].eq("L")
    arm_sign = np.where(lefty, 1.0, -1.0)  # RHP arm side is -x from catcher view

    df["velo"] = df["release_speed"]
    df["h_break"] = df["pfx_x"] * 12 * arm_sign
    df["v_break"] = df["pfx_z"] * 12
    df["spin"] = df["release_spin_rate"]
    df["release_height"] = df["release_pos_z"]
    df["release_side"] = df["release_pos_x"] * arm_sign
    df["extension"] = df["release_extension"]

    # Spin axis is circular (0 == 360) -> encode as sin/cos; mirror for LHP.
    axis = np.where(lefty, 360 - df["spin_axis"], df["spin_axis"])
    rad = np.deg2rad(axis)
    df["spin_axis_sin"], df["spin_axis_cos"] = np.sin(rad), np.cos(rad)

    # Savant publishes arm_angle (2020+). Fallback: crude angle of release point
    # above an assumed ~5ft shoulder height. Good enough to separate slots.
    if "arm_angle" not in df.columns or df["arm_angle"].isna().all():
        df["arm_angle"] = np.degrees(
            np.arctan2(df["release_height"] - 5.0, df["release_side"].abs())
        )
    return df


# ---------------------------------------------------------------------------
# 2. Aggregate to pitcher x pitch-family
# ---------------------------------------------------------------------------
def aggregate(df: pd.DataFrame):
    totals = df.groupby("pitcher").size()
    keep = totals[totals >= MIN_TOTAL_PITCHES].index
    df = df[df["pitcher"].isin(keep)]

    arsenal = (
        df.groupby(["pitcher", "family"])
        .agg(n=("velo", "size"),
             **{f: (f, "mean") for f in PITCH_FEATURES})
        .reset_index()
    )
    arsenal["usage"] = arsenal["n"] / arsenal.groupby("pitcher")["n"].transform("sum")
    arsenal = arsenal[(arsenal["usage"] >= MIN_PITCH_USAGE) & (arsenal["n"] >= MIN_PITCH_COUNT)]
    # Re-normalise so usage sums to 1 after dropping rare pitches
    arsenal["usage"] = arsenal["n"] / arsenal.groupby("pitcher")["n"].transform("sum")

    delivery = df.groupby("pitcher").agg(
        throws=("p_throws", "first"),
        pitches=("velo", "size"),
        **{f: (f, "mean") for f in DELIVERY_FEATURES},
    )
    delivery = delivery.loc[arsenal["pitcher"].unique()]
    delivery["name"] = resolve_names(df, delivery.index)
    return arsenal, delivery


def resolve_names(df: pd.DataFrame, ids) -> pd.Series:
    """Statcast's player_name is 'Last, First'. Fall back to the Chadwick
    register if it's missing or ambiguous for any pitcher."""
    if "player_name" in df.columns:
        names = df.groupby("pitcher")["player_name"].agg(lambda s: s.dropna().unique())
        if names.map(len).le(1).all():
            flip = lambda n: " ".join(reversed(n[0].split(", "))) if len(n) else None
            out = names.map(flip).reindex(ids)
            if out.notna().all():
                return out
    return lookup_names(ids)


def lookup_names(ids) -> pd.Series:
    """'First Last' for MLBAM ids from the Chadwick register (id as text if unknown)."""
    from pybaseball import playerid_reverse_lookup
    lk = playerid_reverse_lookup([int(i) for i in ids], key_type="mlbam")
    lk = lk.drop_duplicates("key_mlbam").set_index("key_mlbam")
    full = (lk["name_first"].str.title() + " " + lk["name_last"].str.title())
    return full.reindex(ids).fillna(pd.Series(ids, index=ids).astype(str))


# ---------------------------------------------------------------------------
# 3. Build the similarity vector
# ---------------------------------------------------------------------------
# Readable column names for the site (cluster profiles, tuning sliders)
FEATURE_LABELS = {
    "velo": "velo", "h_break": "arm-side break", "v_break": "IVB", "spin": "spin",
    "spin_axis_sin": "spin axis (sin)", "spin_axis_cos": "spin axis (cos)",
    "arm_angle": "Arm angle", "release_height": "Release height",
    "release_side": "Release side", "extension": "Extension", "is_lhp": "LHP",
}


def _zscore(x: pd.DataFrame) -> pd.DataFrame:
    return ((x - x.mean()) / x.std(ddof=0).replace(0, 1)).fillna(0)


def build_matrix(arsenal: pd.DataFrame, delivery: pd.DataFrame):
    """Unweighted feature matrix plus a (block, feature) tag for every column.

    Block and feature weights are applied in the browser (docs/js/similarity.js)
    so they can be tuned live; config.WEIGHTS only supplies the defaults.
    """
    ids = delivery.index
    blocks = []

    # Usage block: share of each pitch family (0 if not thrown)
    usage = arsenal.pivot(index="pitcher", columns="family", values="usage")
    usage = usage.reindex(index=ids, columns=FAMILY_ORDER).fillna(0)
    blocks.append(("usage", _zscore(usage), list(FAMILY_ORDER), [f"{f} usage" for f in FAMILY_ORDER]))

    # Pitch block: per-family z-scored shape, scaled by sqrt(usage)
    ars = arsenal.copy()
    ars[PITCH_FEATURES] = ars.groupby("family")[PITCH_FEATURES].transform(
        lambda s: (s - s.mean()) / (s.std(ddof=0) or 1)
    ).fillna(0)
    ars[PITCH_FEATURES] = ars[PITCH_FEATURES].mul(np.sqrt(ars["usage"]), axis=0)
    wide = ars.pivot(index="pitcher", columns="family", values=PITCH_FEATURES)
    # spin_axis_sin / spin_axis_cos share one tunable "spin_axis" weight
    tags = [feat.removesuffix("_sin").removesuffix("_cos") for feat, _ in wide.columns]
    labels = [f"{fam} {FEATURE_LABELS.get(feat, feat)}" for feat, fam in wide.columns]
    wide.columns = [f"{fam}_{feat}" for feat, fam in wide.columns]
    blocks.append(("pitch", wide.reindex(ids).fillna(0), tags, labels))

    # Delivery block
    deliv = _zscore(delivery[DELIVERY_FEATURES])
    if not MIX_HANDEDNESS:
        deliv["is_lhp"] = delivery["throws"].eq("L").astype(float) * 10
    blocks.append(("delivery", deliv, list(deliv.columns),
                   [FEATURE_LABELS.get(c, c) for c in deliv.columns]))

    X = pd.concat([b[1] for b in blocks], axis=1).fillna(0)
    columns = [{"block": name, "feature": tag, "label": label}
               for name, _, block_tags, block_labels in blocks
               for tag, label in zip(block_tags, block_labels)]
    return X, columns
