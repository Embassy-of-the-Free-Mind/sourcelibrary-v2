#!/usr/bin/env python3
"""
Rebuild the cluster visualization with Gemini-labeled cluster names.
Outputs cluster-viz-labeled.html
"""

import json
import numpy as np
from pathlib import Path
import plotly.graph_objects as go
import plotly.io as pio
import umap

OUTPUT_DIR = Path(__file__).parent.parent / "output"


def main():
    # Load data
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)

    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)

    with open(OUTPUT_DIR / "labeled-clusters.json") as f:
        labels_data = json.load(f)

    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))

    # Build book ID -> features lookup
    book_lookup = {b["id"]: b for b in all_books}

    # Get assignments
    assignments = results["book_assignments"]

    # Re-run UMAP 2D for visualization (deterministic)
    print("Running UMAP 2D projection...")
    reducer_2d = umap.UMAP(
        n_components=2,
        n_neighbors=30,
        min_dist=0.3,
        metric="cosine",
        random_state=42
    )
    umap_2d = reducer_2d.fit_transform(embeddings)

    # Build traces per cluster (so legend works well)
    # Group by cluster label
    cluster_groups = {}
    for i, a in enumerate(assignments):
        cid = str(a["cluster"])
        if cid not in cluster_groups:
            cluster_groups[cid] = {"x": [], "y": [], "text": [], "ids": []}
        g = cluster_groups[cid]
        g["x"].append(float(umap_2d[i, 0]))
        g["y"].append(float(umap_2d[i, 1]))

        book = book_lookup.get(a["id"], {})
        title = book.get("title", "?")[:60]
        author = book.get("author", "")[:30]
        year = book.get("year", "")
        lang = book.get("language", "")
        hover = f"<b>{title}</b><br>{author}<br>{year} | {lang}"
        g["text"].append(hover)
        g["ids"].append(a["id"])

    # Color palette - enough distinct colors for 48 clusters
    colors = [
        "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
        "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4",
        "#469990", "#dcbeff", "#9A6324", "#fffac8", "#800000",
        "#aaffc3", "#808000", "#ffd8b1", "#000075", "#a9a9a9",
        "#e6beff", "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
        "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22",
        "#17becf", "#393b79", "#637939", "#8c6d31", "#843c39",
        "#7b4173", "#5254a3", "#6b6ecf", "#9c9ede", "#8ca252",
        "#b5cf6b", "#cedb9c", "#bd9e39", "#e7ba52", "#e7cb94",
        "#ad494a", "#d6616b", "#e7969c", "#7570b3", "#e7298a",
    ]

    fig = go.Figure()

    # Sort clusters by size (largest first) for legend ordering
    sorted_cids = sorted(
        cluster_groups.keys(),
        key=lambda c: len(cluster_groups[c]["x"]),
        reverse=True
    )

    for idx, cid in enumerate(sorted_cids):
        g = cluster_groups[cid]
        cl = labels_data["clusters"].get(cid, {})

        if cid == "-1":
            name = f"Unclustered ({len(g['x'])})"
            color = "#cccccc"
            opacity = 0.3
            size = 3
        else:
            cname = cl.get("name", f"Cluster {cid}")
            name = f"{cname} ({len(g['x'])})"
            color = colors[idx % len(colors)]
            opacity = 0.75
            size = 5

        fig.add_trace(go.Scatter(
            x=g["x"],
            y=g["y"],
            mode="markers",
            name=name,
            text=g["text"],
            hoverinfo="text",
            marker=dict(
                size=size,
                color=color,
                opacity=opacity,
            ),
            showlegend=True,
        ))

    fig.update_layout(
        title=dict(
            text="Source Library: Natural Clusters in 3,424 Historical Books",
            font=dict(size=20),
        ),
        width=1400,
        height=900,
        plot_bgcolor="#fafaf8",
        paper_bgcolor="white",
        legend=dict(
            font=dict(size=9),
            itemsizing="constant",
            itemwidth=30,
            bgcolor="rgba(255,255,255,0.9)",
            bordercolor="#ddd",
            borderwidth=1,
        ),
        xaxis=dict(showgrid=False, zeroline=False, showticklabels=False, title=""),
        yaxis=dict(showgrid=False, zeroline=False, showticklabels=False, title=""),
        margin=dict(l=20, r=20, t=60, b=20),
    )

    out_path = OUTPUT_DIR / "cluster-viz-labeled.html"
    pio.write_html(fig, str(out_path), include_plotlyjs="cdn")
    print(f"Saved to {out_path}")

    # Also output a static PNG for the blog
    try:
        pio.write_image(fig, str(OUTPUT_DIR / "cluster-viz.png"), width=1400, height=900, scale=2)
        print(f"Saved PNG to {OUTPUT_DIR / 'cluster-viz.png'}")
    except Exception as e:
        print(f"PNG export failed (kaleido not installed?): {e}")


if __name__ == "__main__":
    main()
