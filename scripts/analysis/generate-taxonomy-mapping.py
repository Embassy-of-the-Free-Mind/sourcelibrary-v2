#!/usr/bin/env python3
"""
Generate a book_id → cluster/subcluster mapping by re-running
the same deterministic UMAP+HDBSCAN used in sub-cluster-v2.py.

Outputs: scripts/output/taxonomy-mapping.json
"""

import json
import numpy as np
from pathlib import Path
import umap
import hdbscan

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# Same curated names from build-review-ui.py
CURATED_NAMES = {
    21: "Western Alchemy",
    35: "Hermeticism & Theurgy",
    27: "Grimoires & Ceremonial Magic",
    26: "Solomonic Grimoires",
    25: "Demonology & Witchcraft",
    11: "Rosicrucian Fraternity Defenses",
    30: "Early Modern Rosicrucianism",
    18: "Animal Magnetism & Mesmerism",
    19: "New Thought & Self-Improvement",
    4:  "Christian Kabbalah",
    12: "Freemasonry & Secret Societies",
    47: "Continental Christian Mysticism",
    45: "Biblical Scholarship",
    41: "Syriac & Armenian Christianity",
    44: "Early Christianity",
    40: "Swedenborgian Theology",
    46: "Religious Persecution & Toleration",
    43: "Early Modern Prophecy and Apocalypse",
    36: "Classical Greek & Latin Texts",
    32: "Renaissance Philosophy",
    39: "Pseudo-Dionysius & Commentators",
    31: "Astrology & Astronomy",
    15: "Botany & Herbals",
    34: "Early Optics & Natural Philosophy",
    22: "Baconian Natural Philosophy",
    38: "Renaissance Anatomy & Engineering",
    37: "Ancient Mechanical Engineering",
    0:  "Music Theory & Harmony",
    20: "Medical Philosophy",
    6:  "Chinese Cosmology",
    9:  "Chinese Military (Wubei Zhi)",
    13: "Chinese Military (Hai Guo Tu Zhi)",
    14: "Ming Dynasty Coastal Defense",
    2:  "Chinese Materia Medica",
    3:  "Chinese Medical Texts",
    10: "Chinese Celestial & Terrestrial Lore",
    8:  "Sanskrit Jyotisha",
    5:  "Sanskrit Astronomical Treatises",
    16: "Sanskrit Divinatory Texts",
    17: "Hindu Philosophy",
    28: "Islamic Mysticism & Philosophy",
    29: "Early Modern Moral Philosophy",
    33: "Early Modern Philosophy",
    23: "Legal & Political Treatises",
    42: "Thirty Years' War Pamphlets",
    24: "Classical Political Economy",
    1:  "African & Indigenous Studies",
    7:  "Celtic & Irish Traditions",
}

MIN_SIZE_FOR_SPLIT = 20


def sub_cluster(embeddings_subset, min_cluster_size=6, min_samples=2):
    """Same logic as sub-cluster-v2.py — must match exactly for determinism."""
    n = len(embeddings_subset)
    if n < 15:
        return np.full(n, 0)

    n_components = min(5, max(2, n // 8))
    n_neighbors = min(12, max(4, n // 5))

    reducer = umap.UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        min_dist=0.05,
        metric="cosine",
        random_state=42,
    )
    reduced = reducer.fit_transform(embeddings_subset)

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(reduced)
    return labels


def main():
    print("Loading data...")
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))

    # Load named subclusters for subcluster names
    with open(OUTPUT_DIR / "named-subclusters.json") as f:
        named_subs = json.load(f)
    names_by_id = {}
    for ns in named_subs:
        if ns.get("split") and "raw_id" in ns:
            # Use parent name from named subs (has review edits applied)
            names_by_id[ns["raw_id"]] = {
                "parent": ns.get("parent", CURATED_NAMES.get(ns["raw_id"], f"Cluster {ns['raw_id']}")),
                "subs": [sc["name"] for sc in ns["subclusters"]],
            }

    book_lookup = {b["id"]: b for b in all_books}
    assignments = results["book_assignments"]

    # Get all unique cluster IDs
    cluster_ids = sorted(set(a["cluster"] for a in assignments if a["cluster"] >= 0))
    print(f"  {len(cluster_ids)} clusters, {len(assignments)} total books")

    mapping_entries = []
    noise_book_ids = []
    subcluster_count = 0

    # Handle noise books (cluster == -1)
    for a in assignments:
        if a["cluster"] == -1:
            noise_book_ids.append(a["id"])

    for raw_id in cluster_ids:
        cluster_name = CURATED_NAMES.get(raw_id, f"Cluster {raw_id}")
        # Check if named subs has an edited parent name
        if raw_id in names_by_id:
            cluster_name = names_by_id[raw_id]["parent"]

        # Get book indices for this cluster
        indices = [i for i, a in enumerate(assignments) if a["cluster"] == raw_id]
        n = len(indices)

        if n < MIN_SIZE_FOR_SPLIT:
            # No sub-clustering, assign all to the cluster directly
            for i in indices:
                book_id = assignments[i]["id"]
                book = book_lookup.get(book_id, {})
                mapping_entries.append({
                    "book_id": book_id,
                    "title": (book.get("title") or "?")[:80],
                    "cluster": cluster_name,
                    "cluster_id": raw_id,
                    "subcluster": None,
                    "subcluster_idx": None,
                    "probability": assignments[i].get("probability"),
                })
            print(f"  {cluster_name}: {n} books (no split)")
            continue

        # Re-run sub-clustering with same params
        emb_subset = embeddings[indices]
        if n > 200:
            mcs, ms = 10, 3
        elif n > 100:
            mcs, ms = 8, 3
        else:
            mcs, ms = 6, 2

        labels = sub_cluster(emb_subset, min_cluster_size=mcs, min_samples=ms)

        # Group by label to match ordering in sub-cluster-v2.py
        groups = {}
        noise_indices = []
        for j, lab in enumerate(labels):
            orig_idx = indices[j]
            if lab == -1:
                noise_indices.append(orig_idx)
            else:
                groups.setdefault(int(lab), []).append(orig_idx)

        n_clusters = len(groups)
        noise_pct = len(noise_indices) / n * 100

        # Same meaningful check as sub-cluster-v2.py
        meaningful = n_clusters >= 2 and noise_pct < 40

        if not meaningful:
            # Not split — all books go to parent cluster
            for i in indices:
                book_id = assignments[i]["id"]
                book = book_lookup.get(book_id, {})
                mapping_entries.append({
                    "book_id": book_id,
                    "title": (book.get("title") or "?")[:80],
                    "cluster": cluster_name,
                    "cluster_id": raw_id,
                    "subcluster": None,
                    "subcluster_idx": None,
                    "probability": assignments[i].get("probability"),
                })
            print(f"  {cluster_name}: {n} books (not split — {noise_pct:.0f}% noise)")
            continue

        # Map subclusters in the same order as sub-cluster-v2.py (sorted by size desc)
        sorted_labels = sorted(groups.keys(), key=lambda k: -len(groups[k]))
        sub_names = names_by_id.get(raw_id, {}).get("subs", [])

        for sc_idx, lab in enumerate(sorted_labels):
            sc_name = sub_names[sc_idx] if sc_idx < len(sub_names) else f"Sub-cluster {sc_idx + 1}"
            subcluster_count += 1
            for orig_idx in groups[lab]:
                book_id = assignments[orig_idx]["id"]
                book = book_lookup.get(book_id, {})
                mapping_entries.append({
                    "book_id": book_id,
                    "title": (book.get("title") or "?")[:80],
                    "cluster": cluster_name,
                    "cluster_id": raw_id,
                    "subcluster": sc_name,
                    "subcluster_idx": sc_idx,
                    "probability": assignments[orig_idx].get("probability"),
                })

        # Noise within this cluster — assign to cluster but no subcluster
        for orig_idx in noise_indices:
            book_id = assignments[orig_idx]["id"]
            book = book_lookup.get(book_id, {})
            mapping_entries.append({
                "book_id": book_id,
                "title": (book.get("title") or "?")[:80],
                "cluster": cluster_name,
                "cluster_id": raw_id,
                "subcluster": None,
                "subcluster_idx": None,
                "probability": assignments[orig_idx].get("probability"),
            })

        sizes = [len(groups[lab]) for lab in sorted_labels]
        print(f"  {cluster_name}: {n} → {sizes} + {len(noise_indices)} noise")

    # Save
    output = {
        "generated": "2026-03-14",
        "stats": {
            "total_books": len(mapping_entries),
            "noise": len(noise_book_ids),
            "clusters": len(cluster_ids),
            "subclusters": subcluster_count,
        },
        "books": mapping_entries,
        "noise_book_ids": noise_book_ids,
    }

    out_path = OUTPUT_DIR / "taxonomy-mapping.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)

    print(f"\nSaved {len(mapping_entries)} book mappings to {out_path}")
    print(f"  + {len(noise_book_ids)} noise books (unclustered)")
    print(f"  {subcluster_count} total subclusters across {len(cluster_ids)} clusters")


if __name__ == "__main__":
    main()
