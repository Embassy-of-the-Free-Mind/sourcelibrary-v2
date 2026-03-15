#!/usr/bin/env python3
"""
Apply curated review edits to restored-named-subclusters.json.
Parent renames already baked into OLD_CURATED_NAMES. This handles
subcluster-level refinements where the spirit of old edits applies.
"""

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

with open(OUTPUT_DIR / "restored-named-subclusters.json") as f:
    data = json.load(f)

by_id = {r["cluster_id"]: r for r in data}

# ── Freemasonry (12): Simplify subcluster names ──
r = by_id[12]
# "German Freemasonry Discourse" (21) → "Freemasonry"
# "Illuminati Order Documents" (16) → "The Illuminati"
r["subclusters"][0]["name"] = "Freemasonry"
r["subclusters"][1]["name"] = "The Illuminati"

# ── Biblical Scholarship (45): Flag Jewish subclusters ──
r = by_id[45]
# "Bibles and Biblical Texts" (184) — keep
# "Works by Menasseh ben Israel" (13) → "Jewish History and Theology"
# "Hebrew Kabbalah Manuscripts" (12) → "Hebrew Kabbalah"
r["subclusters"][1]["name"] = "Jewish History and Theology"
r["subclusters"][2]["name"] = "Hebrew Kabbalah"

# ── Chinese Cosmology (6): Clean up long names ──
r = by_id[6]
# "Religious Systems and Superstitions" → "Religious Systems"
for sc in r["subclusters"]:
    if "Superstition" in sc["name"]:
        sc["name"] = "Religious Systems"

# ── Renaissance Philosophy (32): Keep as-is ──
# Can't merge Ficino+Pico+Bruno — they're in the 329-book main cluster now

# ── Classical Greek (36): Keep Plato separate from Neoplatonism ──
# Already separate: "Plato's Dialogues" (44) and others
# Rename some for clarity
r = by_id[36]
for sc in r["subclusters"]:
    if sc["name"] == "Plato's Dialogues":
        sc["name"] = "Platonic Philosophy"
    elif sc["name"] == "Seneca and Epictetus":
        sc["name"] = "Stoic Philosophy"
    elif sc["name"] == "Late Antique Philosophy":
        sc["name"] = "Neoplatonism"
    elif sc["name"] == "Plato's Timaeus Commentary":
        sc["name"] = "Platonic Cosmology"

# ── Continental Mysticism (47): Refine ──
r = by_id[47]
# "Classical Mystical Theology" is fine for 298-book cluster
# "Eckhart and Steiner" (10) — keep

# ── Rosicrucian (11): Rename subclusters for clarity ──
r = by_id[11]
for sc in r["subclusters"]:
    if sc["name"] == "Exposés and Secret Histories":
        sc["name"] = "Anti-Rosicrucian Literature"

# Save
with open(OUTPUT_DIR / "restored-named-subclusters.json", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("Applied restored review edits:")
print("  - Freemasonry: Freemasonry / The Illuminati")
print("  - Biblical Scholarship: Jewish History and Theology, Hebrew Kabbalah")
print("  - Chinese Cosmology: Religious Systems (dropped 'Superstitions')")
print("  - Classical Greek: Platonic Philosophy, Stoic Philosophy, Neoplatonism")
print("  - Rosicrucian: Anti-Rosicrucian Literature")
