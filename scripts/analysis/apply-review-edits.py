#!/usr/bin/env python3
"""Apply Derek's review edits to named-subclusters.json."""

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

with open(OUTPUT_DIR / "named-subclusters.json") as f:
    data = json.load(f)

by_id = {r["raw_id"]: r for r in data}

# ── Freemasonry (12): rename subclusters ──
r = by_id[12]
r["subclusters"][0]["name"] = "Rosicrucianism"
r["subclusters"][1]["name"] = "Freemasonry"
r["subclusters"][2]["name"] = "The Illuminati"
r["subclusters"][3]["name"] = "Misc"

# ── Continental Christian Mysticism (47): shorten ──
r = by_id[47]
r["subclusters"][0]["name"] = "Boehmian Theosophy"

# ── Early Christian Apologetics (44): rename parent ──
by_id[44]["parent"] = "Early Christianity"

# ── Early Modern Eschatology (43): rename parent ──
by_id[43]["parent"] = "Early Modern Prophecy and Apocalypse"

# ── Renaissance Philosophy (32): merge Ficino+Pico+Bruno ──
r = by_id[32]
# Original: Wisdom(31), Love(25), Utopia(15), Pico(9), Ficino(8), French Romances(8), Bruno(8)
# User wants: Wisdom(31), Love(25), Utopia(15), French Romances(8), Ficino Pico and Bruno(~25)
pico = r["subclusters"][3]  # Pico (9)
ficino = r["subclusters"][4]  # Ficino (8)
bruno = r["subclusters"][6]  # Bruno (8)
merged_size = pico["size"] + ficino["size"] + bruno["size"]
r["subclusters"] = [
    r["subclusters"][0],  # Wisdom and Erudition (31)
    r["subclusters"][1],  # Love and Divine Poetry (25)
    {"name": "Ficino, Pico and Bruno", "size": merged_size,
     "languages": {**(pico.get("languages", {})), **(ficino.get("languages", {})), **(bruno.get("languages", {}))}},
    r["subclusters"][2],  # Utopia and Florentine Studies (15)
    r["subclusters"][5],  # French Romances and Troubadours (8)
]

# ── Astrology (31): drop Geomancy subcluster (moved to Magic) ──
r = by_id[31]
r["subclusters"] = [sc for sc in r["subclusters"] if sc["name"] != "Geomancy & Experimental Magic"]

# ── Hindu Philosophy (17): rename parent ──
by_id[17]["parent"] = "Hindu Philosophy"

# ── Grimoires (27): rename parent to be under "Magic and the Occult" ──
# (structural change — handled in build-review-ui.py)

# ── Biblical Scholarship (45): note — user separated Judaism out ──
# Keep subclusters but rename to match user's vision
r = by_id[45]
# User kept: Biblical Texts and Versions, Biblical Narratives and History, Apocrypha
# User pulled out: Judaism and the Hebrews (16), Hebrew Language and Masorah (11)
# For now, rename to flag the separation
r["subclusters"][2]["name"] = "Judaism and the Hebrews"  # already this
r["subclusters"][3]["name"] = "Hebrew Language and Masorah"  # already this

# ── Rosicrucian clusters (11, 30): keep names ──
# User didn't change these

# ── Wubei Zhi (9): rename parent ──
by_id[9]["parent"] = "Chinese Military"

# ── Chinese Religion (6): note subclusters for restructuring ──
# User wants to split into Chinese Cosmology, Chinese Classical Philosophy, Japanese, Buddhism
# Applied in build-review-ui.py structural changes

# ── Medical Philosophy (20): keep as-is ──
# ── Music Theory (0): keep as-is ──
# ── Botany (15): keep as-is ──
# ── Optics (34): keep as-is ──
# ── Baconian (22): keep as-is ──
# ── Anatomy & Engineering (38): keep as-is ──
# ── Mechanical Engineering (37): keep as-is ──

# Save
with open(OUTPUT_DIR / "named-subclusters.json", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("Applied edits:")
print("  - Freemasonry: Rosicrucianism / Freemasonry / The Illuminati / Misc")
print("  - Continental Mysticism: Boehmian Theosophy (shortened)")
print("  - Early Christian Apologetics → Early Christianity")
print("  - Early Modern Eschatology → Early Modern Prophecy and Apocalypse")
print("  - Renaissance Philosophy: merged Ficino+Pico+Bruno into one")
print("  - Astrology: dropped Geomancy (→ Magic)")
print("  - Hindu Philosophy & Indology → Hindu Philosophy")
print("  - Wubei Zhi → Chinese Military")
