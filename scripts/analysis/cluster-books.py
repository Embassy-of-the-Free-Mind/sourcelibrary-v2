#!/usr/bin/env python3
"""
Phase 1: Discovery clustering for Source Library books.

Embeds book features using Gemini text-embedding-004, then clusters
with UMAP + HDBSCAN to discover natural groupings.

Outputs:
  - scripts/output/cluster-results.json (book→cluster assignments + cluster summaries)
  - scripts/output/cluster-viz.html (interactive 2D scatter plot)
"""

import json
import os
import sys
import time
import numpy as np
from pathlib import Path

# Local embedding (no API needed)
from sentence_transformers import SentenceTransformer

# Clustering
import umap
import hdbscan

# Visualization
import plotly.express as px
import plotly.io as pio

OUTPUT_DIR = Path(__file__).parent.parent / "output"

def load_books():
    """Load book features and filter to those with good text signal."""
    with open(OUTPUT_DIR / "book-features.json") as f:
        books = json.load(f)

    # Keep books with summary OR themes OR sufficient index terms
    good = [b for b in books if
            len(b.get("summary", "")) > 50 or
            len(b.get("themes", [])) > 0 or
            len(b.get("top_terms", [])) > 5]

    print(f"Loaded {len(books)} total, {len(good)} with good signal")
    return good


def build_text_repr(book):
    """Build a text representation for embedding."""
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
        # Truncate very long summaries
        parts.append(f"Summary: {summary[:1000]}")

    themes = book.get("themes", [])
    if themes:
        parts.append(f"Themes: {', '.join(themes[:10])}")

    terms = book.get("top_terms", [])
    if terms:
        parts.append(f"Key terms: {', '.join(terms[:20])}")

    return "\n".join(parts)


def embed_books(texts):
    """Embed texts using local sentence-transformers (no API needed)."""
    print("  Loading model all-mpnet-base-v2...")
    model = SentenceTransformer("all-mpnet-base-v2")
    print(f"  Encoding {len(texts)} texts...")
    embeddings = model.encode(
        texts,
        show_progress_bar=True,
        batch_size=64,
        normalize_embeddings=True,
    )
    return np.array(embeddings)


def cluster_embeddings(embeddings, min_cluster_size=15, min_samples=5):
    """Run UMAP dimensionality reduction + HDBSCAN clustering."""
    print(f"\nRunning UMAP on {embeddings.shape} embeddings...")
    reducer = umap.UMAP(
        n_components=10,  # intermediate dims for clustering
        n_neighbors=30,
        min_dist=0.0,
        metric="cosine",
        random_state=42
    )
    umap_10d = reducer.fit_transform(embeddings)

    # Also get 2D for visualization
    reducer_2d = umap.UMAP(
        n_components=2,
        n_neighbors=30,
        min_dist=0.3,
        metric="cosine",
        random_state=42
    )
    umap_2d = reducer_2d.fit_transform(embeddings)

    print(f"Running HDBSCAN (min_cluster_size={min_cluster_size})...")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom"
    )
    labels = clusterer.fit_predict(umap_10d)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = (labels == -1).sum()
    print(f"Found {n_clusters} clusters, {n_noise} noise points ({n_noise*100//len(labels)}%)")

    return labels, umap_2d, clusterer.probabilities_


def analyze_clusters(books, labels, embeddings):
    """Extract representative info per cluster."""
    clusters = {}

    for idx, (book, label) in enumerate(zip(books, labels)):
        label = int(label)
        if label not in clusters:
            clusters[label] = {
                "books": [],
                "all_terms": {},
                "all_themes": {},
                "languages": {},
                "years": [],
            }
        c = clusters[label]
        c["books"].append({
            "id": book["id"],
            "title": book["title"],
            "author": book["author"],
            "language": book.get("language", ""),
            "year": book.get("year"),
        })

        # Aggregate terms
        for term in book.get("top_terms", []):
            t = term.lower().strip()
            c["all_terms"][t] = c["all_terms"].get(t, 0) + 1

        for theme in book.get("themes", []):
            t = theme.lower().strip()
            c["all_themes"][t] = c["all_themes"].get(t, 0) + 1

        lang = book.get("language", "Unknown")
        c["languages"][lang] = c["languages"].get(lang, 0) + 1

        if book.get("year"):
            c["years"].append(book["year"])

    # Build summary per cluster
    summaries = {}
    for label, c in sorted(clusters.items()):
        if label == -1:
            name = "Unclustered"
        else:
            name = f"Cluster {label}"

        top_terms = sorted(c["all_terms"].items(), key=lambda x: -x[1])[:15]
        top_themes = sorted(c["all_themes"].items(), key=lambda x: -x[1])[:10]
        top_langs = sorted(c["languages"].items(), key=lambda x: -x[1])[:5]

        year_range = None
        median_year = None
        if c["years"]:
            c["years"].sort()
            year_range = [c["years"][0], c["years"][-1]]
            median_year = c["years"][len(c["years"]) // 2]

        summaries[label] = {
            "label": label,
            "size": len(c["books"]),
            "top_terms": [{"term": t, "count": n} for t, n in top_terms],
            "top_themes": [{"theme": t, "count": n} for t, n in top_themes],
            "languages": [{"lang": l, "count": n} for l, n in top_langs],
            "year_range": year_range,
            "median_year": median_year,
            "sample_books": [
                {"title": b["title"], "author": b["author"], "year": b["year"]}
                for b in c["books"][:8]
            ],
        }

    return summaries


def create_visualization(books, labels, umap_2d, cluster_summaries):
    """Create interactive Plotly scatter plot."""
    # Build hover text and color labels
    hover_texts = []
    color_labels = []

    for book, label in zip(books, labels):
        label = int(label)
        hover = f"<b>{book['title'][:60]}</b><br>{book['author']}<br>"
        if book.get('year'):
            hover += f"Year: {book['year']}<br>"
        hover += f"Language: {book.get('language', '?')}"
        hover_texts.append(hover)

        if label == -1:
            color_labels.append("Unclustered")
        else:
            # Use top theme or top term as cluster label
            cs = cluster_summaries.get(label, {})
            themes = cs.get("top_themes", [])
            terms = cs.get("top_terms", [])
            if themes:
                color_labels.append(f"{label}: {themes[0]['theme']}")
            elif terms:
                color_labels.append(f"{label}: {terms[0]['term']}")
            else:
                color_labels.append(f"Cluster {label}")

    fig = px.scatter(
        x=umap_2d[:, 0],
        y=umap_2d[:, 1],
        color=color_labels,
        hover_name=hover_texts,
        title=f"Source Library: {len(books)} books, {len(set(labels))-1} clusters",
        width=1400,
        height=900,
        opacity=0.7,
    )
    fig.update_layout(
        showlegend=True,
        legend=dict(
            itemsizing="constant",
            font=dict(size=10),
        ),
        plot_bgcolor="white",
    )
    fig.update_traces(marker=dict(size=5))

    out_path = OUTPUT_DIR / "cluster-viz.html"
    pio.write_html(fig, str(out_path))
    print(f"\nVisualization saved to {out_path}")
    return out_path


def main():
    print("=== Source Library Book Clustering ===\n")

    # 1. Load and prepare
    books = load_books()
    texts = [build_text_repr(b) for b in books]

    # Check for cached embeddings
    embed_cache = OUTPUT_DIR / "book-embeddings.npy"
    ids_cache = OUTPUT_DIR / "book-embed-ids.json"

    if embed_cache.exists() and ids_cache.exists():
        print(f"\nLoading cached embeddings from {embed_cache}")
        embeddings = np.load(str(embed_cache))
        with open(ids_cache) as f:
            cached_ids = json.load(f)
        # Verify same books
        current_ids = [b["id"] for b in books]
        if cached_ids == current_ids and embeddings.shape[0] == len(books):
            print(f"  Cache valid: {embeddings.shape}")
        else:
            print(f"  Cache stale (IDs changed), re-embedding...")
            embeddings = None
    else:
        embeddings = None

    if embeddings is None:
        # 2. Embed
        print(f"\nEmbedding {len(texts)} books with Gemini text-embedding-004...")
        embeddings = embed_books(texts)
        # Cache
        np.save(str(embed_cache), embeddings)
        with open(ids_cache, "w") as f:
            json.dump([b["id"] for b in books], f)
        print(f"Cached embeddings to {embed_cache}")

    # 3. Cluster
    labels, umap_2d, probs = cluster_embeddings(embeddings)

    # 4. Analyze
    print("\nAnalyzing clusters...")
    cluster_summaries = analyze_clusters(books, labels, embeddings)

    # Print cluster overview
    print(f"\n{'='*70}")
    print(f"{'Cluster':<10} {'Size':>6}  {'Median Year':>12}  {'Top Themes / Terms'}")
    print(f"{'='*70}")
    for label in sorted(cluster_summaries.keys()):
        cs = cluster_summaries[label]
        if label == -1:
            name = "Noise"
        else:
            name = f"C{label}"

        themes = [t["theme"] for t in cs.get("top_themes", [])[:3]]
        terms = [t["term"] for t in cs.get("top_terms", [])[:3]]
        descriptor = ", ".join(themes) if themes else ", ".join(terms)

        my = cs.get("median_year", "")
        my_str = str(my) if my else "?"

        print(f"{name:<10} {cs['size']:>6}  {my_str:>12}  {descriptor[:50]}")

    # 5. Save results
    results = {
        "total_books": len(books),
        "total_with_signal": len(books),
        "n_clusters": len(set(labels)) - (1 if -1 in labels else 0),
        "n_noise": int((np.array(labels) == -1).sum()),
        "clusters": cluster_summaries,
        "book_assignments": [
            {"id": b["id"], "cluster": int(l), "probability": float(p)}
            for b, l, p in zip(books, labels, probs)
        ],
    }

    results_path = OUTPUT_DIR / "cluster-results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to {results_path}")

    # 6. Visualize
    create_visualization(books, labels, umap_2d, cluster_summaries)

    print("\nDone!")


if __name__ == "__main__":
    main()
