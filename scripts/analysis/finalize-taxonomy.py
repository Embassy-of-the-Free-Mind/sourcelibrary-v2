#!/usr/bin/env python3
"""
Finalize taxonomy: assign noise points to nearest cluster centroid,
apply curated names, and output complete-taxonomy.json ready for MongoDB.

Usage: python3 scripts/analysis/finalize-taxonomy.py
"""

import json
import numpy as np
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# Curated names for all 52 clusters from the fresh clustering
CURATED_NAMES = {
    0:  "Ethnography & Indigenous Studies",
    1:  "Music Theory & Harmony",
    2:  "Celtic & Irish Traditions",
    3:  "Sanskrit Astronomical Treatises",
    4:  "Rosicrucianism",
    5:  "Freemasonry & Secret Societies",
    6:  "Chinese Materia Medica",
    7:  "Chinese Maritime & Defense",
    8:  "Chinese Military Treatises",
    9:  "Chinese Cosmology & Divination",
    10: "East Asian Encyclopedic Works",
    11: "Sanskrit Jyotisha",
    12: "Hindu Philosophy & Tantra",
    13: "Baconian Natural Philosophy",
    14: "Classical Greek Texts",
    15: "Arabic & Persian Manuscripts",
    16: "French Vernacular Literature",
    17: "Dutch Scholarly Traditions",
    18: "Italian Literary Traditions",
    19: "Neoplatonism & Renaissance Philosophy",
    20: "Ancient Mechanical Engineering",
    21: "Renaissance Anatomy & Engineering",
    22: "Hermeticism & Theurgy",
    23: "Mathematics & Geometry",
    24: "Early Modern Physics",
    25: "Comparative Mythology & Religion",
    26: "Platonic Philosophy",
    27: "Astrology & Astronomy",
    28: "Medieval Astrology & Divination",
    29: "Western Alchemy",
    30: "Medical Philosophy",
    31: "Natural History & Experiment",
    32: "Botany & Herbals",
    33: "Renaissance Occult Philosophy",
    34: "New Thought & Self-Improvement",
    35: "Book History & Provenance",
    36: "Christian Kabbalah",
    37: "Grimoires & Ceremonial Magic",
    38: "Demonology & Witchcraft",
    39: "Renaissance Natural Philosophy",
    40: "German Alchemical Tradition",
    41: "Syriac & Armenian Christianity",
    42: "Enlightenment Philosophy",
    43: "Continental Christian Mysticism",
    44: "Early Modern Prophecy & Apocalypse",
    45: "Lexicography & Etymology",
    46: "Classical Greek & Latin Texts",
    47: "Renaissance Encyclopedism",
    48: "Legal & Political Treatises",
    49: "Classical Antiquity & Bibliography",
    50: "Early Christianity & Apologetics",
    51: "Biblical Scholarship",
}


def main():
    print("=== Finalize Taxonomy ===\n")

    # Load cluster results and embeddings
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))
    with open(OUTPUT_DIR / "book-embed-ids.json") as f:
        embed_ids = json.load(f)

    embed_id_to_idx = {bid: i for i, bid in enumerate(embed_ids)}
    assignments = results["book_assignments"]

    # Separate clustered and noise
    clustered = [a for a in assignments if a["cluster"] != -1]
    noise = [a for a in assignments if a["cluster"] == -1]
    print(f"Clustered: {len(clustered)}")
    print(f"Noise: {len(noise)}")

    # Compute centroids from clustered books
    cluster_members = {}
    for a in clustered:
        cid = a["cluster"]
        idx = embed_id_to_idx.get(a["id"])
        if idx is None:
            continue
        if cid not in cluster_members:
            cluster_members[cid] = []
        cluster_members[cid].append(idx)

    centroids = {}
    for cid, member_indices in cluster_members.items():
        centroid = embeddings[member_indices].mean(axis=0)
        centroid = centroid / np.linalg.norm(centroid)
        centroids[cid] = centroid

    centroid_ids = sorted(centroids.keys())
    centroid_matrix = np.array([centroids[cid] for cid in centroid_ids])
    print(f"Computed {len(centroid_ids)} centroids\n")

    # Assign noise to nearest centroid
    noise_indices = []
    noise_assignments = []
    for a in noise:
        idx = embed_id_to_idx.get(a["id"])
        if idx is not None:
            noise_indices.append(idx)
            noise_assignments.append(a)

    if noise_indices:
        noise_embeddings = embeddings[noise_indices]
        similarities = noise_embeddings @ centroid_matrix.T
        best_cluster_indices = similarities.argmax(axis=1)
        best_similarities = similarities[np.arange(len(noise_indices)), best_cluster_indices]

        for i, a in enumerate(noise_assignments):
            a["cluster"] = centroid_ids[best_cluster_indices[i]]
            a["probability"] = float(best_similarities[i])
            a["method"] = "nearest-centroid"

        avg_sim = float(np.mean(best_similarities))
        high = sum(1 for s in best_similarities if s >= 0.5)
        med = sum(1 for s in best_similarities if 0.3 <= s < 0.5)
        low = sum(1 for s in best_similarities if s < 0.3)
        print(f"Noise assignment stats:")
        print(f"  Avg similarity: {avg_sim:.3f}")
        print(f"  High (>0.5): {high}")
        print(f"  Medium (0.3-0.5): {med}")
        print(f"  Low (<0.3): {low}")

    # Combine all assignments
    all_assignments = clustered + noise_assignments
    print(f"\nTotal assignments: {len(all_assignments)}")

    # Add curated names
    for a in all_assignments:
        a["cluster_name"] = CURATED_NAMES.get(a["cluster"], f"Cluster {a['cluster']}")

    # Cluster distribution
    dist = {}
    for a in all_assignments:
        name = a["cluster_name"]
        dist[name] = dist.get(name, 0) + 1
    print(f"\nCluster distribution:")
    for name, count in sorted(dist.items(), key=lambda x: -x[1])[:15]:
        print(f"  {name}: {count}")
    print(f"  ... ({len(dist)} total clusters)")

    # Save
    output = {
        "generated": "2026-03-15",
        "method": "hdbscan+nearest-centroid",
        "n_clusters": len(centroid_ids),
        "total_books": len(all_assignments),
        "curated_names": CURATED_NAMES,
        "assignments": all_assignments,
    }
    out_path = OUTPUT_DIR / "complete-taxonomy.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
