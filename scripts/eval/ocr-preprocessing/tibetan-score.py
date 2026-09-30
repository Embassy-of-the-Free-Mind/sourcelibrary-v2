#!/usr/bin/env python3
# PRIOR ART: hetzner:/root/tibetan-eval/kanjur_align.py (Derge retrieval + NW identity, window 2) and the #4722 per-leaf
# acceptance rule v3 (hetzner:/root/tibetan-reocr/leaf_finalize.py). This scores every #5250 arm against the Derge
# locus FIXED at draw time and applies the structure checks; it reuses both instruments' definitions.
"""Score the #5250 Tibetan arms (Hetzner). Inputs: tibetan/{referenced,mark}.jsonl, the 18 controls, arm texts in
tibetan/out/txt/<arm>/<stem>.txt (pulled from sl-mitra-1).

Per (page, arm):
  referenced  measure=accuracy vs the fixed Derge window (vol, imgnum ± 2):
              identity = matched / read syllables (precision; cannot see a dropped line),
              matched  = matched Derge syllables (what an omission lowers), lines vs the book's mode, hard loop.
  control     lines vs 14 (the 18 hand-verified "1 short" pages; the positive control must reproduce 18/18 at 14
              with leafcrop).
  mark        acceptance (v3 shape): lines >= mode-1, no hard loop, no whole-line duplicate (two lines >= 10 syllables
              at ratio >= 0.9); plus Derge retrieval (free: not every MARK page is Kanjur).
Writes tibetan/scores.json and prints the paired tables.
"""
import json
import os
import pickle
import sys
from collections import Counter
from difflib import SequenceMatcher

sys.path.insert(0, "/root/tibetan-eval")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kanjur_align as ka  # noqa: E402
import paired as P  # noqa: E402

W = "/root/pp5250/tibetan"
TXT = "/root/tibetan-reocr/txt-yigdzin"
WHOLE = ["none", "none-repeat", "otsu", "sauvola", "clahe", "deskew", "upscale2x"]
LEAF = ["leafcrop", "leafcrop-repeat", "leaf+otsu", "leaf+sauvola", "leaf+clahe", "leaf+deskew"]
TSHEG = "་"


def syls(t):
    return [s for s in t.replace("\n", TSHEG).split(TSHEG) if s.strip()]


def nlines(t):
    return sum(1 for l in t.split("\n") if l.strip())


def hard_loop(text, n=20, k=3):
    s = syls(text)
    if len(s) < n * k:
        return False
    c = Counter(tuple(s[i:i + n]) for i in range(len(s) - n + 1))
    return max(c.values()) >= k


def line_dup(text):
    ls = [l for l in text.split("\n") if len(syls(l)) >= 10]
    for i in range(len(ls)):
        for j in range(i + 1, len(ls)):
            if SequenceMatcher(None, ls[i], ls[j]).ratio() >= 0.9:
                return True
    return False


_FILES = {}


def book_mode(book):
    if not _FILES:
        for f in os.listdir(TXT):
            _FILES.setdefault(f.rsplit("_", 1)[0], []).append(f)
    c = Counter()
    for f in _FILES.get(book, []):
        n = nlines(open(f"{TXT}/{f}", encoding="utf-8").read())
        if n:
            c[n] += 1
    return max((v, k) for k, v in c.items())[1] if c else None


def main():
    idx = pickle.load(open("/root/tibetan-eval/etext-index-full.pkl", "rb"))
    ref = {f"{r['book']}_{int(r['page']):05d}": r for r in map(json.loads, open(f"{W}/referenced.jsonl"))}
    ctrl = {f"{r['book']}_{int(r['page']):05d}": r for r in map(json.loads, open("/root/tibetan-reocr/_tmp-reread-control18.jsonl"))}
    mark = {f"{r['book']}_{int(r['page']):05d}": r for r in map(json.loads, open(f"{W}/mark.jsonl"))}
    modes = {}
    rows = []
    for sub, pages in (("referenced", ref), ("control", ctrl), ("mark", mark)):
        for stem, r in pages.items():
            mode = r.get("mode") or modes.setdefault(r["book"], book_mode(r["book"]))
            if sub == "control":
                mode = 14
            wsyl = ka.window_syllables(idx, r["vol"], r["imgnum"], 2) if sub == "referenced" else None
            for arm in WHOLE + LEAF:
                p = f"{W}/out/txt/{arm}/{stem}.txt"
                if not os.path.exists(p):
                    continue
                t = open(p, encoding="utf-8").read()
                s = ka.syllables(t)
                row = {"stem": stem, "book": r["book"], "substratum": sub, "arm": arm, "syl": len(s),
                       "lines": nlines(t), "mode": mode, "loop": hard_loop(t), "line_dup": line_dup(t)}
                row["at_mode"] = row["lines"] >= mode if mode else None
                if sub == "referenced":
                    ident = ka.nw_identity(s, wsyl) if s else 0.0
                    row.update(identity=round(ident, 4), matched=round(ident * len(s)))
                if sub == "mark":
                    row["accept"] = bool(mode) and row["lines"] >= mode - 1 and not row["loop"] and not row["line_dup"] and len(s) >= 40
                    sc = ka.score_page(idx, t) if len(s) >= 6 else {}
                    row.update(derge_identity=sc.get("identity"), derge_locus=[sc.get("vol"), sc.get("imgnum")])
                rows.append(row)
    json.dump({"rows": rows}, open(f"{W}/scores-rows.json", "w"))
    summarise(rows)


def summarise(rows):
    def col(sub, arm, key):
        return {r["stem"]: (float(r[key]) if r.get(key) is not None else None) for r in rows if r["substratum"] == sub and r["arm"] == arm}

    out = {"stratum": "tibetan-dbu-can", "engine": "BDRC/tibetan-ocr (Yigdzin-v1) @ 50506eb6", "tables": {}}
    for metric, hib in (("identity", True), ("matched", True), ("lines", True)):
        floors = {"whole": P.noise_floor(col("referenced", "none", metric), col("referenced", "none-repeat", metric)),
                  "leaf": P.noise_floor(col("referenced", "leafcrop", metric), col("referenced", "leafcrop-repeat", metric))}
        t = {"noise_floor": floors, "paired": {}}
        for arm in WHOLE[2:] + LEAF:
            if arm.endswith("repeat"):
                continue
            base = "none" if arm in WHOLE or arm == "leafcrop" else "leafcrop"
            fl = floors["whole" if base == "none" else "leaf"]
            c = P.paired(col("referenced", base, metric), col("referenced", arm, metric), higher_is_better=hib)
            c["baseline"] = base
            c["counts"] = P.counts(c, fl)
            t["paired"][arm] = c
        out["tables"][metric] = t
    ctrl = {}
    for arm in WHOLE + LEAF:
        rs = [r for r in rows if r["substratum"] == "control" and r["arm"] == arm]
        if rs:
            ctrl[arm] = {"n": len(rs), "at_14": sum(1 for r in rs if r["lines"] >= 14)}
    out["control"] = ctrl
    mk = {}
    for arm in WHOLE + LEAF:
        rs = [r for r in rows if r["substratum"] == "mark" and r["arm"] == arm]
        if rs:
            mk[arm] = {"n": len(rs), "accept": sum(1 for r in rs if r["accept"]),
                       "derge_ge_085": sum(1 for r in rs if (r.get("derge_identity") or 0) >= 0.85),
                       "loops": sum(1 for r in rs if r["loop"])}
    out["mark"] = mk
    json.dump(out, open(f"{W}/scores.json", "w"), indent=1)
    for metric, t in out["tables"].items():
        print(f"== {metric}  floor whole={t['noise_floor']['whole']}  leaf={t['noise_floor']['leaf']}")
        for arm, c in t["paired"].items():
            print(f"  {arm:13s} vs {c['baseline']:8s} n={c['n']:3d} W-L-T {c['wins']}-{c['losses']}-{c['ties']} medΔ={c['median_delta']} "
                  f"CI={c['ci95']} p={c['sign_p']} counts={c['counts']}")
    print("control at 14:", json.dumps(ctrl))
    print("mark:", json.dumps(mk))


if __name__ == "__main__":
    main()
