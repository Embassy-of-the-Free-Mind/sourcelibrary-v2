#!/usr/bin/env python3
# PRIOR ART: /root/tibetan-reocr/build-concordance.py (Hetzner) — locates a manuscript page's Derge
# folio from the 84000 TEI; it stops at the folio identity and never returns the English. The June
# benchmark (ops docs/tibetan-translation-vs-84000-benchmark-2026-06-21.md) read 84000's
# data-tm-alignments TSV, not the TEI, and its scripts were untracked scratch. Nothing in the repo
# slices the 84000 English by folio.
"""
extract-84000-refs.py — the 84000 English for each sampled page, by Derge volume + folio (#4742).

Runs on Hetzner against the cached TEI in /root/tibetan-reocr/84000-tei/. For each candidate row
({tei_file, vol, folio}) it returns the English of three Derge sides — the side before the matched
folio, the folio, and the side after — because a manuscript page (Thadrak/EAP Kanjur, its own
pagination) overlaps the matched Derge side without coinciding with it. Multi-volume texts (Toh 8
spans eKangyur volumes 14–25) restart folio numbering per volume, and their TEI carries
<ref type="volume" cRef="V14"/> markers: the folio is looked up inside the candidate's volume span,
never by first occurrence. Translator footnotes (<note>) are dropped; folio positions are kept as
⟦F.n.x⟧ markers so a judge can see where the reference sides begin.

The reference is CC BY-NC-ND (84000): judge input only. It is written to the run's data dir, never
to `pages`, and the results file quotes at most short spans.

  python3 extract-84000-refs.py <candidates.json> <tei-dir> <out.json>
"""
import html
import json
import re
import sys

cands_path, tei_dir, out_path = sys.argv[1:4]
cands = json.load(open(cands_path, encoding="utf8"))


def side_key(f):
    n, s = f.split(".")
    return int(n) * 2 + (0 if s == "a" else 1)


def body_text(xml):
    i = xml.find("<body")
    body = xml[i:] if i >= 0 else xml
    j = body.find("<back")
    if j > 0:
        body = body[:j]
    body = re.sub(r"<note\b[^>]*>.*?</note>", " ", body, flags=re.S)
    body = re.sub(r'<ref[^>]*type="volume"[^>]*cRef="V(\d+)"[^>]*/>', r" ⟦V\1⟧ ", body)
    body = re.sub(r'<ref[^>]*cRef="V(\d+)"[^>]*type="volume"[^>]*/>', r" ⟦V\1⟧ ", body)
    body = re.sub(r'<ref cRef="F\.(\d+\.[ab])"[^>]*/>', r" ⟦F.\1⟧ ", body)
    body = re.sub(r"</p>|</head>|</l>|<lb/>", "\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    body = html.unescape(body)
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n\s*\n+", "\n", body)
    return body


cache = {}
out = {}
for c in cands:
    key = f"{c['book']}_{int(c['page']):05d}"
    rec = {"toh": c["toh"], "vol": c["vol"], "folio": c["folio"], "tei_file": c["tei_file"], "title_en": " ".join(c["title_en"].split())}
    try:
        if c["tei_file"] not in cache:
            cache[c["tei_file"]] = body_text(open(f"{tei_dir}/{c['tei_file']}", encoding="utf8").read())
    except FileNotFoundError:
        rec["error"] = "tei file missing"
        out[key] = rec
        continue
    text = cache[c["tei_file"]]
    vols = [(m.start(), int(m.group(1))) for m in re.finditer(r"⟦V(\d+)⟧", text)]
    seg_start, seg_end = 0, len(text)
    if vols:
        hit = [k for k, (_, v) in enumerate(vols) if v == int(c["vol"])]
        if not hit:
            rec["error"] = f"volume V{c['vol']} not in TEI (has {sorted(set(v for _, v in vols))})"
            out[key] = rec
            continue
        k = hit[0]
        # text before the first volume marker belongs to the first volume (its F.1.b precedes V14)
        seg_start = 0 if k == 0 else vols[k][0]
        seg_end = vols[k + 1][0] if k + 1 < len(vols) else len(text)
        rec["volume_marker"] = f"V{c['vol']}"
    seg = text[seg_start:seg_end]
    markers = [(m.start(), m.group(1)) for m in re.finditer(r"⟦F\.(\d+\.[ab])⟧", seg)]
    keys = [side_key(f) for _, f in markers]
    target = side_key(c["folio"])
    if target not in keys:
        lo = markers[0][1] if markers else "-"
        hi = markers[-1][1] if markers else "-"
        rec["error"] = f"folio {c['folio']} not in TEI span ({len(markers)} folio markers, {lo}..{hi})"
        out[key] = rec
        continue
    i = keys.index(target)
    start = markers[i - 1][0] if i >= 1 and keys[i - 1] == target - 1 else markers[i][0]
    if i + 1 < len(markers) and keys[i + 1] == target + 1:
        end = markers[i + 2][0] if i + 2 < len(markers) else len(seg)
    else:
        end = markers[i + 1][0] if i + 1 < len(markers) else len(seg)
    rec["sides"] = sorted(set(re.findall(r"⟦F\.(\d+\.[ab])⟧", seg[start:end])), key=side_key)
    rec["text"] = seg[start:end].strip()
    rec["chars"] = len(rec["text"])
    out[key] = rec

json.dump(out, open(out_path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
ok = [k for k, v in out.items() if "text" in v]
print(f"{len(ok)}/{len(out)} references extracted")
for k, v in out.items():
    print(k, v.get("toh"), f"V{v['vol']}", v.get("folio"), v.get("error") or f"{v['chars']} chars, sides {v['sides']} {v.get('volume_marker','')}")
