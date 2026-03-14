#!/usr/bin/env python3
"""Apply round 2 of review edits: Judaism split, Classical Greek refinement,
Hai Guo Tu Zhi merge, Geomancy move, Plato/Neoplatonism kept separate."""

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

with open(OUTPUT_DIR / "named-subclusters.json") as f:
    data = json.load(f)

by_id = {r["raw_id"]: r for r in data}

# ── Classical Greek & Latin (36): rename subclusters ──
# Original order: General Lit (57), Plato & Neoplatonic (43), Byzantine (14),
#   Neoplatonic Theology (14), Homeric Epics (13), Stoics (13), Pythagorean (9)
# The 57-book "General Lit" is 60% Greek drama/poetry, 26% Latin
# Split conceptually: keep Plato separate from Neoplatonism per user
r = by_id[36]
r["subclusters"][0]["name"] = "Greek Drama, Poetry and Prose"  # 57 — mostly Euripides, Sophocles, Pindar, Lucian + some Latin
r["subclusters"][1]["name"] = "Platonic Philosophy"  # 43
r["subclusters"][2]["name"] = "Byzantine History and Culture"  # 14
r["subclusters"][3]["name"] = "Neoplatonism"  # 14
r["subclusters"][4]["name"] = "Homeric Epics and Hymns"  # 13
r["subclusters"][5]["name"] = "Stoic Philosophy"  # 13
r["subclusters"][6]["name"] = "Pythagorean Tradition"  # 9

# ── Biblical Scholarship (45): rename Judaism subclusters ──
r = by_id[45]
r["subclusters"][2]["name"] = "Jewish History and Theology"  # 16
r["subclusters"][3]["name"] = "Hebrew Language and Philology"  # 11

# ── Hai Guo Tu Zhi (13): mark for merge into Chinese Military ──
# We'll handle this in build-review-ui.py by moving cluster 13 into Chinese Military domain
# For the named-subclusters, rename to clarify
r = by_id[13]
r["parent"] = "Chinese Military (Hai Guo Tu Zhi)"

# ── Chinese Cosmology (6): rename subclusters ──
r = by_id[6]
r["subclusters"][0]["name"] = "Illustrated Compendia"  # 87
r["subclusters"][2]["name"] = "Sinological Studies"  # 13 (drop "& Superstitions")
r["subclusters"][3]["name"] = "Japanese Religion and Folklore"  # 13
r["subclusters"][4]["name"] = "Buddhist Sutras and Doctrine"  # 12

# Save
with open(OUTPUT_DIR / "named-subclusters.json", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("Applied round 2 edits:")
print("  - Classical Greek: Greek Drama/Poetry/Prose, Platonic Philosophy, Neoplatonism (separate)")
print("  - Biblical Scholarship: Jewish History and Theology, Hebrew Language and Philology")
print("  - Hai Guo Tu Zhi → Chinese Military")
print("  - Chinese Cosmology subs cleaned up")
