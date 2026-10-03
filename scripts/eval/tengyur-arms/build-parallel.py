#!/usr/bin/env python3
# PRIOR ART: none in the repo aligns a Tibetan page to a Sanskrit original (git grep gretil: only the
# canon-gap map's licence notes; the Nālandā shelf #5494 holds page images, not aligned e-text). Checked
# scripts/catalog-coverage/canon-gap-map.mjs and scripts/eval/tibetan-mt-ab/ — neither aligns.
"""
build-parallel.py — lever C of the Tengyur quality arms (#5497): a Sanskrit parallel per page.

  python3 scripts/eval/tengyur-arms/build-parallel.py --tref /root/tref --gretil /root/tarms/gretil --out /root/tarms/levers

COVERAGE, text by text (the 8 texts with kept 84000 sides):
  Toh 4377 Bhadracaryāpraṇidhāna — ALIGNED. GRETIL's Gaṇḍavyūhasūtra (Vaidya) ends with its 62 verses.
           The Tibetan runs in 9-syllable lines, 36 syllables a verse, from the homage on f. 300b; a page
           covering syllables [s, e) of the prayer gets Sanskrit verses floor(s/36)+1 … floor(e/36)+1,
           one verse of margin either side. Checked by eye: f. 301a opens mid-v.10 (ye ca daśaddiśi
           lokapradīpā… = …སྒྲོན་མ་རྣམས། །བྱང་ཆུབ་རིམ་པར་).
  Toh 3808 (Bṛhaṭṭīkā on the 100K/25K/18K Prajñāpāramitā) — NOT ALIGNED. The commentary itself is lost in
           Sanskrit. Its lemmas quote the sūtra, and GRETIL holds the Pañcaviṃśati (Kimura, chs. 1–8), but a
           retrieval of the page's Mahāvyutpatti terms over 150-word windows of it found no peak (best
           window 4–9 shared stems against a median of 0–3, top three windows scattered across the text):
           a parallel picked that way would be a wrong passage, which is worse than none.
  Toh 1183 Yogaratnamālā, Toh 1189 Muktāvalī — NOT ALIGNED: the Sanskrit is edited (Snellgrove 1959;
           Tripathi & Negi 2001) but is on neither GRETIL nor our shelf; their lemmas quote the Hevajratantra,
           which GRETIL's index does not carry either.
  Toh 1777, 1996, 3990, 4400a — no Sanskrit on GRETIL or our shelf.

GRETIL is used as REFERENCE-ONLY prompt input: the Sanskrit is never stored on our pages or shown to
readers, and it is not committed (GRETIL's PVS/GV files are CC BY-NC-SA). Output on the box only:
<out>/skt.jsonl {page_id, toh, verses: [lo, hi], sanskrit}.
"""
import json, os, re, sys

arg = lambda k, d: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
TREF, GRETIL, OUT = arg("tref", "/root/tref"), arg("gretil", "/root/tarms/gretil"), arg("out", "/root/tarms/levers")

gv = open(os.path.join(GRETIL, "sa_gaNDavyUhasUtra.txt"), encoding="utf8").read()
bc = gv[gv.index("yāvata keci daśaddiśi loke"):]
verses = {}
for m in re.finditer(r"([\s\S]*?)//\s*(\d+)\s*//", bc):
    n = int(m.group(2))
    if n in verses: break
    verses[n] = " ".join(m.group(1).split())
assert len(verses) >= 60, len(verses)

ref = [json.loads(l) for l in open(os.path.join(TREF, "ref", "reference.jsonl"))]
pages = {}
for l in open(os.path.join(TREF, "pages", "v207.jsonl")):
    p = json.loads(l); pages[p["page_number"]] = p


def syl(s):
    return [x for x in re.split(r"[་།\s]+", re.sub(r"[{}\[\]()#༄༅]|D\d+", "", s)) if x]


rs = sorted((r for r in ref if r["toh"] == "toh4377"), key=lambda r: r["page_number"])
first = rs[0]["page_number"]
pos, span = 0, {}
for n in range(first, rs[-1]["page_number"] + 1):
    s = pages[n]["src"]
    if n == first:
        s = s[s.index("ཕྱག་འཚལ་ལོ") + len("ཕྱག་འཚལ་ལོ"):]
    k = len(syl(s))
    span[n] = (max(1, pos // 36 + 1 - 1), min(max(verses), (pos + k) // 36 + 1 + 1))
    pos += k
out = []
for r in rs:
    lo, hi = span[r["page_number"]]
    out.append({"page_id": r["page_id"], "toh": r["toh"], "verses": [lo, hi],
                "sanskrit": "\n".join(f"{verses[i]} // {i} //" for i in range(lo, hi + 1) if i in verses)})
with open(os.path.join(OUT, "skt.jsonl"), "w") as f:
    for o in out: f.write(json.dumps(o, ensure_ascii=False) + "\n")
print(json.dumps({"aligned_pages": len(out), "by_text": {"toh4377": len(out)}, "spans": [o["verses"] for o in out]}))
