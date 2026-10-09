#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tengyur-arms/build-glossary.py (#5497) turns the Mahāvyutpatti into a per-page
# Tibetan→Sanskrit prompt list, and scripts/maintenance/build-tib-skt-table.mjs (#5647) builds a
# Tibetan↔Sanskrit lookup for note facts. Neither gives the ENGLISH renderings a detector must look for
# in our translation; this joins the Mahāvyutpatti terms with 84000's English glossary for that.
"""
build-terms.py — term table for the #5829 technical-term detector (b). $0, offline.

  /root/tref/venv/bin/python scripts/eval/tengyur-characterize/build-terms.py \
      --mvy /root/tchar/mvy/21-Mahavyutpatti-Skt.txt --en /root/tchar/mvy/43-84000Dict.txt --out /root/tchar/terms-mvy.json

Inventory: every Mahāvyutpatti entry of 2+ syllables that 84000's glossary also lists as a <term>.
Accepted renderings: the 84000 English renderings (comma/semicolon split) + the Mahāvyutpatti Sanskrit.
Sources (christiansteinert/tibetan-dictionary): 21-Mahavyutpatti-Skt (DILA digital edition of the 9th-c.
text; no licence stated) and 43-84000Dict (84000 glossary, CC BY-NC-ND). Used as a LOOKUP on the box,
never committed (same rule as build-tib-skt-table.mjs). Wylie → Unicode with pyewts.
"""
import json, re, sys
import pyewts

arg = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
MVY, EN, OUT = arg("mvy", "/root/tchar/mvy/21-Mahavyutpatti-Skt.txt"), arg("en", "/root/tchar/mvy/43-84000Dict.txt"), arg("out", "/root/tchar/terms-mvy.json")
conv = pyewts.pyewts()


def norm_w(w):
    return re.sub(r"\s+", " ", w.strip().strip("/").strip())


mvy = {}
for line in open(MVY, encoding="utf8"):
    if "|" not in line:
        continue
    w, s = line.rstrip("\n").split("|", 1)
    w = norm_w(w)
    if len(w.split()) < 2:
        continue
    s = re.sub(r"\(.*?\)", "", s).strip()
    mvy.setdefault(w, set()).update(x.strip() for x in re.split(r"[,;]", s) if x.strip())

en, is_term = {}, set()
for line in open(EN, encoding="utf8"):
    m = re.match(r"^(.*?)\|<(\w+)>\s*(.*)$", line.rstrip("\n"))
    if not m:
        continue
    w, tag, d = norm_w(m.group(1)), m.group(2), m.group(3)
    if w not in mvy:
        continue
    if tag == "term":
        is_term.add(w)
    # every 84000 rendering counts as accepted, whatever its tag (bcom ldan 'das is a <person> "Blessed One")
    en.setdefault(w, set()).update(x.strip() for x in re.split(r"[,;]", d) if 1 < len(x.strip()) < 60)
en = {w: v for w, v in en.items() if w in is_term}

rows = []
for w, ens in en.items():
    bo = conv.toUnicode(w).rstrip("་")
    if not re.fullmatch(r"[ༀ-࿿]+", bo):
        continue
    rows.append({"wylie": w, "bo": bo, "skt": sorted(mvy[w]), "en": sorted(ens)})
json.dump(rows, open(OUT, "w"), ensure_ascii=False)
print(f"{len(rows)} terms (Mahāvyutpatti 2+ syllables ∩ 84000 <term>) of {len(mvy)} Mvy multi-syllable entries -> {OUT}")
