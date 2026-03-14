#!/usr/bin/env python3
"""
Build improved cluster visualization with:
- Curated labels (merged/renamed clusters based on editorial review)
- Cluster name in hover text
- Centroid labels on the map
- Search box (cluster + book-level)
- Legend organized by macro-domain
- Macro-domain coloring with per-cluster variation
"""

import json
import colorsys
import numpy as np
from pathlib import Path
import umap

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# ── Curated taxonomy ────────────────────────────────────────────────
# Each merge group: (new_name, [raw cluster IDs], macro_domain)
# IDs from labeled-clusters.json, verified against HDBSCAN output.

MERGE_GROUPS = [
    # Sanskrit: 3 clusters → 1
    ("Sanskrit Astrology & Astronomy", [8, 5, 16], "South & Central Asian"),
    # Grimoires: 2 → 1
    ("Grimoires & Ritual Magic", [27, 26], "Western Esotericism"),
    # Rosicrucianism: 2 → 1
    ("Rosicrucianism", [11, 30], "Western Esotericism"),
    # Chinese medicine: 2 → 1
    ("Chinese Medicine", [2, 3], "Chinese Traditions"),
    # Chinese military: 3 → 1 (mostly single-work volumes)
    ("Chinese Military & Strategic Texts", [9, 13, 14], "Chinese Traditions"),
    # Patristic: 2 → 1
    ("Patristic & Eastern Christianity", [41, 44], "Christian Traditions"),
    # Natural philosophy: 2 → 1
    ("Natural Philosophy & Optics", [34, 22], "Natural Philosophy & Science"),
    # Engineering: 2 → 1
    ("Engineering & Mechanical Arts", [38, 37], "Natural Philosophy & Science"),
    # Mesmerism + New Thought: 2 → 1
    ("Mesmerism & New Thought", [18, 19], "Western Esotericism"),
    # Political philosophy: 4 → 1
    ("Political & Moral Philosophy", [29, 33, 23, 42], "Other"),
]

# Renames for clusters that stay solo (raw_id → new_name)
RENAMES = {
    6:  "Chinese Religion & Cosmology",
    1:  "African & Indigenous Studies",
    7:  "Celtic & Irish Traditions",
    47: "German & Dutch Mysticism",
    36: "Classical Texts & Philology",
    25: "Demonology & Witchcraft",
    20: "Medical Philosophy",
    40: "Swedenborgian Theology",
    39: "Pseudo-Dionysius & Commentators",
    24: "Classical Political Economy",
    46: "Religious Persecution & Toleration",
    43: "Apocalypticism & Prophecy",
    45: "Biblical Scholarship",
    17: "Hindu Philosophy & Indology",
    28: "Islamic Mysticism & Philosophy",
    31: "Astrology & Astronomy",
    32: "Renaissance Philosophy",
    4:  "Christian Kabbalah",
    0:  "Music Theory & Harmony",
    15: "Botany & Herbals",
    10: "Chinese Celestial & Terrestrial Lore",
    21: "Western Alchemy",
    35: "Hermeticism & Theurgy",
    12: "Freemasonry & Secret Societies",
}

# Macro-domain for non-merged clusters (by raw_id)
MACRO_MAP = {
    21: "Western Esotericism",
    35: "Western Esotericism",
    25: "Western Esotericism",
    4:  "Western Esotericism",
    12: "Western Esotericism",
    47: "Christian Traditions",
    45: "Christian Traditions",
    43: "Christian Traditions",
    40: "Christian Traditions",
    46: "Christian Traditions",
    36: "Classical & Renaissance",
    32: "Classical & Renaissance",
    39: "Classical & Renaissance",
    31: "Natural Philosophy & Science",
    15: "Natural Philosophy & Science",
    20: "Natural Philosophy & Science",
    0:  "Natural Philosophy & Science",
    6:  "Chinese Traditions",
    10: "Chinese Traditions",
    8:  "South & Central Asian",
    17: "South & Central Asian",
    1:  "Other",
    7:  "Other",
    28: "Other",
    24: "Other",
}

# Macro-domain base hues (HSL) and saturation
DOMAIN_STYLE = {
    "Western Esotericism":          {"hue": 5,   "sat": 0.70, "lit": 0.50},
    "Christian Traditions":         {"hue": 275, "sat": 0.55, "lit": 0.50},
    "Classical & Renaissance":      {"hue": 215, "sat": 0.60, "lit": 0.48},
    "Natural Philosophy & Science": {"hue": 135, "sat": 0.55, "lit": 0.42},
    "Chinese Traditions":           {"hue": 40,  "sat": 0.75, "lit": 0.48},
    "South & Central Asian":        {"hue": 175, "sat": 0.60, "lit": 0.42},
    "Other":                        {"hue": 320, "sat": 0.35, "lit": 0.50},
}


def build_curated_mapping(labels_data):
    """Build raw_cluster_id → (curated_name, macro_domain) mapping."""
    mapping = {}

    # Merged clusters
    merged_ids = set()
    for new_name, raw_ids, macro in MERGE_GROUPS:
        for rid in raw_ids:
            mapping[str(rid)] = (new_name, macro)
            merged_ids.add(rid)

    # Solo clusters with renames or original names
    for cid_str, cdata in labels_data["clusters"].items():
        if cid_str == "-1":
            continue
        cid = int(cid_str)
        if cid in merged_ids:
            continue
        name = RENAMES.get(cid, cdata["name"])
        macro = MACRO_MAP.get(cid, "Other")
        mapping[cid_str] = (name, macro)

    return mapping


def generate_colors(curated_groups):
    """Generate colors: same macro-domain = similar hue, distinct per cluster."""
    colors = {}
    # Group curated names by domain
    domain_clusters = {}
    for name, info in curated_groups.items():
        d = info["macro"]
        if d not in domain_clusters:
            domain_clusters[d] = []
        domain_clusters[d].append(name)

    for domain, names in domain_clusters.items():
        style = DOMAIN_STYLE.get(domain, {"hue": 0, "sat": 0.3, "lit": 0.5})
        n = len(names)
        for i, name in enumerate(sorted(names, key=lambda n: -curated_groups[n]["size"])):
            # Spread hue within ±25° of base
            hue_offset = (i - n / 2) * (50 / max(n, 1))
            hue = (style["hue"] + hue_offset) % 360
            # Vary lightness
            lit = style["lit"] + (i % 3 - 1) * 0.08
            lit = max(0.30, min(0.65, lit))
            r, g, b = colorsys.hls_to_rgb(hue / 360, lit, style["sat"])
            colors[name] = f"rgb({int(r*255)},{int(g*255)},{int(b*255)})"

    return colors


def main():
    # Load data
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    with open(OUTPUT_DIR / "labeled-clusters.json") as f:
        labels_data = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))

    book_lookup = {b["id"]: b for b in all_books}
    assignments = results["book_assignments"]

    # Build curated mapping
    mapping = build_curated_mapping(labels_data)

    # Run UMAP 2D
    print("Running UMAP 2D projection...")
    reducer_2d = umap.UMAP(
        n_components=2, n_neighbors=30, min_dist=0.3,
        metric="cosine", random_state=42
    )
    umap_2d = reducer_2d.fit_transform(embeddings)

    # Group books by curated cluster
    curated_groups = {}  # name → {macro, x[], y[], hover[], size}
    noise_group = {"x": [], "y": [], "hover": []}

    for i, a in enumerate(assignments):
        cid = str(a["cluster"])
        x, y = float(umap_2d[i, 0]), float(umap_2d[i, 1])

        book = book_lookup.get(a["id"], {})
        title = book.get("title", "?")[:60]
        author = book.get("author", "")[:30]
        year = book.get("year", "")
        lang = book.get("language", "")

        if cid == "-1":
            hover = f"<b>{title}</b><br>{author}<br>{year} | {lang}<br><i>Unclustered</i>"
            noise_group["x"].append(x)
            noise_group["y"].append(y)
            noise_group["hover"].append(hover)
            continue

        if cid not in mapping:
            continue

        curated_name, macro = mapping[cid]

        if curated_name not in curated_groups:
            curated_groups[curated_name] = {
                "macro": macro, "x": [], "y": [], "hover": [], "size": 0,
            }
        g = curated_groups[curated_name]
        hover = f"<b>{title}</b><br>{author}<br>{year} | {lang}<br><i>{curated_name}</i>"
        g["x"].append(x)
        g["y"].append(y)
        g["hover"].append(hover)
        g["size"] += 1

    # Generate colors
    colors = generate_colors(curated_groups)

    # Sort by macro-domain then size for legend ordering
    domain_order = list(DOMAIN_STYLE.keys())
    sorted_names = sorted(
        curated_groups.keys(),
        key=lambda n: (
            domain_order.index(curated_groups[n]["macro"])
                if curated_groups[n]["macro"] in domain_order else 99,
            -curated_groups[n]["size"],
        ),
    )

    # Build Plotly traces as JSON
    traces = []

    # Noise first (behind everything)
    traces.append({
        "x": noise_group["x"],
        "y": noise_group["y"],
        "mode": "markers",
        "type": "scatter",
        "name": f"Unclustered ({len(noise_group['x'])})",
        "text": noise_group["hover"],
        "hoverinfo": "text",
        "marker": {"size": 3, "color": "#cccccc", "opacity": 0.25},
        "legendgroup": "zzz_noise",
        "legendgrouptitle": {"text": ""},
        "showlegend": True,
    })

    # Curated clusters
    prev_macro = None
    for name in sorted_names:
        g = curated_groups[name]
        macro = g["macro"]
        show_group_title = macro != prev_macro
        prev_macro = macro

        trace = {
            "x": g["x"],
            "y": g["y"],
            "mode": "markers",
            "type": "scatter",
            "name": f"{name} ({g['size']})",
            "text": g["hover"],
            "hoverinfo": "text",
            "marker": {
                "size": 5,
                "color": colors.get(name, "#999"),
                "opacity": 0.75,
            },
            "legendgroup": macro,
            "showlegend": True,
        }
        if show_group_title:
            trace["legendgrouptitle"] = {
                "text": macro,
                "font": {"size": 11, "color": "#666"},
            }
        traces.append(trace)

    # Compute centroids for labels
    annotations = []
    for name in sorted_names:
        g = curated_groups[name]
        if g["size"] < 20:
            continue  # skip small clusters to reduce clutter
        cx = np.mean(g["x"])
        cy = np.mean(g["y"])
        annotations.append({
            "x": cx, "y": cy,
            "text": name,
            "showarrow": False,
            "font": {"size": 8, "color": "rgba(60,60,60,0.7)"},
            "bgcolor": "rgba(255,255,255,0.6)",
            "borderpad": 1,
        })

    layout = {
        "title": {
            "text": "Source Library: Natural Clusters in 3,424 Historical Books",
            "font": {"size": 18},
        },
        "width": 1400,
        "height": 900,
        "plot_bgcolor": "#fafaf8",
        "paper_bgcolor": "white",
        "legend": {
            "font": {"size": 9},
            "itemsizing": "constant",
            "itemwidth": 30,
            "bgcolor": "rgba(255,255,255,0.95)",
            "bordercolor": "#ddd",
            "borderwidth": 1,
            "tracegroupgap": 8,
        },
        "xaxis": {"showgrid": False, "zeroline": False, "showticklabels": False, "title": ""},
        "yaxis": {"showgrid": False, "zeroline": False, "showticklabels": False, "title": ""},
        "margin": {"l": 20, "r": 20, "t": 60, "b": 20},
        "annotations": annotations,
    }

    # Build custom HTML
    plotly_data = json.dumps(traces)
    plotly_layout = json.dumps(layout)

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Source Library Cluster Map</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>
  body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafaf8; }}
  #controls {{ position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 10;
    display: flex; gap: 8px; align-items: center; }}
  #search {{ padding: 6px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px;
    width: 280px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
  #search:focus {{ outline: none; border-color: #888; }}
  #clear-btn {{ padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px;
    background: white; cursor: pointer; color: #666; }}
  #clear-btn:hover {{ background: #f0f0f0; }}
  #match-count {{ font-size: 12px; color: #888; min-width: 80px; }}
  #viz {{ width: 100vw; height: 100vh; }}
</style>
</head>
<body>
<div id="controls">
  <input id="search" type="text" placeholder="Search books or clusters..." />
  <button id="clear-btn" onclick="clearSearch()">Clear</button>
  <span id="match-count"></span>
</div>
<div id="viz"></div>
<script>
const data = {plotly_data};
const layout = {plotly_layout};
layout.width = window.innerWidth;
layout.height = window.innerHeight;
Plotly.newPlot('viz', data, layout, {{responsive: true, scrollZoom: true}});

// Store original opacities
const origOpacities = data.map(t => t.marker.opacity);

const searchInput = document.getElementById('search');
const matchCount = document.getElementById('match-count');
let debounceTimer;

searchInput.addEventListener('input', function() {{
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(this.value), 150);
}});

function clearSearch() {{
  searchInput.value = '';
  doSearch('');
  searchInput.focus();
}}

function doSearch(query) {{
  query = query.toLowerCase().trim();
  if (!query) {{
    // Reset all traces
    data.forEach((trace, i) => {{
      Plotly.restyle('viz', {{'marker.opacity': origOpacities[i], 'marker.size': trace.name.includes('Unclustered') ? 3 : 5}}, [i]);
    }});
    matchCount.textContent = '';
    return;
  }}

  let totalMatches = 0;

  data.forEach((trace, i) => {{
    const clusterMatch = trace.name.toLowerCase().includes(query);
    if (clusterMatch) {{
      // Whole cluster matches — highlight it
      Plotly.restyle('viz', {{'marker.opacity': 0.9, 'marker.size': 7}}, [i]);
      totalMatches += (trace.x || []).length;
    }} else if (trace.text) {{
      // Check individual books
      const perPoint = trace.text.map(t => t.toLowerCase().includes(query));
      const nMatch = perPoint.filter(Boolean).length;
      if (nMatch > 0) {{
        const opacities = perPoint.map(m => m ? 1.0 : 0.04);
        const sizes = perPoint.map(m => m ? 8 : 3);
        Plotly.restyle('viz', {{'marker.opacity': [opacities], 'marker.size': [sizes]}}, [i]);
        totalMatches += nMatch;
      }} else {{
        Plotly.restyle('viz', {{'marker.opacity': 0.04, 'marker.size': 3}}, [i]);
      }}
    }} else {{
      Plotly.restyle('viz', {{'marker.opacity': 0.04, 'marker.size': 3}}, [i]);
    }}
  }});

  matchCount.textContent = totalMatches > 0 ? totalMatches + ' books' : 'No matches';
}}

// Handle keyboard shortcut
searchInput.addEventListener('keydown', function(e) {{
  if (e.key === 'Escape') clearSearch();
}});
</script>
</body>
</html>"""

    out_path = OUTPUT_DIR / "cluster-viz-v2.html"
    with open(out_path, "w") as f:
        f.write(html)
    print(f"Saved to {out_path}")

    # Print summary
    print(f"\n{'='*80}")
    print(f"Curated taxonomy: {len(curated_groups)} clusters (from 48 raw)")
    print(f"Noise: {len(noise_group['x'])} books")
    by_domain = {}
    for name in sorted_names:
        d = curated_groups[name]["macro"]
        if d not in by_domain:
            by_domain[d] = []
        by_domain[d].append((name, curated_groups[name]["size"]))
    for domain in DOMAIN_STYLE:
        if domain in by_domain:
            total = sum(s for _, s in by_domain[domain])
            print(f"\n{domain} ({total} books):")
            for name, size in sorted(by_domain[domain], key=lambda x: -x[1]):
                print(f"  {name:45s} {size:>4}")


if __name__ == "__main__":
    main()
