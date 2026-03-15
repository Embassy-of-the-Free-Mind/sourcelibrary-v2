#!/usr/bin/env python3
"""
Generate book_id → cluster/subcluster mapping from pre-computed results.

Reads:
  - complete-taxonomy.json (all 5,993 books with cluster assignments)
  - sub-cluster-v2.json (subcluster book lists)
  - named-subclusters.json (subcluster names)

Outputs: scripts/output/taxonomy-mapping.json
"""

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"


def main():
    print("Loading data...")

    with open(OUTPUT_DIR / "complete-taxonomy.json") as f:
        taxonomy = json.load(f)

    with open(OUTPUT_DIR / "sub-cluster-v2.json") as f:
        subclusters = json.load(f)

    with open(OUTPUT_DIR / "named-subclusters.json") as f:
        named = json.load(f)

    # Build book_id → subcluster mapping from sub-cluster-v2.json
    # Each subcluster has a "books" array with book IDs
    book_to_sub = {}  # book_id → (cluster_id, subcluster_idx)
    for sc_data in subclusters:
        cid = sc_data["cluster_id"]
        if not sc_data.get("split"):
            continue
        for sc_idx, sc in enumerate(sc_data["subclusters"]):
            for book in sc.get("books", []):
                book_to_sub[book["id"]] = (cid, sc_idx)

    # Build subcluster names from named-subclusters.json
    sub_names = {}  # (cluster_id, sc_idx) → name
    for ns in named:
        cid = ns["cluster_id"]
        if not ns.get("split"):
            continue
        for sc_idx, sc in enumerate(ns["subclusters"]):
            sub_names[(cid, sc_idx)] = sc["name"]

    # Generate mapping for all 5,993 books
    mapping_entries = []
    stats = {"with_subcluster": 0, "cluster_only": 0}

    for a in taxonomy["assignments"]:
        book_id = a["id"]
        cluster_name = a["cluster_name"]
        cluster_id = a["cluster"]

        entry = {
            "book_id": book_id,
            "cluster": cluster_name,
            "cluster_id": cluster_id,
            "probability": a.get("probability"),
        }

        # Check if this book has a subcluster assignment
        if book_id in book_to_sub:
            _, sc_idx = book_to_sub[book_id]
            sc_name = sub_names.get((cluster_id, sc_idx), f"Sub-cluster {sc_idx}")
            entry["subcluster"] = sc_name
            entry["subcluster_idx"] = sc_idx
            stats["with_subcluster"] += 1
        else:
            entry["subcluster"] = None
            entry["subcluster_idx"] = None
            stats["cluster_only"] += 1

        mapping_entries.append(entry)

    # Count distinct clusters and subclusters
    clusters = set(e["cluster"] for e in mapping_entries)
    subclusters_set = set(
        (e["cluster_id"], e["subcluster_idx"])
        for e in mapping_entries
        if e["subcluster_idx"] is not None
    )

    output = {
        "generated": "2026-03-15",
        "stats": {
            "total_books": len(mapping_entries),
            "with_subcluster": stats["with_subcluster"],
            "cluster_only": stats["cluster_only"],
            "clusters": len(clusters),
            "subclusters": len(subclusters_set),
        },
        "books": mapping_entries,
    }

    out_path = OUTPUT_DIR / "taxonomy-mapping.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)

    print(f"\nSaved {len(mapping_entries)} book mappings to {out_path}")
    print(f"  With subcluster: {stats['with_subcluster']}")
    print(f"  Cluster only: {stats['cluster_only']}")
    print(f"  {len(clusters)} clusters, {len(subclusters_set)} subclusters")


if __name__ == "__main__":
    main()
