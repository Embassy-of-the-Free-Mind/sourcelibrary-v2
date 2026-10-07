#!/usr/bin/env python3
# PRIOR ART: scripts/eval/benchmark/*.json (sealed strata; refs/<slug>.txt from benchmark-refs.mjs) and
# scripts/eval/ground-truth-ws/ (proofread Wikisource pages) — the references already held. This only SELECTS from
# them for #5250; it builds no reference.
"""Draw the #5250 Gemini strata from references already in the repo (no network).

greek-latin (100):
  greek  50 of the benchmark Greek pages that have refs/<slug>.txt (greek, greek-ext, greek-ext2; one page per book
            by construction of those strata; canonical Perseus/First1K/el.ws windows, not leaf-checked).
  latin  50 of the 65 la.wikisource proofread pages (ground-truth-ws/ws-la-*; leaf-exact, external, no book_id).
cjk-woodblock (all 96): benchmark Chinese pages with refs (Kanripo/CBETA windows, canonical, not leaf-checked).
Seed 5250. Out: <out>/pages.jsonl {slug, stratum, script, image_url, book_id, origin, ref_source, ref}
"""
import glob
import json
import os
import random
import sys

EV = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def bench(files):
    out = []
    for f in files:
        d = json.load(open(f"{EV}/benchmark/{f}.json"))
        for p in d["pages"]:
            ref = f"{EV}/benchmark/refs/{p['slug']}.txt"
            if os.path.exists(ref):
                side = f"{EV}/benchmark/refs/{p['slug']}.json"
                src = json.load(open(side)).get("source") if os.path.exists(side) else None
                out.append({"slug": p["slug"], "image_url": p["image_url"], "book_id": p.get("book_id"),
                            "origin": "library", "ref_source": src, "ref": open(ref, encoding="utf-8").read(), "from": f})
    return out


def main():
    out = sys.argv[1]
    rng = random.Random(5250)
    greek = sorted(bench(["greek", "greek-ext", "greek-ext2"]), key=lambda r: r["slug"])
    books = {}
    for r in greek:
        books.setdefault(r["book_id"], r)  # one page per book (already true; enforced)
    greek = sorted(books.values(), key=lambda r: r["slug"])
    rng.shuffle(greek)
    latin = []
    for f in sorted(glob.glob(f"{EV}/ground-truth-ws/ws-la-*.json")):
        d = json.load(open(f))
        latin.append({"slug": os.path.basename(f)[:-5], "image_url": d["image_url"], "book_id": None, "origin": "external",
                      "ref_source": d.get("source"), "ref": d["ocr_ground_truth"], "fidelity": d.get("fidelity")})
    rng.shuffle(latin)
    cjk = sorted(bench(["chinese", "chinese-ext"]), key=lambda r: r["slug"])
    rows = ([{**r, "stratum": "greek-latin", "script": "greek"} for r in greek[:50]] +
            [{**r, "stratum": "greek-latin", "script": "latin"} for r in latin[:50]] +
            [{**r, "stratum": "cjk-woodblock", "script": "cjk"} for r in cjk])
    os.makedirs(out, exist_ok=True)
    with open(f"{out}/pages.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"greek": min(50, len(greek)), "latin": min(50, len(latin)), "cjk": len(cjk),
                      "cjk_books": len({r["book_id"] for r in cjk})}))


if __name__ == "__main__":
    main()
