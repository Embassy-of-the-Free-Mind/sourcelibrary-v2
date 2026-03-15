#!/usr/bin/env python3
"""
Sub-cluster v2: Split each of the 52 clusters into finer sub-groups.
Uses UMAP+HDBSCAN within each cluster's embedding subspace.

Reads: complete-taxonomy.json, book-embeddings.npy, book-embed-ids.json, book-features.json
Outputs: sub-cluster-v2.json
"""

import json
import numpy as np
from pathlib import Path
import umap
import hdbscan

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# All 52 clusters from the fresh clustering
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

MIN_SIZE_FOR_SPLIT = 20


def load_data():
    with open(OUTPUT_DIR / "complete-taxonomy.json") as f:
        taxonomy = json.load(f)
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))
    with open(OUTPUT_DIR / "book-embed-ids.json") as f:
        embed_ids = json.load(f)
    return taxonomy, all_books, embeddings, embed_ids


def sub_cluster(embeddings_subset, min_cluster_size=6, min_samples=2):
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


def format_book(book):
    return {
        "id": book.get("id", ""),
        "title": (book.get("title") or "?")[:80],
        "author": (book.get("author") or "")[:40],
        "year": book.get("year", ""),
        "lang": book.get("language", ""),
    }


def main():
    print("Loading data...")
    taxonomy, all_books, embeddings, embed_ids = load_data()
    book_lookup = {b["id"]: b for b in all_books}
    embed_id_to_idx = {bid: i for i, bid in enumerate(embed_ids)}

    # Group assignments by cluster
    cluster_books = {}
    for a in taxonomy["assignments"]:
        cid = a["cluster"]
        if cid not in cluster_books:
            cluster_books[cid] = []
        cluster_books[cid].append(a)

    all_results = []

    for cid in sorted(CURATED_NAMES.keys()):
        curated_name = CURATED_NAMES[cid]
        books_in_cluster = cluster_books.get(cid, [])
        n = len(books_in_cluster)

        if n < MIN_SIZE_FOR_SPLIT:
            print(f"\n  SKIP: {curated_name} ({n} books) — too small")
            book_list = []
            for a in books_in_cluster:
                book = book_lookup.get(a["id"], {})
                book_list.append(format_book(book))
            all_results.append({
                "cluster_id": cid,
                "name": curated_name,
                "total": n,
                "split": False,
                "reason": "too small",
                "subclusters": [{"size": n, "books": book_list}],
            })
            continue

        # Get embeddings for these books
        valid_indices = []
        valid_assignments = []
        for a in books_in_cluster:
            idx = embed_id_to_idx.get(a["id"])
            if idx is not None:
                valid_indices.append(idx)
                valid_assignments.append(a)

        if len(valid_indices) < 15:
            print(f"\n  SKIP: {curated_name} ({n} books, {len(valid_indices)} with embeddings) — too few")
            continue

        emb_subset = embeddings[valid_indices]

        # Adaptive parameters
        nv = len(valid_indices)
        if nv > 200:
            mcs, ms = 10, 3
        elif nv > 100:
            mcs, ms = 8, 3
        elif nv > 50:
            mcs, ms = 6, 2
        else:
            mcs, ms = 6, 2

        labels = sub_cluster(emb_subset, min_cluster_size=mcs, min_samples=ms)

        # Group results
        groups = {}
        noise = []
        for j, lab in enumerate(labels):
            book_id = valid_assignments[j]["id"]
            book = book_lookup.get(book_id, {})
            entry = format_book(book)
            if lab == -1:
                noise.append(entry)
            else:
                groups.setdefault(int(lab), []).append(entry)

        n_clusters = len(groups)
        noise_pct = len(noise) / nv * 100 if nv > 0 else 0

        # Decide if the split is meaningful
        meaningful = n_clusters >= 2 and noise_pct < 40

        result = {
            "cluster_id": cid,
            "name": curated_name,
            "total": n,
            "split": meaningful,
            "n_subclusters": n_clusters,
            "noise_count": len(noise),
            "noise_pct": round(noise_pct, 1),
            "subclusters": [],
        }

        if meaningful:
            for lab in sorted(groups.keys(), key=lambda k: -len(groups[k])):
                books = groups[lab]
                books.sort(key=lambda b: b["year"] if isinstance(b["year"], (int, float)) else 9999)
                langs = {}
                for b in books:
                    langs[b["lang"]] = langs.get(b["lang"], 0) + 1

                result["subclusters"].append({
                    "size": len(books),
                    "languages": langs,
                    "books": books,
                })
        else:
            # Keep as single cluster
            all_books_list = []
            for lab_books in groups.values():
                all_books_list.extend(lab_books)
            all_books_list.extend(noise)
            all_books_list.sort(key=lambda b: b["year"] if isinstance(b["year"], (int, float)) else 9999)
            result["subclusters"] = [{"size": n, "books": all_books_list}]

        if noise and meaningful:
            result["noise_books"] = noise[:8]

        # Print summary
        if meaningful:
            sizes = [s["size"] for s in result["subclusters"]]
            print(f"\n  SPLIT: {curated_name} ({n}) → {sizes} + {len(noise)} noise ({noise_pct:.0f}%)")
        else:
            print(f"\n  KEEP:  {curated_name} ({n}) — {'only 1 found' if n_clusters < 2 else f'{noise_pct:.0f}% noise'}")

        all_results.append(result)

    # Save
    out_path = OUTPUT_DIR / "sub-cluster-v2.json"
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nSaved to {out_path}")

    # Summary stats
    splits = [r for r in all_results if r.get("split")]
    keeps = [r for r in all_results if not r.get("split")]
    total_leaf = sum(r.get("n_subclusters", 1) for r in splits) + len(keeps)
    print(f"\n{'='*60}")
    print(f"Split: {len(splits)} clusters into {sum(r.get('n_subclusters', 0) for r in splits)} sub-clusters")
    print(f"Kept intact: {len(keeps)} clusters")
    print(f"Total leaf nodes: {total_leaf}")


if __name__ == "__main__":
    main()
