#!/usr/bin/env python3
"""
Sub-cluster within each of the 48 restored reviewed clusters.
Uses UMAP+HDBSCAN within each cluster's embedding subspace.

Reads: reviewed-taxonomy-restored.json, book-embeddings.npy, book-embed-ids.json, book-features.json
Outputs: restored-subclusters.json
"""

import json
import numpy as np
from pathlib import Path
import umap
import hdbscan

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# Same curated names
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

MIN_SIZE_FOR_SPLIT = 20


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
    with open(OUTPUT_DIR / "reviewed-taxonomy-restored.json") as f:
        taxonomy = json.load(f)
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))
    with open(OUTPUT_DIR / "book-embed-ids.json") as f:
        embed_ids = json.load(f)

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

    for cid in sorted(OLD_CURATED_NAMES.keys()):
        curated_name = OLD_CURATED_NAMES[cid]
        books_in_cluster = cluster_books.get(cid, [])
        n = len(books_in_cluster)

        if n < MIN_SIZE_FOR_SPLIT:
            print(f"\n  SKIP: {curated_name} ({n} books) — too small")
            book_list = []
            for a in books_in_cluster:
                book = book_lookup.get(a["id"], {})
                book_list.append(format_book(book))
            all_results.append({
                "raw_id": cid,
                "name": curated_name,
                "total": n,
                "split": False,
                "reason": "too small",
                "subclusters": [{"size": n, "books": book_list}],
            })
            continue

        # Get embeddings
        valid_indices = []
        valid_assignments = []
        for a in books_in_cluster:
            idx = embed_id_to_idx.get(a["id"])
            if idx is not None:
                valid_indices.append(idx)
                valid_assignments.append(a)

        if len(valid_indices) < 15:
            print(f"\n  SKIP: {curated_name} ({n} books, {len(valid_indices)} with embeddings)")
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

        meaningful = n_clusters >= 2 and noise_pct < 40

        result = {
            "raw_id": cid,
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
            all_books_list = []
            for lab_books in groups.values():
                all_books_list.extend(lab_books)
            all_books_list.extend(noise)
            all_books_list.sort(key=lambda b: b["year"] if isinstance(b["year"], (int, float)) else 9999)
            result["subclusters"] = [{"size": n, "books": all_books_list}]

        if noise and meaningful:
            result["noise_books"] = noise[:8]

        if meaningful:
            sizes = [s["size"] for s in result["subclusters"]]
            print(f"\n  SPLIT: {curated_name} ({n}) → {sizes} + {len(noise)} noise ({noise_pct:.0f}%)")
        else:
            print(f"\n  KEEP:  {curated_name} ({n}) — {'only 1 found' if n_clusters < 2 else f'{noise_pct:.0f}% noise'}")

        all_results.append(result)

    # Save
    out_path = OUTPUT_DIR / "restored-subclusters.json"
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nSaved to {out_path}")

    splits = [r for r in all_results if r.get("split")]
    keeps = [r for r in all_results if not r.get("split")]
    total_leaf = sum(r.get("n_subclusters", 1) for r in splits) + len(keeps)
    print(f"\nSplit: {len(splits)} clusters into {sum(r.get('n_subclusters', 0) for r in splits)} sub-clusters")
    print(f"Kept intact: {len(keeps)} clusters")
    print(f"Total leaf nodes: {total_leaf}")


if __name__ == "__main__":
    main()
