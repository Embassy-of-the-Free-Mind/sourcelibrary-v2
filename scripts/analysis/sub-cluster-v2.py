#!/usr/bin/env python3
"""
Sub-cluster v2: More aggressive splitting.
- Lower min_cluster_size (6-8) to find finer structure
- Target ALL clusters, not just >80 books
- Skip only clusters <15 books
- Output structured JSON + human-readable review
"""

import json
import numpy as np
from pathlib import Path
import umap
import hdbscan

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# Every raw cluster we want to try splitting
# (raw_id, curated_name)
ALL_CLUSTERS = [
    (21, "Western Alchemy"),
    (35, "Hermeticism & Theurgy"),
    (27, "Grimoires & Ceremonial Magic"),
    (25, "Demonology & Witchcraft"),
    (4, "Christian Kabbalah"),
    (12, "Freemasonry & Secret Societies"),
    (11, "Rosicrucian Fraternity Defenses"),
    (30, "Early Modern Rosicrucianism"),
    (18, "Animal Magnetism & Mesmerism"),
    (19, "New Thought & Self-Improvement"),
    (47, "Continental Christian Mysticism"),
    (45, "Biblical Scholarship"),
    (41, "Syriac & Armenian Christianity"),
    (44, "Early Christian Apologetics"),
    (46, "Religious Persecution & Toleration"),
    (43, "Early Modern Eschatology"),
    (36, "Classical Greek & Latin Texts"),
    (32, "Renaissance Philosophy"),
    (31, "Astrology & Astronomy"),
    (15, "Botany & Herbals"),
    (34, "Early Optics & Natural Philosophy"),
    (22, "Baconian Natural Philosophy"),
    (38, "Renaissance Anatomy & Engineering"),
    (37, "Ancient Mechanical Engineering"),
    (0, "Music Theory & Harmony"),
    (20, "Medical Philosophy"),
    (6, "Chinese Religion & Cosmology"),
    (9, "Wubei Zhi"),
    (13, "Hai Guo Tu Zhi"),
    (2, "Chinese Materia Medica"),
    (3, "Chinese Medical Texts"),
    (10, "Chinese Celestial & Terrestrial Lore"),
    (8, "Sanskrit Jyotisha"),
    (5, "Sanskrit Astronomical Treatises"),
    (17, "Hindu Philosophy & Indology"),
    (28, "Islamic Mysticism & Philosophy"),
    (29, "Early Modern Moral Philosophy"),
    (33, "Early Modern Philosophy"),
    (23, "Legal & Political Treatises"),
    (42, "Thirty Years' War Pamphlets"),
    (1, "African & Indigenous Studies"),
    (7, "Celtic & Irish Traditions"),
]

MIN_SIZE_FOR_SPLIT = 20  # Don't try to split clusters smaller than this


def load_data():
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))
    return all_books, results, embeddings


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


def main():
    print("Loading data...")
    all_books, results, embeddings = load_data()
    book_lookup = {b["id"]: b for b in all_books}
    assignments = results["book_assignments"]

    all_results = []

    for raw_id, curated_name in ALL_CLUSTERS:
        # Get books in this cluster
        indices = [i for i, a in enumerate(assignments) if a["cluster"] == raw_id]
        n = len(indices)

        if n < MIN_SIZE_FOR_SPLIT:
            print(f"\n  SKIP: {curated_name} ({n} books) — too small")
            all_results.append({
                "raw_id": raw_id,
                "name": curated_name,
                "total": n,
                "split": False,
                "reason": "too small",
                "subclusters": [{
                    "size": n,
                    "books": get_book_list(indices, assignments, book_lookup),
                }],
            })
            continue

        emb_subset = embeddings[indices]

        # Adaptive parameters
        if n > 200:
            mcs, ms = 10, 3
        elif n > 100:
            mcs, ms = 8, 3
        elif n > 50:
            mcs, ms = 6, 2
        else:
            mcs, ms = 6, 2

        labels = sub_cluster(emb_subset, min_cluster_size=mcs, min_samples=ms)

        # Group results
        groups = {}
        noise = []
        for j, lab in enumerate(labels):
            orig_idx = indices[j]
            book_id = assignments[orig_idx]["id"]
            book = book_lookup.get(book_id, {})
            entry = format_book(book)
            if lab == -1:
                noise.append(entry)
            else:
                groups.setdefault(int(lab), []).append(entry)

        n_clusters = len(groups)
        noise_pct = len(noise) / n * 100 if n > 0 else 0

        # Decide if the split is meaningful
        meaningful = n_clusters >= 2 and noise_pct < 40

        result = {
            "raw_id": raw_id,
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
            print(f"\n  KEEP:  {curated_name} ({n}) — {'only 1 cluster found' if n_clusters < 2 else f'{noise_pct:.0f}% noise'}")

        all_results.append(result)

    # Save
    out_path = OUTPUT_DIR / "sub-cluster-v2.json"
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nSaved to {out_path}")

    # Summary stats
    splits = [r for r in all_results if r["split"]]
    keeps = [r for r in all_results if not r["split"]]
    total_leaf = sum(r["n_subclusters"] for r in splits) + len(keeps)
    print(f"\n{'='*60}")
    print(f"Split: {len(splits)} clusters into {sum(r['n_subclusters'] for r in splits)} sub-clusters")
    print(f"Kept intact: {len(keeps)} clusters")
    print(f"Total leaf nodes: {total_leaf}")


def get_book_list(indices, assignments, book_lookup):
    books = []
    for i in indices:
        book_id = assignments[i]["id"]
        book = book_lookup.get(book_id, {})
        books.append(format_book(book))
    books.sort(key=lambda b: b["year"] if isinstance(b["year"], (int, float)) else 9999)
    return books


def format_book(book):
    return {
        "title": (book.get("title") or "?")[:80],
        "author": (book.get("author") or "")[:40],
        "year": book.get("year", ""),
        "lang": book.get("language", ""),
    }


if __name__ == "__main__":
    main()
