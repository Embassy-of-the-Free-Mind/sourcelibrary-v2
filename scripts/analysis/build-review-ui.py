#!/usr/bin/env python3
"""
Build a standalone HTML review UI for cluster taxonomy curation.
Shows full hierarchy: macro-domain → cluster → sub-cluster
with checkboxes, book counts, sample titles, and JSON export.
"""

import json
import numpy as np
from pathlib import Path
import html

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# ── Macro-domain assignments (from build-cluster-viz-v2.py) ──
MACRO_DOMAINS = {
    "Western Esotericism": {
        "clusters": [21, 35, 25, 4, 12, 11, 30, 18, 19],
        "color": "#c0392b",
    },
    "Magic and the Occult": {
        "clusters": [27, 26],
        "color": "#e74c3c",
    },
    "Christian Traditions": {
        "clusters": [47, 45, 41, 44, 40, 46, 43],
        "color": "#8e44ad",
    },
    "Classical Greek": {
        "clusters": [36],
        "color": "#2980b9",
    },
    "Classical & Renaissance": {
        "clusters": [32, 39],
        "color": "#3498db",
    },
    "Natural Philosophy & Science": {
        "clusters": [31, 15, 34, 22, 38, 37, 0, 20],
        "color": "#27ae60",
    },
    "Chinese Traditions": {
        "clusters": [6, 9, 13, 2, 3, 10],  # 13=Hai Guo Tu Zhi under Chinese Military
        "color": "#d35400",
    },
    "South & Central Asian": {
        "clusters": [8, 5, 16, 17, 28],
        "color": "#16a085",
    },
    "Other": {
        "clusters": [29, 33, 23, 42, 24, 1, 7],  # removed 14 (Ming Coastal → too small)
        "color": "#7f8c8d",
    },
}

# Curated names for raw clusters
CURATED_NAMES = {
    21: "Western Alchemy",
    35: "Hermeticism & Theurgy",
    27: "Grimoires & Ceremonial Magic",
    26: "Solomonic Grimoires",
    25: "Demonology & Witchcraft",
    11: "Rosicrucian Fraternity Defenses",
    30: "Early Modern Rosicrucianism",
    18: "Animal Magnetism & Mesmerism",
    19: "New Thought & Self-Improvement",
    4:  "Christian Kabbalah",
    12: "Freemasonry & Secret Societies",
    47: "Continental Christian Mysticism",
    45: "Biblical Scholarship",
    41: "Syriac & Armenian Christianity",
    44: "Early Christianity",
    40: "Swedenborgian Theology",
    46: "Religious Persecution & Toleration",
    43: "Early Modern Prophecy and Apocalypse",
    36: "Classical Greek & Latin Texts",
    32: "Renaissance Philosophy",
    39: "Pseudo-Dionysius & Commentators",
    31: "Astrology & Astronomy",
    15: "Botany & Herbals",
    34: "Early Optics & Natural Philosophy",
    22: "Baconian Natural Philosophy",
    38: "Renaissance Anatomy & Engineering",
    37: "Ancient Mechanical Engineering",
    0:  "Music Theory & Harmony",
    20: "Medical Philosophy",
    6:  "Chinese Cosmology",
    9:  "Chinese Military (Wubei Zhi)",
    13: "Chinese Military (Hai Guo Tu Zhi)",
    14: "Ming Dynasty Coastal Defense",
    2:  "Chinese Materia Medica",
    3:  "Chinese Medical Texts",
    10: "Chinese Celestial & Terrestrial Lore",
    8:  "Sanskrit Jyotisha",
    5:  "Sanskrit Astronomical Treatises",
    16: "Sanskrit Divinatory Texts",
    17: "Hindu Philosophy",
    28: "Islamic Mysticism & Philosophy",
    29: "Early Modern Moral Philosophy",
    33: "Early Modern Philosophy",
    23: "Legal & Political Treatises",
    42: "Thirty Years' War Pamphlets",
    24: "Classical Political Economy",
    1:  "African & Indigenous Studies",
    7:  "Celtic & Irish Traditions",
}

# Notes on clusters
NOTES = {
    21: "350 books — very broad, mixes Paracelsians with chrysopoeia",
    36: "187 books — Aristotle to Proclus in one bucket",
    47: "185 books — Bohme to Ruusbroec to Quietism",
    6:  "152 books — Buddhism, Daoism, folk religion all mixed",
    8:  "137 books — largest Sanskrit cluster",
    9:  "66 books — mostly volumes of a single work",
    13: "35 books — mostly volumes of a single work",
    14: "18 books — small, mostly single-work volumes",
    3:  "26 books — overlaps with cluster 2",
    2:  "60 books — includes Bencao Gangmu volumes",
    26: "19 books — could merge with cluster 27",
    30: "25 books — could merge with cluster 11",
    22: "25 books — could merge with cluster 34",
    37: "27 books — could merge with cluster 38",
    41: "41 books — language-driven cluster",
    44: "27 books — could merge with cluster 41",
    40: "18 books — single-author cluster",
    39: "15 books — very specific, single corpus",
    42: "24 books — period artifact, not a subject",
    24: "20 books — tangential to library's focus",
    1:  "29 books — language artifact",
    7:  "29 books — language artifact",
    16: "18 books — small, overlaps with cluster 8",
    5:  "27 books — overlaps with cluster 8",
}


def load_data():
    with open(OUTPUT_DIR / "book-features.json") as f:
        all_books = json.load(f)
    with open(OUTPUT_DIR / "cluster-results.json") as f:
        results = json.load(f)
    with open(OUTPUT_DIR / "labeled-clusters.json") as f:
        labels = json.load(f)
    embeddings = np.load(str(OUTPUT_DIR / "book-embeddings.npy"))

    # Load sub-cluster v2 results (preferred) or v1 fallback
    sub_results = None
    for sub_file in ["sub-cluster-v2.json", "sub-cluster-results.json"]:
        sub_path = OUTPUT_DIR / sub_file
        if sub_path.exists():
            with open(sub_path) as f:
                content = f.read()
                content = content.replace(': NaN', ': null')
                try:
                    sub_results = json.loads(content)
                    print(f"  Loaded sub-cluster data from {sub_file}")
                    break
                except Exception:
                    pass

    # Load named subclusters if available
    named_path = OUTPUT_DIR / "named-subclusters.json"
    named_subs = None
    if named_path.exists():
        with open(named_path) as f:
            named_subs = json.load(f)
        print(f"  Loaded named subclusters ({sum(len(r['subclusters']) for r in named_subs if r.get('split'))} names)")

    return all_books, results, labels, embeddings, sub_results, named_subs


def get_books_for_cluster(assignments, book_lookup, cluster_id):
    """Get sample books for a raw cluster."""
    books = []
    for a in assignments:
        if a["cluster"] == cluster_id:
            book = book_lookup.get(a["id"], {})
            books.append({
                "title": book.get("title", "?")[:70],
                "author": (book.get("author", "") or "")[:35],
                "year": book.get("year", ""),
                "language": book.get("language", ""),
            })
    # Sort by year
    books.sort(key=lambda b: b["year"] if isinstance(b["year"], (int, float)) else 9999)
    return books


def build_hierarchy(all_books, results, labels, sub_results, named_subs=None):
    book_lookup = {b["id"]: b for b in all_books}
    assignments = results["book_assignments"]

    # Build sub-cluster lookup by raw_id (v2 format) and parent name (v1 format)
    sub_by_id = {}
    sub_by_name = {}
    if sub_results:
        for sr in sub_results:
            if "raw_id" in sr:  # v2 format
                sub_by_id[sr["raw_id"]] = sr
            if "parent" in sr:  # v1 format
                sub_by_name[sr["parent"]] = sr

    # Build named subcluster lookup by raw_id
    names_by_id = {}
    if named_subs:
        for ns in named_subs:
            if ns.get("split") and "raw_id" in ns:
                names_by_id[ns["raw_id"]] = [sc["name"] for sc in ns["subclusters"]]

    hierarchy = []

    for domain_name, domain_info in MACRO_DOMAINS.items():
        domain_node = {
            "name": domain_name,
            "color": domain_info["color"],
            "type": "domain",
            "children": [],
            "total_books": 0,
        }

        for raw_id in domain_info["clusters"]:
            raw_id_str = str(raw_id)
            cluster_info = labels["clusters"].get(raw_id_str, {})
            size = cluster_info.get("size", 0)
            curated_name = CURATED_NAMES.get(raw_id, cluster_info.get("name", f"Cluster {raw_id}"))
            original_name = cluster_info.get("name", "")
            note = NOTES.get(raw_id, "")

            # Get sample books for the parent cluster
            books = get_books_for_cluster(assignments, book_lookup, raw_id)
            if len(books) > 10:
                indices = np.linspace(0, len(books) - 1, 10, dtype=int)
                sample = [books[int(i)] for i in indices]
            else:
                sample = books

            cluster_node = {
                "name": curated_name,
                "original_name": original_name,
                "raw_id": raw_id,
                "size": size,
                "note": note,
                "type": "cluster",
                "sample_books": sample,
                "children": [],
            }

            # Check for sub-cluster data (v2 by raw_id, v1 by name)
            sr = sub_by_id.get(raw_id) or sub_by_name.get(curated_name)
            sc_names = names_by_id.get(raw_id, [])
            if sr and sr.get("split", True):
                for sc_idx, sc in enumerate(sr["subclusters"]):
                    # v2 has full book lists; v1 has sample_titles
                    sc_books = sc.get("books", [])
                    langs = sc.get("languages", {})
                    top_langs = sorted(langs.items(), key=lambda x: -x[1])[:3]
                    lang_str = ", ".join(f"{l}: {c}" for l, c in top_langs)

                    # For v2: show spread sample of full book list (up to 12)
                    if sc_books:
                        n_sample = min(12, len(sc_books))
                        if len(sc_books) > n_sample:
                            sample_idx = np.linspace(0, len(sc_books) - 1, n_sample, dtype=int)
                            sc_sample = [sc_books[int(i)] for i in sample_idx]
                        else:
                            sc_sample = sc_books
                        sc_sample_out = [
                            {"title": b.get("title", "?")[:70], "author": b.get("author", "")[:35],
                             "year": b.get("year", ""), "language": b.get("lang", "")}
                            for b in sc_sample
                        ]
                    else:
                        # v1 fallback
                        sc_sample_out = [
                            {"title": t.get("title", "?")[:70], "author": t.get("author", "")[:35],
                             "year": t.get("year", "")}
                            for t in sc.get("sample_titles", [])
                        ]

                    # Use Gemini-generated name if available
                    sc_name = sc_names[sc_idx] if sc_idx < len(sc_names) else f"Sub-cluster {sc_idx + 1}"

                    sc_node = {
                        "name": sc_name,
                        "size": sc["size"],
                        "type": "subcluster",
                        "languages": lang_str,
                        "sample_books": sc_sample_out,
                    }
                    cluster_node["children"].append(sc_node)

                noise = sr.get("noise_count", 0)
                if noise > 0:
                    cluster_node["noise_count"] = noise

            domain_node["children"].append(cluster_node)
            domain_node["total_books"] += size

        hierarchy.append(domain_node)

    return hierarchy


def generate_html(hierarchy):
    # Serialize hierarchy to JSON for the JS side
    hierarchy_json = json.dumps(hierarchy, ensure_ascii=False, indent=2, default=str)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cluster Taxonomy Review — Source Library</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #faf9f6;
    color: #2c2c2c;
    padding: 24px;
    max-width: 1100px;
    margin: 0 auto;
    line-height: 1.5;
  }}
  h1 {{ font-size: 24px; margin-bottom: 4px; }}
  .subtitle {{ color: #666; margin-bottom: 20px; font-size: 14px; }}

  .toolbar {{
    display: flex; gap: 12px; align-items: center;
    margin-bottom: 24px; padding: 12px 16px;
    background: white; border: 1px solid #e0ddd8; border-radius: 8px;
    flex-wrap: wrap;
  }}
  .toolbar button {{
    padding: 6px 14px; border: 1px solid #ccc; border-radius: 6px;
    background: white; cursor: pointer; font-size: 13px;
    transition: all 0.15s;
  }}
  .toolbar button:hover {{ background: #f0f0f0; border-color: #999; }}
  .toolbar button.primary {{
    background: #2c5e3f; color: white; border-color: #2c5e3f;
  }}
  .toolbar button.primary:hover {{ background: #1e4a2f; }}
  .stats {{
    margin-left: auto; font-size: 13px; color: #666;
    font-variant-numeric: tabular-nums;
  }}
  .stats strong {{ color: #2c2c2c; }}

  .domain {{
    margin-bottom: 16px;
    border: 1px solid #e0ddd8;
    border-radius: 8px;
    background: white;
    overflow: hidden;
  }}
  .domain-header {{
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px;
    cursor: pointer; user-select: none;
    font-weight: 600; font-size: 15px;
    border-bottom: 1px solid #e0ddd8;
    transition: background 0.1s;
  }}
  .domain-header:hover {{ background: #f8f7f4; }}
  .domain-header .color-dot {{
    width: 12px; height: 12px; border-radius: 50%;
    flex-shrink: 0;
  }}
  .domain-header .count {{
    margin-left: auto; font-size: 13px; color: #888;
    font-weight: 400; font-variant-numeric: tabular-nums;
  }}
  .domain-header .arrow {{
    font-size: 12px; color: #999; transition: transform 0.2s;
    flex-shrink: 0;
  }}
  .domain-header.collapsed .arrow {{ transform: rotate(-90deg); }}

  .domain-body {{ padding: 0; }}
  .domain-body.hidden {{ display: none; }}

  .cluster {{
    border-bottom: 1px solid #f0ede8;
  }}
  .cluster:last-child {{ border-bottom: none; }}

  .cluster-row {{
    display: flex; align-items: flex-start; gap: 8px;
    padding: 10px 16px 10px 28px;
    transition: background 0.1s;
  }}
  .cluster-row:hover {{ background: #faf9f6; }}
  .cluster-row input[type="checkbox"] {{
    margin-top: 3px; flex-shrink: 0;
    width: 16px; height: 16px; cursor: pointer;
    accent-color: #2c5e3f;
  }}
  .cluster-info {{ flex: 1; min-width: 0; }}
  .cluster-name {{
    font-weight: 500; font-size: 14px;
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  }}
  .cluster-name .badge {{
    font-size: 12px; font-weight: 600;
    background: #eee; color: #555; padding: 1px 7px;
    border-radius: 10px; font-variant-numeric: tabular-nums;
  }}
  .cluster-name .original {{
    font-size: 11px; color: #999; font-weight: 400;
  }}
  .cluster-note {{
    font-size: 12px; color: #b07020; margin-top: 2px;
    font-style: italic;
  }}
  .cluster-actions {{
    display: flex; gap: 4px; flex-shrink: 0; margin-top: 2px;
  }}
  .cluster-actions button {{
    font-size: 11px; padding: 2px 8px; border: 1px solid #ddd;
    border-radius: 4px; background: white; cursor: pointer;
    color: #666;
  }}
  .cluster-actions button:hover {{ background: #f0f0f0; }}

  .sample-books {{
    display: none; padding: 6px 16px 12px 54px;
    font-size: 12px; color: #555;
  }}
  .sample-books.visible {{ display: block; }}
  .sample-books table {{ width: 100%; border-collapse: collapse; }}
  .sample-books td {{
    padding: 2px 8px 2px 0; vertical-align: top;
    border-bottom: 1px solid #f5f3f0;
  }}
  .sample-books td:first-child {{ max-width: 400px; }}
  .sample-books td.year {{ font-variant-numeric: tabular-nums; color: #888; white-space: nowrap; }}
  .sample-books td.lang {{ color: #888; white-space: nowrap; }}

  .subclusters {{
    display: none; padding: 0 16px 8px 54px;
  }}
  .subclusters.visible {{ display: block; }}
  .subcluster {{
    margin-bottom: 8px; padding: 8px 12px;
    background: #faf9f6; border: 1px solid #eee; border-radius: 6px;
  }}
  .subcluster-header {{
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; cursor: pointer;
  }}
  .subcluster-header input[type="checkbox"] {{
    width: 14px; height: 14px; accent-color: #2c5e3f;
  }}
  .subcluster-header .sub-badge {{
    font-size: 11px; font-weight: 600;
    background: #e8e5e0; color: #666; padding: 1px 6px;
    border-radius: 8px;
  }}
  .subcluster-header .sub-langs {{
    font-size: 11px; color: #888; margin-left: auto;
  }}
  .subcluster-books {{
    display: none; padding-top: 6px; font-size: 12px; color: #666;
  }}
  .subcluster-books.visible {{ display: block; }}
  .subcluster-books table {{ width: 100%; border-collapse: collapse; }}
  .subcluster-books td {{ padding: 1px 8px 1px 0; }}

  .noise-note {{
    font-size: 11px; color: #c0392b; margin-top: 4px; padding-left: 22px;
  }}

  .rename-input {{
    font-size: 13px; padding: 2px 6px; border: 1px solid #ccc;
    border-radius: 4px; width: 250px;
  }}

  .export-area {{
    display: none; margin-top: 16px; padding: 16px;
    background: white; border: 1px solid #e0ddd8; border-radius: 8px;
  }}
  .export-area.visible {{ display: block; }}
  .export-area textarea {{
    width: 100%; height: 400px; font-family: 'SF Mono', Monaco, monospace;
    font-size: 12px; border: 1px solid #ddd; border-radius: 4px;
    padding: 8px; resize: vertical;
  }}

  .unclustered-info {{
    padding: 12px 16px; background: white; border: 1px solid #e0ddd8;
    border-radius: 8px; margin-bottom: 16px; font-size: 13px; color: #666;
  }}

  @media (max-width: 700px) {{
    body {{ padding: 12px; }}
    .cluster-row {{ padding-left: 16px; }}
    .sample-books, .subclusters {{ padding-left: 36px; }}
  }}
</style>
</head>
<body>

<h1>Cluster Taxonomy Review</h1>
<p class="subtitle">Select clusters that represent real intellectual categories. Deselect noise, artifacts, and single-work collections. Rename as needed.</p>

<div class="toolbar">
  <button onclick="selectAll()">Select All</button>
  <button onclick="deselectAll()">Deselect All</button>
  <button onclick="expandAll()">Expand All</button>
  <button onclick="collapseAll()">Collapse All</button>
  <button class="primary" onclick="exportSelections()">Export Selections</button>
  <div class="stats">
    Selected: <strong id="selected-count">0</strong> clusters,
    <strong id="selected-books">0</strong> books
  </div>
</div>

<div class="unclustered-info">
  564 books (16%) were classified as <strong>noise</strong> by HDBSCAN — interdisciplinary texts that don't fit any single cluster. These aren't shown here but would be handled by multi-label tagging in the final taxonomy.
</div>

<div id="tree"></div>

<div id="export-area" class="export-area">
  <p style="margin-bottom: 8px; font-size: 13px; color: #666;">Copy this JSON — it contains your selected taxonomy with any renames.</p>
  <textarea id="export-json" readonly></textarea>
</div>

<script>
const DATA = {hierarchy_json};

// State
const state = {{
  selected: {{}},    // "domain:raw_id" or "domain:raw_id:sub_idx" → boolean
  names: {{}},       // "raw_id" → custom name
  expanded: {{}},    // element id → boolean
}};

// Load from localStorage
try {{
  const saved = localStorage.getItem('cluster-review-state');
  if (saved) {{
    const s = JSON.parse(saved);
    Object.assign(state.selected, s.selected || {{}});
    Object.assign(state.names, s.names || {{}});
  }}
}} catch(e) {{}}

function save() {{
  localStorage.setItem('cluster-review-state', JSON.stringify(state));
  updateStats();
}}

function initState() {{
  // Initialize: everything selected by default if no saved state
  const hasSaved = Object.keys(state.selected).length > 0;
  DATA.forEach(domain => {{
    domain.children.forEach(cluster => {{
      const key = `${{domain.name}}:${{cluster.raw_id}}`;
      if (!hasSaved) state.selected[key] = true;
      cluster.children.forEach((sc, idx) => {{
        const subKey = `${{key}}:${{idx}}`;
        if (!hasSaved) state.selected[subKey] = true;
      }});
    }});
  }});
  save();
}}

function updateStats() {{
  let clusters = 0, books = 0;
  DATA.forEach(domain => {{
    domain.children.forEach(cluster => {{
      const key = `${{domain.name}}:${{cluster.raw_id}}`;
      if (state.selected[key]) {{
        if (cluster.children.length > 0) {{
          // Count selected sub-clusters
          cluster.children.forEach((sc, idx) => {{
            const subKey = `${{key}}:${{idx}}`;
            if (state.selected[subKey]) {{
              clusters++;
              books += sc.size;
            }}
          }});
        }} else {{
          clusters++;
          books += cluster.size;
        }}
      }}
    }});
  }});
  document.getElementById('selected-count').textContent = clusters;
  document.getElementById('selected-books').textContent = books.toLocaleString();
}}

function selectAll() {{
  Object.keys(state.selected).forEach(k => state.selected[k] = true);
  save();
  render();
}}
function deselectAll() {{
  Object.keys(state.selected).forEach(k => state.selected[k] = false);
  save();
  render();
}}
function expandAll() {{
  document.querySelectorAll('.domain-body').forEach(el => el.classList.remove('hidden'));
  document.querySelectorAll('.domain-header').forEach(el => el.classList.remove('collapsed'));
  document.querySelectorAll('.sample-books, .subclusters').forEach(el => el.classList.add('visible'));
}}
function collapseAll() {{
  document.querySelectorAll('.domain-body').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.domain-header').forEach(el => el.classList.add('collapsed'));
  document.querySelectorAll('.sample-books, .subclusters').forEach(el => el.classList.remove('visible'));
}}

function toggleDomain(idx) {{
  const body = document.getElementById(`domain-body-${{idx}}`);
  const header = document.getElementById(`domain-header-${{idx}}`);
  body.classList.toggle('hidden');
  header.classList.toggle('collapsed');
}}

function toggleBooks(clusterId) {{
  const el = document.getElementById(`books-${{clusterId}}`);
  el.classList.toggle('visible');
}}
function toggleSubclusters(clusterId) {{
  const el = document.getElementById(`subs-${{clusterId}}`);
  el.classList.toggle('visible');
}}
function toggleSubBooks(subId) {{
  const el = document.getElementById(`subbooks-${{subId}}`);
  el.classList.toggle('visible');
}}

function toggleCluster(key) {{
  state.selected[key] = !state.selected[key];
  // If unchecking a cluster, uncheck its sub-clusters too
  if (!state.selected[key]) {{
    Object.keys(state.selected).forEach(k => {{
      if (k.startsWith(key + ':')) state.selected[k] = false;
    }});
  }}
  // If checking, check sub-clusters too
  if (state.selected[key]) {{
    Object.keys(state.selected).forEach(k => {{
      if (k.startsWith(key + ':')) state.selected[k] = true;
    }});
  }}
  save();
  render();
}}

function toggleSub(key, parentKey) {{
  state.selected[key] = !state.selected[key];
  // If all subs unchecked, uncheck parent
  const anyChecked = Object.keys(state.selected).some(k =>
    k.startsWith(parentKey + ':') && state.selected[k]
  );
  if (!anyChecked) state.selected[parentKey] = false;
  if (state.selected[key] && !state.selected[parentKey]) state.selected[parentKey] = true;
  save();
  render();
}}

function startRename(rawId, currentName) {{
  const el = document.getElementById(`name-${{rawId}}`);
  el.innerHTML = `<input class="rename-input" value="${{currentName}}"
    onblur="finishRename(${{rawId}}, this.value)"
    onkeydown="if(event.key==='Enter')this.blur()"
    autofocus>`;
  el.querySelector('input').focus();
}}
function finishRename(rawId, newName) {{
  if (newName.trim()) state.names[String(rawId)] = newName.trim();
  save();
  render();
}}

function getClusterName(cluster) {{
  return state.names[String(cluster.raw_id)] || cluster.name;
}}

function bookRow(b) {{
  const title = (b.title || '?').replace(/</g, '&lt;');
  const author = (b.author || '').replace(/</g, '&lt;');
  const year = b.year || '';
  const lang = b.language || '';
  return `<tr>
    <td>${{title}}</td>
    <td>${{author}}</td>
    <td class="year">${{year}}</td>
    <td class="lang">${{lang}}</td>
  </tr>`;
}}

function render() {{
  const tree = document.getElementById('tree');
  let html = '';

  DATA.forEach((domain, di) => {{
    const domainBooks = domain.children.reduce((sum, c) => sum + c.size, 0);
    const selectedInDomain = domain.children.filter(c =>
      state.selected[`${{domain.name}}:${{c.raw_id}}`]
    ).length;

    html += `<div class="domain">`;
    html += `<div class="domain-header" id="domain-header-${{di}}" onclick="toggleDomain(${{di}})">`;
    html += `<span class="arrow">&#x25BC;</span>`;
    html += `<span class="color-dot" style="background:${{domain.color}}"></span>`;
    html += `${{domain.name}}`;
    html += `<span class="count">${{selectedInDomain}}/${{domain.children.length}} clusters &middot; ${{domainBooks.toLocaleString()}} books</span>`;
    html += `</div>`;
    html += `<div class="domain-body" id="domain-body-${{di}}">`;

    domain.children.forEach(cluster => {{
      const key = `${{domain.name}}:${{cluster.raw_id}}`;
      const checked = state.selected[key] ? 'checked' : '';
      const name = getClusterName(cluster);
      const hasSubs = cluster.children && cluster.children.length > 0;
      const cid = `${{di}}-${{cluster.raw_id}}`;

      html += `<div class="cluster" style="${{!state.selected[key] ? 'opacity:0.5' : ''}}">`;
      html += `<div class="cluster-row">`;
      html += `<input type="checkbox" ${{checked}} onchange="toggleCluster('${{key}}')">`;
      html += `<div class="cluster-info">`;
      html += `<div class="cluster-name">`;
      html += `<span id="name-${{cluster.raw_id}}" ondblclick="startRename(${{cluster.raw_id}}, '${{name.replace(/'/g, "\\\\'")}}')">${{name}}</span>`;
      html += `<span class="badge">${{cluster.size}}</span>`;
      if (cluster.original_name && cluster.original_name !== name) {{
        html += `<span class="original">was: ${{cluster.original_name}}</span>`;
      }}
      html += `</div>`;
      if (cluster.note) {{
        html += `<div class="cluster-note">${{cluster.note}}</div>`;
      }}
      html += `</div>`;
      html += `<div class="cluster-actions">`;
      html += `<button onclick="toggleBooks('${{cid}}')">titles</button>`;
      if (hasSubs) {{
        html += `<button onclick="toggleSubclusters('${{cid}}')">sub-clusters (${{cluster.children.length}})</button>`;
      }}
      html += `</div>`;
      html += `</div>`;

      // Sample books
      html += `<div class="sample-books" id="books-${{cid}}">`;
      html += `<table>`;
      cluster.sample_books.forEach(b => {{ html += bookRow(b); }});
      html += `</table></div>`;

      // Sub-clusters
      if (hasSubs) {{
        html += `<div class="subclusters" id="subs-${{cid}}">`;
        cluster.children.forEach((sc, si) => {{
          const subKey = `${{key}}:${{si}}`;
          const subChecked = state.selected[subKey] ? 'checked' : '';
          const subId = `${{cid}}-${{si}}`;

          html += `<div class="subcluster" style="${{!state.selected[subKey] ? 'opacity:0.5' : ''}}">`;
          html += `<div class="subcluster-header" onclick="toggleSubBooks('${{subId}}')">`;
          html += `<input type="checkbox" ${{subChecked}} onclick="event.stopPropagation(); toggleSub('${{subKey}}', '${{key}}')" onchange="event.stopPropagation()">`;
          html += `<span>${{sc.name}}</span>`;
          html += `<span class="sub-badge">${{sc.size}}</span>`;
          if (sc.languages) html += `<span class="sub-langs">${{sc.languages}}</span>`;
          html += `</div>`;

          html += `<div class="subcluster-books" id="subbooks-${{subId}}">`;
          html += `<table>`;
          sc.sample_books.forEach(b => {{ html += bookRow(b); }});
          html += `</table></div>`;
          html += `</div>`;
        }});

        if (cluster.noise_count) {{
          html += `<div class="noise-note">${{cluster.noise_count}} books didn't fit any sub-cluster (noise)</div>`;
        }}
        html += `</div>`;
      }}

      html += `</div>`;
    }});

    html += `</div></div>`;
  }});

  tree.innerHTML = html;
  updateStats();
}}

function exportSelections() {{
  const result = {{
    exported: new Date().toISOString(),
    taxonomy: [],
  }};

  DATA.forEach(domain => {{
    const domainResult = {{
      domain: domain.name,
      color: domain.color,
      clusters: [],
    }};

    domain.children.forEach(cluster => {{
      const key = `${{domain.name}}:${{cluster.raw_id}}`;
      if (!state.selected[key]) return;

      const name = getClusterName(cluster);
      const hasSubs = cluster.children && cluster.children.length > 0;

      const clusterResult = {{
        name: name,
        raw_id: cluster.raw_id,
        original_name: cluster.original_name,
        size: cluster.size,
      }};

      if (hasSubs) {{
        clusterResult.subclusters = [];
        cluster.children.forEach((sc, idx) => {{
          const subKey = `${{key}}:${{idx}}`;
          if (state.selected[subKey]) {{
            clusterResult.subclusters.push({{
              size: sc.size,
              languages: sc.languages,
            }});
          }}
        }});
      }}

      domainResult.clusters.push(clusterResult);
    }});

    if (domainResult.clusters.length > 0) {{
      result.taxonomy.push(domainResult);
    }}
  }});

  const area = document.getElementById('export-area');
  area.classList.add('visible');
  document.getElementById('export-json').value = JSON.stringify(result, null, 2);
  area.scrollIntoView({{ behavior: 'smooth' }});
}}

// Init
initState();
render();
</script>
</body>
</html>"""


def main():
    print("Loading data...")
    all_books, results, labels, embeddings, sub_results, named_subs = load_data()

    print("Building hierarchy...")
    hierarchy = build_hierarchy(all_books, results, labels, sub_results, named_subs)

    print("Generating HTML...")
    html_content = generate_html(hierarchy)

    out_path = OUTPUT_DIR / "cluster-review.html"
    with open(out_path, "w") as f:
        f.write(html_content)
    print(f"Saved to {out_path}")

    # Also copy to public for easy access
    public_path = Path(__file__).parent.parent.parent / "public" / "blog" / "clustering" / "review.html"
    public_path.parent.mkdir(parents=True, exist_ok=True)
    with open(public_path, "w") as f:
        f.write(html_content)
    print(f"Also saved to {public_path}")


if __name__ == "__main__":
    main()
