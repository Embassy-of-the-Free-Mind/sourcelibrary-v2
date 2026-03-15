#!/usr/bin/env python3
"""
Expand taxonomy coverage by embedding books that have keyword index terms
but were excluded from the original clustering (which required AI summaries).

Approach: embed new books, assign each to the nearest existing cluster centroid.
This preserves all 48 curated cluster names and subcluster structure.

Usage: python3 scripts/analysis/expand-taxonomy.py
"""

import json
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer

OUTPUT_DIR = Path(__file__).parent.parent / "output"


def build_text_repr(book):
    """Same text representation as cluster-books.py."""
    parts = []
    title = book.get("title", "")
    author = book.get("author", "")
    if title:
        parts.append(f"Title: {title}")
    if author:
        parts.append(f"Author: {author}")
    lang = book.get("language", "")
    year = book.get("year")
    if lang:
        parts.append(f"Language: {lang}")
    if year:
        parts.append(f"Year: {year}")
    summary = book.get("summary", "")
    if summary:
        parts.append(f"Summary: {summary[:1000]}")
    themes = book.get("themes", [])
    if themes:
        parts.append(f"Themes: {', '.join(themes[:10])}")
    terms = book.get("top_terms", [])
    if terms:
        parts.append(f"Key terms: {', '.join(terms[:20])}")
    return "\n".join(parts)


def main():
    print("=== Expand Taxonomy via Keyword Index ===\n")

    # Load existing cluster data
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    existing_embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))

    # Map existing book assignments
    existing_ids = set(a["id"] for a in results["book_assignments"])
    assignment_by_id = {a["id"]: a for a in results["book_assignments"]}

    print(f"Existing: {len(existing_ids)} books in {results['n_clusters']} clusters")

    # Find new books: have keyword index terms (>5) but weren't in original clustering
    new_books = [
        b for b in all_books
        if b["id"] not in existing_ids and len(b.get("top_terms", [])) > 5
    ]
    print(f"New books with keyword index terms: {len(new_books)}")

    if not new_books:
        print("Nothing to do.")
        return

    # Also find books with only title (no terms, no summary) — skip these
    title_only = [
        b for b in all_books
        if b["id"] not in existing_ids and len(b.get("top_terms", [])) <= 5
    ]
    print(f"Skipping {len(title_only)} books with no keyword index (title-only, weak signal)")

    # Compute cluster centroids from existing embeddings
    # Load the book ID order from the embeddings cache
    with open(OUTPUT_DIR / "book-embed-ids.json") as f:
        embed_ids = json.load(f)
    embed_id_to_idx = {bid: i for i, bid in enumerate(embed_ids)}

    centroids = {}
    cluster_members = {}
    for a in results["book_assignments"]:
        cid = a["cluster"]
        if cid == -1:
            continue
        idx = embed_id_to_idx.get(a["id"])
        if idx is None:
            continue
        if cid not in cluster_members:
            cluster_members[cid] = []
        cluster_members[cid].append(idx)

    for cid, member_indices in cluster_members.items():
        centroid = existing_embeddings[member_indices].mean(axis=0)
        centroid = centroid / np.linalg.norm(centroid)  # normalize
        centroids[cid] = centroid

    centroid_ids = sorted(centroids.keys())
    centroid_matrix = np.array([centroids[cid] for cid in centroid_ids])
    print(f"\nComputed {len(centroid_ids)} cluster centroids")

    # Embed new books
    print(f"\nEmbedding {len(new_books)} new books...")
    model = SentenceTransformer("all-mpnet-base-v2")
    texts = [build_text_repr(b) for b in new_books]
    new_embeddings = model.encode(
        texts,
        show_progress_bar=True,
        batch_size=16,
        normalize_embeddings=True,
    )
    new_embeddings = np.array(new_embeddings)

    # Assign each new book to nearest cluster centroid (cosine similarity)
    similarities = new_embeddings @ centroid_matrix.T  # (n_new, n_clusters)
    best_cluster_indices = similarities.argmax(axis=1)
    best_similarities = similarities[np.arange(len(new_books)), best_cluster_indices]

    # Build assignments
    new_assignments = []
    for i, book in enumerate(new_books):
        cid = centroid_ids[best_cluster_indices[i]]
        sim = float(best_similarities[i])
        new_assignments.append({
            "id": book["id"],
            "cluster": cid,
            "probability": sim,  # cosine similarity as confidence
            "method": "nearest-centroid",
        })

    # Stats
    cluster_counts = {}
    for a in new_assignments:
        c = a["cluster"]
        cluster_counts[c] = cluster_counts.get(c, 0) + 1

    print(f"\nAssigned {len(new_assignments)} books to clusters:")
    low_conf = sum(1 for a in new_assignments if a["probability"] < 0.3)
    med_conf = sum(1 for a in new_assignments if 0.3 <= a["probability"] < 0.5)
    high_conf = sum(1 for a in new_assignments if a["probability"] >= 0.5)
    print(f"  High confidence (>0.5): {high_conf}")
    print(f"  Medium confidence (0.3-0.5): {med_conf}")
    print(f"  Low confidence (<0.3): {low_conf}")

    avg_sim = np.mean(best_similarities)
    print(f"  Average similarity: {avg_sim:.3f}")

    # Show top clusters by new additions
    # Load curated names from cluster summaries
    curated_names = {}
    for label_str, cs in results.get("clusters", {}).items():
        label = int(label_str)
        # Use top themes/terms as fallback name
        themes = [t["theme"] for t in cs.get("top_themes", [])[:2]]
        terms = [t["term"] for t in cs.get("top_terms", [])[:2]]
        curated_names[label] = ", ".join(themes) if themes else ", ".join(terms)

    # Also try loading named subclusters for better names
    try:
        with open(OUTPUT_DIR / "named-subclusters.json") as f:
            named_subs = json.load(f)
        for ns in named_subs:
            rid = ns.get("raw_id")
            if rid is not None and ns.get("parent"):
                curated_names[rid] = ns["parent"]
    except FileNotFoundError:
        pass

    top_clusters = sorted(cluster_counts.items(), key=lambda x: -x[1])[:15]
    print(f"\nTop clusters receiving new books:")
    for cid, count in top_clusters:
        name = curated_names.get(cid, f"Cluster {cid}")
        existing = len(cluster_members.get(cid, []))
        print(f"  {name}: +{count} (was {existing})")

    # Save expanded assignments
    output = {
        "generated": "2026-03-15",
        "method": "nearest-centroid",
        "stats": {
            "new_books": len(new_assignments),
            "avg_similarity": float(avg_sim),
            "high_confidence": high_conf,
            "medium_confidence": med_conf,
            "low_confidence": low_conf,
        },
        "assignments": new_assignments,
        "title_only_skipped": [b["id"] for b in title_only],
    }

    out_path = OUTPUT_DIR / "taxonomy-expansion.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
