#!/usr/bin/env python3
"""
Sub-cluster large clusters to discover finer-grained groupings.
Takes a curated cluster (or raw cluster IDs) and re-runs UMAP+HDBSCAN
on just those books' embeddings with tighter parameters.

Outputs a human-readable review document with sample titles per sub-cluster.
"""

import json
import numpy as np
from pathlib import Path
import umap
import hdbscan

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# ── Curated cluster definitions (from build-cluster-viz-v2.py) ──
# Maps curated name → list of raw cluster IDs
CURATED_CLUSTERS = {
    "Western Alchemy": [21],
    "Classical Texts & Philology": [36],
    "Continental Christian Mysticism": [47],
    "Chinese Religion & Cosmology": [6],
    "Sanskrit Astrology & Astronomy": [8, 5, 16],
    "Astrology & Astronomy": [31],
    "Renaissance Philosophy": [32],
    "Botany & Herbals": [15],
    "Biblical Scholarship": [45],
    "Hermeticism & Theurgy": [35],
    "Grimoires & Ritual Magic": [27, 26],
    "Engineering & Mechanical Arts": [38, 37],
    "Demonology & Witchcraft": [25],
    "Natural Philosophy & Optics": [34, 22],
    "Political & Moral Philosophy": [29, 33, 23, 42],
    "Chinese Military & Strategic Texts": [9, 13, 14],
    "Chinese Medicine": [2, 3],
    "Hindu Philosophy & Indology": [17],
    "Rosicrucianism": [11, 30],
    "Mesmerism & New Thought": [18, 19],
    "Patristic & Eastern Christianity": [41, 44],
    "Christian Kabbalah": [4],
    "Freemasonry & Secret Societies": [12],
    "Medical Philosophy": [20],
    "Music Theory & Harmony": [0],
    "Islamic Mysticism & Philosophy": [28],
    "Chinese Celestial & Terrestrial Lore": [10],
    "Religious Persecution & Toleration": [46],
    "African & Indigenous Studies": [1],
    "Celtic & Irish Traditions": [7],
    "Apocalypticism & Prophecy": [43],
    "Swedenborgian Theology": [40],
    "Pseudo-Dionysius & Commentators": [39],
}

# Minimum size worth sub-clustering
MIN_SIZE_FOR_SUBCLUSTERING = 80


def load_data():
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))
    return all_books, results, embeddings


def get_cluster_books(assignments, raw_cluster_ids):
    """Get indices and book data for books in given raw cluster IDs."""
    indices = []
    for i, a in enumerate(assignments):
        if a["cluster"] in raw_cluster_ids:
            indices.append(i)
    return indices


def sub_cluster(embeddings_subset, min_cluster_size=8, min_samples=3):
    """Run UMAP+HDBSCAN on a subset of embeddings."""
    n = len(embeddings_subset)
    if n < 20:
        return np.full(n, 0)  # too small, everything in one cluster

    # UMAP to lower dims
    n_components = min(5, n // 5)
    n_components = max(2, n_components)
    n_neighbors = min(15, n // 3)
    n_neighbors = max(5, n_neighbors)

    reducer = umap.UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        min_dist=0.1,
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


def format_book(book, max_title=55):
    title = book.get("title", "?")
    if len(title) > max_title:
        title = title[:max_title] + "..."
    author = book.get("author", "")[:30]
    year = book.get("year", "")
    lang = book.get("language", "")
    return f"  {title}  ({author}, {year}, {lang})"


def main():
    print("Loading data...")
    all_books, results, embeddings = load_data()
    book_lookup = {b["id"]: b for b in all_books}
    assignments = results["book_assignments"]

    # Find clusters worth sub-clustering
    targets = []
    for name, raw_ids in sorted(CURATED_CLUSTERS.items()):
        indices = get_cluster_books(assignments, raw_ids)
        if len(indices) >= MIN_SIZE_FOR_SUBCLUSTERING:
            targets.append((name, raw_ids, indices))

    targets.sort(key=lambda t: len(t[2]), reverse=True)

    print(f"\nSub-clustering {len(targets)} clusters with >= {MIN_SIZE_FOR_SUBCLUSTERING} books:\n")
    for name, _, indices in targets:
        print(f"  {name}: {len(indices)} books")

    print("\n" + "=" * 80)

    all_results = []

    for name, raw_ids, indices in targets:
        print(f"\n{'=' * 80}")
        print(f"  SUB-CLUSTERING: {name} ({len(indices)} books)")
        print(f"{'=' * 80}")

        # Extract embeddings for this cluster
        emb_subset = embeddings[indices]

        # Determine parameters based on size
        n = len(indices)
        if n > 200:
            min_cs = 12
            min_s = 4
        elif n > 100:
            min_cs = 10
            min_s = 3
        else:
            min_cs = 8
            min_s = 3

        labels = sub_cluster(emb_subset, min_cluster_size=min_cs, min_samples=min_s)

        # Group by sub-cluster
        subclusters = {}
        noise_books = []
        for j, label in enumerate(labels):
            orig_idx = indices[j]
            book_id = assignments[orig_idx]["id"]
            book = book_lookup.get(book_id, {"title": "?", "id": book_id})

            if label == -1:
                noise_books.append(book)
            else:
                if label not in subclusters:
                    subclusters[label] = []
                subclusters[label].append(book)

        # Sort subclusters by size
        sorted_subs = sorted(subclusters.items(), key=lambda x: len(x[1]), reverse=True)

        print(f"\n  Found {len(sorted_subs)} sub-clusters + {len(noise_books)} noise\n")

        cluster_result = {
            "parent": name,
            "total": len(indices),
            "subclusters": [],
            "noise_count": len(noise_books),
        }

        for sc_id, books in sorted_subs:
            # Sort books by year (if available)
            books.sort(key=lambda b: b.get("year", 9999) if isinstance(b.get("year"), (int, float)) else 9999)

            # Collect language stats
            langs = {}
            for b in books:
                l = b.get("language", "Unknown")
                langs[l] = langs.get(l, 0) + 1
            lang_str = ", ".join(f"{l}:{c}" for l, c in sorted(langs.items(), key=lambda x: -x[1])[:4])

            # Collect theme tags
            themes = {}
            for b in books:
                for tag in b.get("thematic_tags", []):
                    themes[tag] = themes.get(tag, 0) + 1
            top_themes = ", ".join(t for t, _ in sorted(themes.items(), key=lambda x: -x[1])[:6])

            print(f"  --- Sub-cluster {sc_id} ({len(books)} books) ---")
            print(f"  Languages: {lang_str}")
            print(f"  Top themes: {top_themes}")
            print(f"  Sample titles:")
            # Show up to 8 titles, spread across the range
            sample_indices = np.linspace(0, len(books) - 1, min(8, len(books)), dtype=int)
            for si in sample_indices:
                print(format_book(books[si]))
            print()

            cluster_result["subclusters"].append({
                "id": int(sc_id),
                "size": len(books),
                "languages": langs,
                "top_themes": top_themes,
                "sample_titles": [
                    {"title": books[int(si)].get("title", "?"), "author": books[int(si)].get("author", ""), "year": str(books[int(si)].get("year", ""))}
                    for si in sample_indices
                ],
            })

        if noise_books:
            print(f"  --- Noise ({len(noise_books)} books) ---")
            sample_indices = np.linspace(0, len(noise_books) - 1, min(5, len(noise_books)), dtype=int)
            for si in sample_indices:
                print(format_book(noise_books[int(si)]))
            print()

        all_results.append(cluster_result)

    # Save structured results
    out_path = OUTPUT_DIR / "sub-cluster-results.json"
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    print(f"\nSaved structured results to {out_path}")


if __name__ == "__main__":
    main()
