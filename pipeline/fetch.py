"""Pull pitch-level Statcast data via pybaseball, cached month-by-month as parquet.

A full regular season is ~700k pitches. Savant limits query size, so pybaseball
splits the request into small date ranges internally; we additionally cache per
month so a failed/interrupted run can resume without re-downloading.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
from pybaseball import cache, statcast

from config import CACHE_DIR, END_DATE, START_DATE

KEEP_COLS = [
    # pitcher / pitch shape
    "game_date", "game_type", "pitcher", "player_name", "p_throws", "pitch_type",
    "release_speed", "release_spin_rate", "spin_axis", "pfx_x", "pfx_z",
    "release_pos_x", "release_pos_z", "release_extension", "arm_angle",
    # batter / outcome
    "batter", "stand", "type", "description", "events", "zone", "bb_type",
    "launch_speed", "launch_angle", "launch_speed_angle", "hc_x", "hc_y",
    "estimated_woba_using_speedangle", "woba_value", "woba_denom", "delta_run_exp",
    "bat_speed", "swing_length", "attack_angle",
]
# Caches written before batter data was added lack this column and are re-pulled
# (pybaseball's own cache usually still has the full rows, so this is quick).
REQUIRED_COL = "batter"


def _month_ranges(start: str, end: str):
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    cur = s
    while cur <= e:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        yield cur, min(nxt - timedelta(days=1), e)
        cur = nxt


def fetch_statcast(start: str = START_DATE, end: str = END_DATE) -> pd.DataFrame:
    cache.enable()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    frames = []
    for s, e in _month_ranges(start, end):
        path = CACHE_DIR / f"statcast_{s:%Y%m%d}_{e:%Y%m%d}.parquet"
        if path.exists():
            cached = pd.read_parquet(path)
            if REQUIRED_COL in cached.columns:
                print(f"[cache] {path.name}")
                frames.append(cached)
                continue
        print(f"[fetch] {s} -> {e}")
        df = statcast(start_dt=str(s), end_dt=str(e), verbose=False, parallel=True)
        if df is None or df.empty:
            continue
        df = df[[c for c in KEEP_COLS if c in df.columns]]
        df.to_parquet(path, index=False)
        frames.append(df)

    df = pd.concat(frames, ignore_index=True)
    if "game_type" in df.columns:
        df = df[df["game_type"] == "R"]  # regular season only
    return df


if __name__ == "__main__":
    out = fetch_statcast()
    print(out.shape)
    print(out.head())
