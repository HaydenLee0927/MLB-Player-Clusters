"""Write the site's data files.

Similarity, the kNN graph and the clusters are *not* computed here: the site
builds them in the browser from the exported feature columns (docs/js/similarity.js),
so weights can be tuned live. The config values below are only the defaults.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from config import (BATTER_FEATURE_WEIGHTS, BATTER_GRAPH, BATTER_WEIGHTS,
                    FEATURE_WEIGHTS, GRAPH, OUTPUT_DIR, SEASON, WEIGHTS)

BLOCK_LABELS = {
    "usage": "Pitch usage", "pitch": "Pitch shape", "delivery": "Delivery",
    "side": "Batting side", "contact": "Contact quality", "launch": "Launch / batted-ball type",
    "spray": "Spray (pull / oppo)", "discipline": "Plate discipline", "swing": "Swing tracking",
}


def _meta(n_players: int) -> dict:
    return {
        "season": SEASON,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_players": n_players,
    }


def _defaults(weights: dict, features: dict, graph: dict) -> dict:
    return {
        "blocks": [{"id": b, "label": BLOCK_LABELS[b], "weight": w} for b, w in weights.items()],
        "features": features,
        **graph,
    }


def _write(name: str, payload: dict):
    path = OUTPUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


def _vec(row) -> list[float]:
    return [round(float(v), 3) for v in row]


def export_pitchers(X: pd.DataFrame, columns: list[dict], delivery: pd.DataFrame, arsenal: pd.DataFrame):
    nodes = []
    for pid in delivery.index:
        row = delivery.loc[pid]
        pitches = arsenal[arsenal["pitcher"] == pid].sort_values("usage", ascending=False)
        nodes.append({
            "id": int(pid),
            "name": row["name"],
            "throws": row["throws"],
            "pitches": int(row["pitches"]),
            "arm_angle": round(float(row["arm_angle"]), 1),
            "release_height": round(float(row["release_height"]), 2),
            "extension": round(float(row["extension"]), 2),
            "arsenal": [
                {
                    "type": p.family,
                    "usage": round(p.usage, 3),
                    "velo": round(p.velo, 1),
                    "h_break": round(p.h_break, 1),
                    "v_break": round(p.v_break, 1),
                    "spin": None if pd.isna(p.spin) else int(p.spin),
                }
                for p in pitches.itertuples()
            ],
            "f": _vec(X.loc[pid]),
        })
    _write("pitchers.json", {"meta": _meta(len(nodes)), "defaults": _defaults(WEIGHTS, FEATURE_WEIGHTS, GRAPH),
                             "columns": columns, "nodes": nodes})


def export_batters(X: pd.DataFrame, columns: list[dict], feats: pd.DataFrame, names: pd.Series):
    nodes = []
    for bid in feats.index:
        row = feats.loc[bid]
        share = row["lhb_share"]
        nodes.append({
            "id": int(bid),
            "name": names[bid],
            "stands": "L" if share >= 0.9 else "R" if share <= 0.1 else "S",
            "pa": int(row["pa"]),
            "stats": {c["feature"]: None if pd.isna(row[c["feature"]]) else round(float(row[c["feature"]]), 3)
                      for c in columns},
            "f": _vec(X.loc[bid]),
        })
    _write("batters.json", {"meta": _meta(len(nodes)), "defaults": _defaults(BATTER_WEIGHTS, BATTER_FEATURE_WEIGHTS, BATTER_GRAPH),
                            "columns": columns, "nodes": nodes})


def export_matchups(tables: dict):
    _write("matchups.json", {"meta": _meta(len(tables["pairs"])), **tables})
