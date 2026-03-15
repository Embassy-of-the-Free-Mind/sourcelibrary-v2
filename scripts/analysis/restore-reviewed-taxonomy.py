#!/usr/bin/env python3
"""
Restore the reviewed taxonomy (48 clusters) and expand to all 5,993 books.

Strategy:
1. Re-run HDBSCAN on the 3,424-book subset (produces ~57 clusters)
2. Match those to the 48 old names using expansion-file anchors
3. Merge/assign until every book has an old cluster ID
4. Compute centroids from the full 3,424 core
5. Assign ALL 5,993 books to nearest centroid
6. Re-run sub-clustering and apply review edits

Outputs: scripts/output/reviewed-taxonomy-restored.json
"""

import json
import numpy as np
from pathlib import Path
from collections import Counter

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# Old 48 curated names (post-review)
OLD_CURATED_NAMES = {
    0:  "Music Theory & Harmony",
    1:  "African & Indigenous Studies",
    2:  "Chinese Materia Medica",
    3:  "Chinese Medical Texts",
    4:  "Christian Kabbalah",
    5:  "Sanskrit Astronomical Treatises",
    6:  "Chinese Cosmology",
    7:  "Celtic & Irish Traditions",
    8:  "Sanskrit Jyotisha",
    9:  "Chinese Military",
    10: "Chinese Celestial & Terrestrial Lore",
    11: "Rosicrucian Fraternity Defenses",
    12: "Freemasonry & Secret Societies",
    13: "Chinese Military (Hai Guo Tu Zhi)",
    14: "Ming Dynasty Coastal Defense",
    15: "Botany & Herbals",
    16: "Sanskrit Divinatory Texts",
    17: "Hindu Philosophy",
    18: "Animal Magnetism & Mesmerism",
    19: "New Thought & Self-Improvement",
    20: "Medical Philosophy",
    21: "Western Alchemy",
    22: "Baconian Natural Philosophy",
    23: "Legal & Political Treatises",
    24: "Classical Political Economy",
    25: "Demonology & Witchcraft",
    26: "Solomonic Grimoires",
    27: "Grimoires & Ceremonial Magic",
    28: "Islamic Mysticism & Philosophy",
    29: "Early Modern Moral Philosophy",
    30: "Early Modern Rosicrucianism",
    31: "Astrology & Astronomy",
    32: "Renaissance Philosophy",
    33: "Early Modern Philosophy",
    34: "Early Optics & Natural Philosophy",
    35: "Hermeticism & Theurgy",
    36: "Classical Greek & Latin Texts",
    37: "Ancient Mechanical Engineering",
    38: "Renaissance Anatomy & Engineering",
    39: "Pseudo-Dionysius & Commentators",
    40: "Swedenborgian Theology",
    41: "Syriac & Armenian Christianity",
    42: "Thirty Years' War Pamphlets",
    43: "Early Modern Prophecy and Apocalypse",
    44: "Early Christianity",
    45: "Biblical Scholarship",
    46: "Religious Persecution & Toleration",
    47: "Continental Christian Mysticism",
}


def main():
    print("=== Restore Reviewed Taxonomy ===\n")

    # Load all data
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))
    with open(OUTPUT_DIR / "book-embed-ids.json") as f:
        embed_ids = json.load(f)
    with open(OUTPUT_DIR / "taxonomy-expansion.json") as f:
        expansion = json.load(f)

    book_lookup = {b["id"]: b for b in all_books}
    embed_id_to_idx = {bid: i for i, bid in enumerate(embed_ids)}

    # The expansion file has 2,569 books with old cluster IDs (0-47)
    # These were assigned via nearest-centroid from the ORIGINAL clustering centroids.
    # Use these + the restored HDBSCAN to reconstruct old cluster assignments for core books.

    expansion_by_id = {a["id"]: a for a in expansion["assignments"]}
    expansion_ids = set(expansion_by_id.keys())
    print(f"Expansion books with old cluster IDs: {len(expansion_ids)}")

    # Load restored clustering (57 clusters from re-running HDBSCAN on old 3,424 subset)
    with open(OUTPUT_DIR / "restored-cluster-results.json") as f:
        restored = json.load(f)

    restored_by_id = {a["id"]: a for a in restored["book_assignments"]}

    # Strategy: For each of the 57 restored clusters, find which old cluster ID
    # the majority of its books' EXPANSION neighbors belong to.
    # Since expansion books and core books overlap in embedding space,
    # we can use the expansion assignments as ground truth for the old cluster structure.
    #
    # Actually, core books (3,424) and expansion books (2,569) are DISJOINT sets.
    # We can't directly look up core books in the expansion.
    #
    # Better: compute centroids for each old cluster using expansion books,
    # then assign each restored cluster to its nearest old centroid.

    # Compute old-cluster centroids from expansion books
    old_centroids = {}
    old_members = {}
    for a in expansion["assignments"]:
        cid = a["cluster"]
        idx = embed_id_to_idx.get(a["id"])
        if idx is None:
            continue
        if cid not in old_members:
            old_members[cid] = []
        old_members[cid].append(idx)

    for cid, indices in old_members.items():
        centroid = embeddings[indices].mean(axis=0)
        centroid = centroid / np.linalg.norm(centroid)
        old_centroids[cid] = centroid

    print(f"Computed {len(old_centroids)} old-cluster centroids from expansion books")

    # Now assign ALL 5,993 books to the nearest old centroid
    centroid_ids = sorted(old_centroids.keys())
    centroid_matrix = np.array([old_centroids[cid] for cid in centroid_ids])

    # All book embeddings
    all_embed_ids = embed_ids  # 5,993 books in order
    all_embeddings = embeddings  # (5993, 768)

    similarities = all_embeddings @ centroid_matrix.T  # (5993, 48)
    best_indices = similarities.argmax(axis=1)
    best_sims = similarities[np.arange(len(all_embed_ids)), best_indices]

    # Build assignments
    assignments = []
    for i, book_id in enumerate(all_embed_ids):
        old_cid = centroid_ids[best_indices[i]]
        sim = float(best_sims[i])

        # Check if this book was in the expansion (already has old cluster)
        if book_id in expansion_by_id:
            # Use original expansion assignment
            exp_a = expansion_by_id[book_id]
            old_cid = exp_a["cluster"]
            sim = exp_a["probability"]
            method = "nearest-centroid"
        else:
            method = "restored-centroid"

        assignments.append({
            "id": book_id,
            "cluster": old_cid,
            "cluster_name": OLD_CURATED_NAMES.get(old_cid, f"Cluster {old_cid}"),
            "probability": sim,
            "method": method,
        })

    # Stats
    cluster_counts = Counter(a["cluster"] for a in assignments)
    methods = Counter(a["method"] for a in assignments)
    avg_sim = np.mean([a["probability"] for a in assignments])

    print(f"\nAssigned all {len(assignments)} books to 48 old clusters:")
    print(f"  Methods: {dict(methods)}")
    print(f"  Avg similarity: {avg_sim:.3f}")
    print(f"\nCluster distribution:")
    for cid in sorted(cluster_counts.keys()):
        name = OLD_CURATED_NAMES.get(cid, "?")
        print(f"  {name}: {cluster_counts[cid]}")

    # Confidence breakdown
    high = sum(1 for a in assignments if a["probability"] >= 0.5)
    med = sum(1 for a in assignments if 0.3 <= a["probability"] < 0.5)
    low = sum(1 for a in assignments if a["probability"] < 0.3)
    print(f"\nConfidence: high={high}, medium={med}, low={low}")

    # Save
    output = {
        "generated": "2026-03-15",
        "method": "restored-reviewed-taxonomy",
        "n_clusters": len(cluster_counts),
        "total_books": len(assignments),
        "curated_names": OLD_CURATED_NAMES,
        "assignments": assignments,
    }
    out_path = OUTPUT_DIR / "reviewed-taxonomy-restored.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
