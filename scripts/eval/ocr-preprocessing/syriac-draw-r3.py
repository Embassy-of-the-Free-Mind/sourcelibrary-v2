#!/usr/bin/env python3
# PRIOR ART: scripts/eval/benchmark/syriac-retest/prep-syriac-gt.py — the same PAGE-XML reader, the same <= 2400 px
# export rule and the same two published GT sets; it drew the 20+20 pages of rounds 1-2 (seeds 4746/4747). This draws
# the ROUND-3 confirmatory set from the pages it did NOT use, and asserts the two draws are disjoint.
"""#5250 round 3 (pre-registered 2026-09-29): draw FRESH Syriac ground-truth pages for the confirmatory run.

Strata (one manuscript each, as in round 2): `dark-spreads` = Jerusalem SMMJ 36 (HTR Winter School 2025),
`clean-leaves` = ONB Cod. Syr. 1 (HTR Winter School 2024); both CC BY 4.0. 40 pages per stratum, seed "5250r3",
interior pages only (the first and last 3 folios of each set are skipped), and NONE of them may be a round-1/2 page:
the script reads the round-1 manifest and refuses to write if the draws overlap.

usage: syriac-draw-r3.py [--n 40]
  reads  /root/ocr-bench/syriac-retest/{gt/, gt-manifest.json}   (round-1 GT tree + the 40 used pages)
  writes /root/ocr-bench/images/syriac-r3/<slug>.jpg               (<= 2400 px on the long side, q90: the round-1 rule)
         /root/ocr-bench/syriac-r3/gt-text/<slug>.txt, gt-manifest.json, draw-log.json
"""
import argparse
import glob
import json
import os
import random
import re
import xml.etree.ElementTree as ET

from PIL import Image

R = os.environ.get("R1", "/root/ocr-bench/syriac-retest")
OUT_IMG = os.environ.get("OUT_IMG", "/root/ocr-bench/images/syriac-r3")
OUT = os.environ.get("OUT", "/root/ocr-bench/syriac-r3")
EDGE = 3  # folios skipped at each end of a set: "interior page"
SETS = {"jerusalem36": ("dark-spreads", f"{R}/gt/jerusalem36/*.xml"), "onb-syr1": ("clean-leaves", f"{R}/gt/onb-syr1/page/*.xml")}


def page_text(xml):
    t = ET.parse(xml).getroot()
    ns = {"p": t.tag.split("}")[0].strip("{")} if t.tag.startswith("{") else {}
    q = lambda e, x: e.findall(x, ns) if ns else e.findall(x.replace("p:", ""))  # noqa: E731
    lines = []
    for reg in q(t, ".//p:TextRegion"):
        for tl in q(reg, ".//p:TextLine"):
            te = q(tl, "./p:TextEquiv/p:Unicode")
            if te and te[0].text:
                lines.append(te[0].text.strip())
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    a = ap.parse_args()
    os.makedirs(OUT_IMG, exist_ok=True)
    os.makedirs(f"{OUT}/gt-text", exist_ok=True)
    used = {m["slug"] for m in json.load(open(f"{R}/gt-manifest.json"))}
    assert len(used) == 40, len(used)
    rng = random.Random("5250r3")
    manifest, log = [], {"seed": "5250r3", "edge_skipped": EDGE, "round1_used": len(used), "sets": {}}
    for setname, (stratum, pat) in SETS.items():
        xmls = sorted(glob.glob(pat))
        interior = xmls[EDGE:-EDGE]
        fresh = [x for x in interior if f"{setname}-{os.path.splitext(os.path.basename(x))[0]}" not in used]
        order = fresh[:]
        rng.shuffle(order)
        picked, short = [], []
        for x in order:
            if len(picked) >= a.n:
                break
            stem = os.path.splitext(os.path.basename(x))[0]
            slug = f"{setname}-{stem}"
            assert slug not in used, slug
            imgs = [p for p in glob.glob(f"{R}/gt/{setname}/**/{stem}.*", recursive=True) if re.search(r"\.(jpe?g|png|tiff?)$", p, re.I)]
            if not imgs:
                short.append({"stem": stem, "why": "no image"})
                continue
            txt = page_text(x)
            if len(txt) < 40:
                short.append({"stem": stem, "why": f"short GT {len(txt)}"})
                continue
            im = Image.open(imgs[0]).convert("RGB")
            w, h = im.size
            s = min(1.0, 2400 / max(w, h))
            if s < 1:
                im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
            im.save(f"{OUT_IMG}/{slug}.jpg", quality=90)
            open(f"{OUT}/gt-text/{slug}.txt", "w").write(txt)
            manifest.append({"slug": slug, "set": setname, "stratum": stratum, "stem": stem, "gt_chars": len(txt),
                             "gt_lines": txt.count("\n") + 1, "orig_px": [w, h], "export_px": list(im.size)})
            picked.append(slug)
        log["sets"][setname] = {"stratum": stratum, "xml_total": len(xmls), "interior": len(interior), "fresh": len(fresh),
                                "drawn": len(picked), "skipped": short}
        assert len(picked) == a.n, (setname, len(picked))
    manifest.sort(key=lambda m: m["slug"])
    overlap = sorted({m["slug"] for m in manifest} & used)
    log["overlap_with_round1"] = overlap
    assert not overlap, overlap
    json.dump(manifest, open(f"{OUT}/gt-manifest.json", "w"), indent=1)
    json.dump(log, open(f"{OUT}/draw-log.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in log.items() if k != "sets"}))
    for s, v in log["sets"].items():
        print(s, {k: v[k] for k in ("stratum", "xml_total", "interior", "fresh", "drawn")}, "skipped", len(v["skipped"]))
    print("median gt chars", sorted(m["gt_chars"] for m in manifest)[len(manifest) // 2])


if __name__ == "__main__":
    main()
