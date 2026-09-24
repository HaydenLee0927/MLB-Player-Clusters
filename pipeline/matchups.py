"""Batter-vs-pitcher outcome totals for the matchup page.

Every pitch becomes one row of additive counts (FIELDS). They are summed per
(batter, pitcher, same-hand) pair, and per player overall, so the browser can
rebuild any rate for any grouping of clusters without re-reading pitches:

    n   pitches              pa  PAs counted in wOBA (woba_denom)
    xw  xwOBA numerator      w   wOBA numerator
    rv  run value (batter's perspective, delta_run_exp)
    sw  swings               wh  whiffs
    k   strikeouts           bb  walks
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from batters import SWINGS, WHIFFS

FIELDS = ["n", "pa", "xw", "w", "rv", "sw", "wh", "k", "bb"]


def pitch_outcomes(df: pd.DataFrame) -> pd.DataFrame:
    df = df[df["batter"].notna() & df["pitcher"].notna()]
    pa = df["woba_denom"].fillna(0)
    # xwOBA: expected value on balls in play, actual wOBA value on K / BB / HBP
    xw = df["estimated_woba_using_speedangle"].fillna(df["woba_value"]).fillna(0)
    return pd.DataFrame({
        "batter": df["batter"].astype(int),
        "pitcher": df["pitcher"].astype(int),
        "same": df["stand"].eq(df["p_throws"]).astype(int),
        "n": 1,
        "pa": pa,
        "xw": np.where(pa.eq(1), xw, 0.0),
        "w": np.where(pa.eq(1), df["woba_value"].fillna(0), 0.0),
        "rv": df["delta_run_exp"].fillna(0),
        "sw": df["description"].isin(SWINGS).astype(int),
        "wh": df["description"].isin(WHIFFS).astype(int),
        "k": df["events"].isin(["strikeout", "strikeout_double_play"]).astype(int),
        "bb": df["events"].eq("walk").astype(int),
    })


def _rows(frame: pd.DataFrame) -> list[list]:
    """Round sums so the JSON stays small: counts as ints, rates to 3 decimals."""
    out = frame.copy()
    for f in FIELDS:
        out[f] = out[f].round(3) if f in ("xw", "w", "rv") else out[f].astype(int)
    return out.astype(object).values.tolist()


def aggregate(outcomes: pd.DataFrame, batter_ids, pitcher_ids) -> dict:
    """Pair totals between the clustered players, plus each player's totals against everyone."""
    pairs = (outcomes[outcomes["batter"].isin(batter_ids) & outcomes["pitcher"].isin(pitcher_ids)]
             .groupby(["batter", "pitcher", "same"])[FIELDS].sum().reset_index())

    def totals(key, ids):
        t = outcomes[outcomes[key].isin(ids)].groupby([key, "same"])[FIELDS].sum()
        return {int(pid): {int(s): r for s, *r in _rows(grp.droplevel(0).reset_index())}
                for pid, grp in t.groupby(level=0)}

    league = outcomes.groupby("same")[FIELDS].sum()
    return {
        "fields": FIELDS,
        "league": {int(s): r for s, *r in _rows(league.reset_index())},
        "batters": totals("batter", batter_ids),
        "pitchers": totals("pitcher", pitcher_ids),
        "pairs": _rows(pairs),
    }
