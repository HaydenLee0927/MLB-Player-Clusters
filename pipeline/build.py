"""End-to-end: fetch Statcast -> pitcher & batter features + matchup totals -> docs/data/*.json

    python pipeline/build.py
"""
from batters import batter_features, build_batter_matrix
from export import export_batters, export_matchups, export_pitchers
from features import aggregate, build_matrix, clean_pitches, lookup_names
from fetch import fetch_statcast
from matchups import aggregate as aggregate_matchups
from matchups import pitch_outcomes


def main():
    raw = fetch_statcast()
    print(f"{len(raw):,} pitches loaded")

    pitches = clean_pitches(raw)
    arsenal, delivery = aggregate(pitches)
    print(f"{len(delivery)} pitchers pass filters")
    X, columns = build_matrix(arsenal, delivery)
    export_pitchers(X, columns, delivery, arsenal)

    feats = batter_features(raw)
    print(f"{len(feats)} batters pass filters")
    Xb, bcolumns = build_batter_matrix(feats)
    export_batters(Xb, bcolumns, feats, lookup_names(feats.index))

    tables = aggregate_matchups(pitch_outcomes(raw), feats.index, delivery.index)
    print(f"{len(tables['pairs']):,} batter-pitcher pairs")
    export_matchups(tables)


if __name__ == "__main__":
    main()
