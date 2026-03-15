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
# Lightweight domain tags — just for color-coding, not hierarchy
DOMAIN_TAGS = {
    21: "Alchemy", 35: "Esotericism", 27: "Magic", 26: "Magic",
    25: "Witchcraft", 4: "Kabbalah", 12: "Secret Societies",
    11: "Rosicrucianism", 30: "Rosicrucianism",
    18: "Mesmerism", 19: "New Thought",
    47: "Christian Mysticism", 45: "Biblical", 41: "Eastern Christianity",
    44: "Early Christianity", 40: "Swedenborg", 46: "Religious History",
    43: "Prophecy",
    36: "Classical", 32: "Renaissance", 39: "Classical",
    31: "Astronomy", 15: "Botany", 34: "Natural Philosophy",
    22: "Natural Philosophy", 38: "Anatomy & Engineering", 37: "Engineering",
    0: "Music", 20: "Medicine",
    6: "Chinese", 9: "Chinese Military", 13: "Chinese Military",
    2: "Chinese Medicine", 3: "Chinese Medicine", 10: "Chinese",
    14: "Chinese Military",
    8: "Sanskrit", 5: "Sanskrit", 16: "Sanskrit",
    17: "Indian", 28: "Islamic",
    29: "Philosophy", 33: "Philosophy", 23: "Political",
    42: "Political", 24: "Political",
    1: "African & Indigenous", 7: "Celtic",
}

DOMAIN_COLORS = {
    "Alchemy": "#c0392b", "Esotericism": "#e74c3c", "Magic": "#d63031",
    "Witchcraft": "#b71540", "Kabbalah": "#6F1E51", "Secret Societies": "#833471",
    "Rosicrucianism": "#e17055", "Mesmerism": "#fd79a8", "New Thought": "#a29bfe",
    "Christian Mysticism": "#8e44ad", "Biblical": "#6c5ce7", "Eastern Christianity": "#a55eea",
    "Early Christianity": "#8854d0", "Swedenborg": "#9b59b6", "Religious History": "#7c4dff",
    "Prophecy": "#5f27cd",
    "Classical": "#2980b9", "Renaissance": "#3498db",
    "Astronomy": "#27ae60", "Botany": "#00b894", "Natural Philosophy": "#20bf6b",
    "Anatomy & Engineering": "#2d98da", "Engineering": "#45aaf2",
    "Music": "#1abc9c", "Medicine": "#0fb9b1",
    "Chinese": "#d35400", "Chinese Military": "#e67e22", "Chinese Medicine": "#f39c12",
    "Sanskrit": "#16a085", "Indian": "#00cec9", "Islamic": "#636e72",
    "Philosophy": "#7f8c8d", "Political": "#95a5a6",
    "African & Indigenous": "#6ab04c", "Celtic": "#78e08f",
}

# Ordered cluster list — this IS the taxonomy, no domain hierarchy
CLUSTER_ORDER = [
    # Alchemy & Esotericism
    21, 35, 27, 26, 25, 4,
    # Secret Societies
    12, 11, 30,
    # Modern Occultism
    18, 19,
    # Christianity
    47, 45, 41, 44, 40, 46, 43,
    # Classical & Renaissance
    36, 32, 39,
    # Natural Philosophy & Science
    31, 15, 34, 22, 38, 37, 0, 20,
    # Chinese
    6, 9, 13, 14, 2, 3, 10,
    # Indian
    8, 5, 16, 17,
    # Islamic
    28,
    # Philosophy & Political
    29, 33, 23, 42, 24,
    # Other
    1, 7,
]

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


def build_flat_clusters(all_books, results, labels, sub_results, named_subs=None):
    """Build a flat list of clusters with subclusters — no domain hierarchy."""
    book_lookup = {b["id"]: b for b in all_books}
    assignments = results["book_assignments"]

    # Build sub-cluster lookup by raw_id
    sub_by_id = {}
    if sub_results:
        for sr in sub_results:
            if "raw_id" in sr:
                sub_by_id[sr["raw_id"]] = sr

    # Build named subcluster lookup by raw_id
    names_by_id = {}
    if named_subs:
        for ns in named_subs:
            if ns.get("split") and "raw_id" in ns:
                names_by_id[ns["raw_id"]] = [sc["name"] for sc in ns["subclusters"]]

    clusters = []

    for raw_id in CLUSTER_ORDER:
        raw_id_str = str(raw_id)
        cluster_info = labels["clusters"].get(raw_id_str, {})
        size = cluster_info.get("size", 0)
        curated_name = CURATED_NAMES.get(raw_id, cluster_info.get("name", f"Cluster {raw_id}"))
        original_name = cluster_info.get("name", "")
        note = NOTES.get(raw_id, "")
        tag = DOMAIN_TAGS.get(raw_id, "")
        tag_color = DOMAIN_COLORS.get(tag, "#999")

        # Get sample books
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
            "tag": tag,
            "tag_color": tag_color,
            "sample_books": sample,
            "children": [],
        }

        # Sub-clusters
        sr = sub_by_id.get(raw_id)
        sc_names = names_by_id.get(raw_id, [])
        if sr and sr.get("split", True):
            for sc_idx, sc in enumerate(sr["subclusters"]):
                sc_books = sc.get("books", [])
                langs = sc.get("languages", {})
                top_langs = sorted(langs.items(), key=lambda x: -x[1])[:3]
                lang_str = ", ".join(f"{l}: {c}" for l, c in top_langs)

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
                    sc_sample_out = []

                sc_name = sc_names[sc_idx] if sc_idx < len(sc_names) else f"Sub-cluster {sc_idx + 1}"
                cluster_node["children"].append({
                    "name": sc_name,
                    "size": sc["size"],
                    "languages": lang_str,
                    "sample_books": sc_sample_out,
                })

            noise = sr.get("noise_count", 0)
            if noise > 0:
                cluster_node["noise_count"] = noise

        clusters.append(cluster_node)

    return clusters


def generate_html(clusters):
    clusters_json = json.dumps(clusters, ensure_ascii=False, indent=2, default=str)

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
    background: #faf9f6; color: #2c2c2c;
    padding: 24px; max-width: 1100px; margin: 0 auto; line-height: 1.5;
  }}
  h1 {{ font-size: 24px; margin-bottom: 4px; }}
  .subtitle {{ color: #666; margin-bottom: 20px; font-size: 14px; }}
  .toolbar {{
    display: flex; gap: 12px; align-items: center;
    margin-bottom: 20px; padding: 12px 16px;
    background: white; border: 1px solid #e0ddd8; border-radius: 8px; flex-wrap: wrap;
  }}
  .toolbar button {{
    padding: 6px 14px; border: 1px solid #ccc; border-radius: 6px;
    background: white; cursor: pointer; font-size: 13px;
  }}
  .toolbar button:hover {{ background: #f0f0f0; }}
  .toolbar button.primary {{ background: #2c5e3f; color: white; border-color: #2c5e3f; }}
  .toolbar button.primary:hover {{ background: #1e4a2f; }}
  .stats {{ margin-left: auto; font-size: 13px; color: #666; font-variant-numeric: tabular-nums; }}
  .stats strong {{ color: #2c2c2c; }}
  .cluster {{
    margin-bottom: 2px; background: white;
    border: 1px solid #e0ddd8; border-radius: 8px; overflow: hidden;
  }}
  .cluster-row {{
    display: flex; align-items: flex-start; gap: 8px;
    padding: 10px 16px; transition: background 0.1s;
  }}
  .cluster-row:hover {{ background: #faf9f6; }}
  .cluster-row input[type="checkbox"] {{
    margin-top: 3px; flex-shrink: 0; width: 16px; height: 16px;
    cursor: pointer; accent-color: #2c5e3f;
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
  .tag {{
    font-size: 10px; font-weight: 600; padding: 1px 6px;
    border-radius: 8px; color: white; text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  .cluster-note {{ font-size: 12px; color: #b07020; margin-top: 2px; font-style: italic; }}
  .cluster-actions {{ display: flex; gap: 4px; flex-shrink: 0; margin-top: 2px; }}
  .cluster-actions button {{
    font-size: 11px; padding: 2px 8px; border: 1px solid #ddd;
    border-radius: 4px; background: white; cursor: pointer; color: #666;
  }}
  .cluster-actions button:hover {{ background: #f0f0f0; }}
  .sample-books {{ display: none; padding: 6px 16px 12px 44px; font-size: 12px; color: #555; }}
  .sample-books.visible {{ display: block; }}
  .sample-books table {{ width: 100%; border-collapse: collapse; }}
  .sample-books td {{ padding: 2px 8px 2px 0; vertical-align: top; border-bottom: 1px solid #f5f3f0; }}
  .sample-books td:first-child {{ max-width: 400px; }}
  .sample-books td.year {{ font-variant-numeric: tabular-nums; color: #888; white-space: nowrap; }}
  .sample-books td.lang {{ color: #888; white-space: nowrap; }}
  .subclusters {{ display: none; padding: 0 16px 8px 44px; }}
  .subclusters.visible {{ display: block; }}
  .subcluster {{
    margin-bottom: 4px; padding: 8px 12px;
    background: #faf9f6; border: 1px solid #eee; border-radius: 6px;
  }}
  .subcluster-header {{
    display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;
  }}
  .subcluster-header input[type="checkbox"] {{ width: 14px; height: 14px; accent-color: #2c5e3f; }}
  .subcluster-header .sub-badge {{
    font-size: 11px; font-weight: 600;
    background: #e8e5e0; color: #666; padding: 1px 6px; border-radius: 8px;
  }}
  .subcluster-header .sub-langs {{ font-size: 11px; color: #888; margin-left: auto; }}
  .subcluster-books {{ display: none; padding-top: 6px; font-size: 12px; color: #666; }}
  .subcluster-books.visible {{ display: block; }}
  .subcluster-books table {{ width: 100%; border-collapse: collapse; }}
  .subcluster-books td {{ padding: 1px 8px 1px 0; }}
  .noise-note {{ font-size: 11px; color: #c0392b; margin-top: 4px; padding-left: 22px; }}
  .rename-input {{ font-size: 13px; padding: 2px 6px; border: 1px solid #ccc; border-radius: 4px; width: 250px; }}
  .export-area {{ display: none; margin-top: 16px; padding: 16px; background: white; border: 1px solid #e0ddd8; border-radius: 8px; }}
  .export-area.visible {{ display: block; }}
  .export-area textarea {{
    width: 100%; height: 400px; font-family: 'SF Mono', Monaco, monospace;
    font-size: 12px; border: 1px solid #ddd; border-radius: 4px; padding: 8px; resize: vertical;
  }}
  .unclustered-info {{
    padding: 12px 16px; background: white; border: 1px solid #e0ddd8;
    border-radius: 8px; margin-bottom: 16px; font-size: 13px; color: #666;
  }}
  @media (max-width: 700px) {{
    body {{ padding: 12px; }}
    .sample-books, .subclusters {{ padding-left: 28px; }}
  }}
</style>
</head>
<body>

<h1>Cluster Taxonomy Review</h1>
<p class="subtitle">42 clusters, 132 named sub-clusters. Select/deselect, double-click to rename, export JSON.</p>

<div class="toolbar">
  <button onclick="selectAll()">Select All</button>
  <button onclick="deselectAll()">Deselect All</button>
  <button onclick="expandAll()">Expand All</button>
  <button onclick="collapseAll()">Collapse All</button>
  <button class="primary" onclick="exportSelections()">Export</button>
  <div class="stats">
    <strong id="selected-count">0</strong> categories,
    <strong id="selected-books">0</strong> books
  </div>
</div>

<div class="unclustered-info">
  564 books (16%) are <strong>unclustered</strong> (noise) — interdisciplinary texts handled by multi-label tagging, not shown here.
</div>

<div id="tree"></div>

<div id="export-area" class="export-area">
  <p style="margin-bottom: 8px; font-size: 13px; color: #666;">Your selected taxonomy with renames:</p>
  <textarea id="export-json" readonly></textarea>
</div>

<script>
const DATA = {clusters_json};

const state = {{ selected: {{}}, names: {{}}, subNames: {{}} }};

try {{
  const saved = localStorage.getItem('cluster-review-v2');
  if (saved) Object.assign(state, JSON.parse(saved));
}} catch(e) {{}}

function save() {{
  localStorage.setItem('cluster-review-v2', JSON.stringify(state));
  updateStats();
}}

function initState() {{
  const hasSaved = Object.keys(state.selected).length > 0;
  DATA.forEach(c => {{
    const key = String(c.raw_id);
    if (!hasSaved) state.selected[key] = true;
    c.children.forEach((sc, idx) => {{
      if (!hasSaved) state.selected[key + ':' + idx] = true;
    }});
  }});
  save();
}}

function updateStats() {{
  let cats = 0, books = 0;
  DATA.forEach(c => {{
    const key = String(c.raw_id);
    if (!state.selected[key]) return;
    if (c.children.length > 0) {{
      c.children.forEach((sc, idx) => {{
        if (state.selected[key + ':' + idx]) {{ cats++; books += sc.size; }}
      }});
    }} else {{
      cats++; books += c.size;
    }}
  }});
  document.getElementById('selected-count').textContent = cats;
  document.getElementById('selected-books').textContent = books.toLocaleString();
}}

function selectAll() {{ Object.keys(state.selected).forEach(k => state.selected[k] = true); save(); render(); }}
function deselectAll() {{ Object.keys(state.selected).forEach(k => state.selected[k] = false); save(); render(); }}
function expandAll() {{ document.querySelectorAll('.sample-books,.subclusters').forEach(el => el.classList.add('visible')); }}
function collapseAll() {{ document.querySelectorAll('.sample-books,.subclusters').forEach(el => el.classList.remove('visible')); }}

function toggleBooks(id) {{ document.getElementById('books-'+id).classList.toggle('visible'); }}
function toggleSubs(id) {{ document.getElementById('subs-'+id).classList.toggle('visible'); }}
function toggleSubBooks(id) {{ document.getElementById('subbooks-'+id).classList.toggle('visible'); }}

function toggleCluster(key) {{
  state.selected[key] = !state.selected[key];
  Object.keys(state.selected).forEach(k => {{
    if (k.startsWith(key + ':')) state.selected[k] = state.selected[key];
  }});
  save(); render();
}}

function toggleSub(subKey, parentKey) {{
  state.selected[subKey] = !state.selected[subKey];
  const anyChecked = Object.keys(state.selected).some(k => k.startsWith(parentKey + ':') && state.selected[k]);
  if (!anyChecked) state.selected[parentKey] = false;
  if (state.selected[subKey] && !state.selected[parentKey]) state.selected[parentKey] = true;
  save(); render();
}}

function startRename(rawId, currentName) {{
  const el = document.getElementById('name-'+rawId);
  el.innerHTML = `<input class="rename-input" value="${{currentName}}" onblur="finishRename('${{rawId}}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" autofocus>`;
  el.querySelector('input').focus();
}}
function finishRename(rawId, val) {{ if (val.trim()) state.names[rawId] = val.trim(); save(); render(); }}

function startSubRename(key, currentName) {{
  const el = document.getElementById('subname-'+key);
  el.innerHTML = `<input class="rename-input" value="${{currentName}}" onblur="finishSubRename('${{key}}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" autofocus>`;
  el.querySelector('input').focus();
}}
function finishSubRename(key, val) {{ if (val.trim()) state.subNames[key] = val.trim(); save(); render(); }}

function getName(c) {{ return state.names[String(c.raw_id)] || c.name; }}
function getSubName(key, sc) {{ return state.subNames[key] || sc.name; }}

function bookRow(b) {{
  const t = (b.title||'?').replace(/</g,'&lt;'), a = (b.author||'').replace(/</g,'&lt;');
  return `<tr><td>${{t}}</td><td>${{a}}</td><td class="year">${{b.year||''}}</td><td class="lang">${{b.language||''}}</td></tr>`;
}}

function render() {{
  const tree = document.getElementById('tree');
  let html = '';

  DATA.forEach((c, ci) => {{
    const key = String(c.raw_id);
    const checked = state.selected[key] ? 'checked' : '';
    const name = getName(c);
    const hasSubs = c.children && c.children.length > 0;

    html += `<div class="cluster" style="${{!state.selected[key] ? 'opacity:0.45' : ''}}">`;
    html += `<div class="cluster-row">`;
    html += `<input type="checkbox" ${{checked}} onchange="toggleCluster('${{key}}')">`;
    html += `<div class="cluster-info">`;
    html += `<div class="cluster-name">`;
    html += `<span id="name-${{key}}" ondblclick="startRename('${{key}}','${{name.replace(/'/g,"\\\\'")}}')">${{name}}</span>`;
    html += `<span class="badge">${{c.size}}</span>`;
    html += `<span class="tag" style="background:${{c.tag_color}}">${{c.tag}}</span>`;
    html += `</div>`;
    if (c.note) html += `<div class="cluster-note">${{c.note}}</div>`;
    html += `</div>`;
    html += `<div class="cluster-actions">`;
    html += `<button onclick="toggleBooks(${{ci}})">titles</button>`;
    if (hasSubs) html += `<button onclick="toggleSubs(${{ci}})">sub (${{c.children.length}})</button>`;
    html += `</div></div>`;

    html += `<div class="sample-books" id="books-${{ci}}"><table>`;
    c.sample_books.forEach(b => {{ html += bookRow(b); }});
    html += `</table></div>`;

    if (hasSubs) {{
      html += `<div class="subclusters" id="subs-${{ci}}">`;
      c.children.forEach((sc, si) => {{
        const subKey = key + ':' + si;
        const subChecked = state.selected[subKey] ? 'checked' : '';
        const subName = getSubName(subKey, sc);
        const subId = ci + '-' + si;

        html += `<div class="subcluster" style="${{!state.selected[subKey] ? 'opacity:0.45' : ''}}">`;
        html += `<div class="subcluster-header" onclick="toggleSubBooks('${{subId}}')">`;
        html += `<input type="checkbox" ${{subChecked}} onclick="event.stopPropagation();toggleSub('${{subKey}}','${{key}}')" onchange="event.stopPropagation()">`;
        html += `<span id="subname-${{subKey}}" ondblclick="event.stopPropagation();startSubRename('${{subKey}}','${{subName.replace(/'/g,"\\\\'")}}')">${{subName}}</span>`;
        html += `<span class="sub-badge">${{sc.size}}</span>`;
        if (sc.languages) html += `<span class="sub-langs">${{sc.languages}}</span>`;
        html += `</div>`;
        html += `<div class="subcluster-books" id="subbooks-${{subId}}"><table>`;
        sc.sample_books.forEach(b => {{ html += bookRow(b); }});
        html += `</table></div></div>`;
      }});
      if (c.noise_count) html += `<div class="noise-note">${{c.noise_count}} noise books</div>`;
      html += `</div>`;
    }}
    html += `</div>`;
  }});

  tree.innerHTML = html;
  updateStats();
}}

function exportSelections() {{
  const result = {{ exported: new Date().toISOString(), clusters: [] }};
  DATA.forEach(c => {{
    const key = String(c.raw_id);
    if (!state.selected[key]) return;
    const entry = {{ name: getName(c), raw_id: c.raw_id, size: c.size, tag: c.tag }};
    if (c.children.length > 0) {{
      entry.subclusters = [];
      c.children.forEach((sc, idx) => {{
        const subKey = key + ':' + idx;
        if (state.selected[subKey]) {{
          entry.subclusters.push({{ name: getSubName(subKey, sc), size: sc.size }});
        }}
      }});
    }}
    result.clusters.push(entry);
  }});
  document.getElementById('export-area').classList.add('visible');
  document.getElementById('export-json').value = JSON.stringify(result, null, 2);
  document.getElementById('export-area').scrollIntoView({{ behavior: 'smooth' }});
}}

initState();
render();
</script>
</body>
</html>"""


def main():
    print("Loading data...")
    all_books, results, labels, embeddings, sub_results, named_subs = load_data()

    print("Building flat clusters...")
    clusters = build_flat_clusters(all_books, results, labels, sub_results, named_subs)

    print("Generating HTML...")
    html_content = generate_html(clusters)

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
