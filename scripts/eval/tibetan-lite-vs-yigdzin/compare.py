#!/usr/bin/env python3
"""yigdzin-527 comparison, step 2 (#4523): score the one-page-per-book pairs and draw the 40 arbitration pages,
exactly as fixed in scripts/eval/PREREGISTRATION-tibetan-lite-vs-yigdzin.md. CPU only, reads export-pairs.mjs output.
PRIOR ART: /root/tibetan-eval/kanjur_align.py (`syllables`, imported) and /root/tibetan-reocr/leaf_v4.py's use of
`lexicon.valid_share` (imported). Neither computes engine-vs-engine agreement on the same page; this does, and does not
judge which read is right.
Usage: compare.py [results dir]  -> scores-sample.jsonl, summary.json, arbitration-40.json, arbitration-40.html
"""
import json, os, re, sys, hashlib, html, statistics, collections
sys.path.insert(0, "/root/tibetan-eval"); sys.path.insert(0, "/root/tibetan-reocr")
import kanjur_align as ka, lexicon

R = sys.argv[1] if len(sys.argv) > 1 else "/root/yig527/results"
TAG = re.compile(r"<[^>]*>")
NON_TIB = re.compile(r"[^ༀ-࿿\s]")


def norm_syls(t):
    return ka.syllables(NON_TIB.sub("", TAG.sub(" ", t or "")))


def lev(a, b):
    if len(a) < len(b): a, b = b, a
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def agreement(a, b):
    if not a and not b: return None
    return 1 - lev(a, b) / max(len(a), len(b))


def binname(x):
    return "<0.2" if x < 0.2 else "0.2-0.5" if x < 0.5 else "0.5-0.8" if x < 0.8 else ">=0.8"


def describe(xs):
    if not xs: return {"n": 0}
    q = statistics.quantiles(xs, n=4) if len(xs) > 1 else [xs[0]] * 3
    return {"n": len(xs), "median": round(statistics.median(xs), 4), "q1": round(q[0], 4), "q3": round(q[2], 4), "mean": round(statistics.mean(xs), 4),
            "bins": dict(collections.Counter(binname(x) for x in xs))}


def main():
    rows = [json.loads(l) for l in open(f"{R}/pairs-sample.jsonl")]
    out = []
    for r in rows:
        a, b = norm_syls(r["lite"]), norm_syls(r["yig"])
        ag = agreement(a, b)
        out.append({k: r[k] for k in ("book", "title", "provider", "page_id", "page", "image")} | {
            "agreement": None if ag is None else round(ag, 4), "lite_syl": len(a), "yig_syl": len(b),
            "ratio_lite_yig": round(len(a) / len(b), 3) if b else None,
            "valid_lite": round(lexicon.valid_share(a), 4) if a else None, "valid_yig": round(lexicon.valid_share(b), 4) if b else None})
    with open(f"{R}/scores-sample.jsonl", "w") as f:
        for o in out: f.write(json.dumps(o, ensure_ascii=False) + "\n")
    ok = [o for o in out if o["agreement"] is not None]
    xs = [o["agreement"] for o in ok]
    by_prov = collections.defaultdict(list)
    for o in ok: by_prov[o["provider"] if o["provider"] in ("bdrc", "bl") else "other"].append(o["agreement"])
    ratios = [o["ratio_lite_yig"] for o in ok if o["ratio_lite_yig"] is not None]
    summary = {"sample_pages": len(out), "undefined_both_empty": len(out) - len(ok), "agreement": describe(xs),
               "by_provider": {k: describe(v) for k, v in sorted(by_prov.items())},
               "ratio_lite_over_yig": {"median": round(statistics.median(ratios), 3) if ratios else None,
                                       "share_lite_longer_by_20pct": round(sum(r > 1.2 for r in ratios) / len(ratios), 3) if ratios else None},
               "valid_share_median": {"lite": statistics.median([o["valid_lite"] for o in ok if o["valid_lite"] is not None] or [0]),
                                      "yig": statistics.median([o["valid_yig"] for o in ok if o["valid_yig"] is not None] or [0])}}
    # 40 arbitration pages
    full = {r["page_id"]: r for r in rows}
    dis = sorted([o for o in ok if o["agreement"] < 0.5], key=lambda o: hashlib.sha256(("arb:" + o["page_id"]).encode()).hexdigest())
    pick = dis[:40]; filled = 0
    if len(pick) < 40:
        rest = sorted([o for o in ok if o["agreement"] >= 0.5], key=lambda o: o["agreement"])
        add = rest[:40 - len(pick)]; filled = len(add); pick += add
    summary["arbitration"] = {"disagreement_pages_below_0.5": len(dis), "drawn": len(pick), "filled_from_ascending": filled}
    arb = [{"n": i + 1, **o, "lite": full[o["page_id"]]["lite"], "yig": full[o["page_id"]]["yig"], "verdict": None, "note": ""} for i, o in enumerate(pick)]
    json.dump({"protocol": "scripts/eval/PREREGISTRATION-tibetan-lite-vs-yigdzin.md",
               "verdicts": ["lite-right", "yigdzin-right", "both-wrong", "both-right", "image-unreadable"],
               "instructions": "Judge each read against the IMAGE only. Fill `verdict` (one of the five) and optionally `note`. Do not use a model.",
               "pages": arb}, open(f"{R}/arbitration-40.json", "w"), ensure_ascii=False, indent=1)
    e = html.escape
    cards = "".join(
        f"<section><h2>{a['n']}. {e(a['title'] or '')} — p.{a['page']} <small>agreement {a['agreement']} · {a['provider']} · "
        f"<a href='https://sourcelibrary.org/book/{a['book']}?page={a['page']}'>reader</a></small></h2>"
        f"<a href='{e(a['image'])}'><img loading=lazy src='{e(a['image'])}'></a><div class=cols><div><h3>Gemini 3.1 flash-lite ({a['lite_syl']} syl)</h3>"
        f"<pre>{e(a['lite'])}</pre></div><div><h3>Yigdzin per-leaf ({a['yig_syl']} syl)</h3><pre>{e(a['yig'])}</pre></div></div>"
        f"<p class=v>verdict: lite-right / yigdzin-right / both-wrong / both-right / image-unreadable</p></section>" for a in arb)
    open(f"{R}/arbitration-40.html", "w").write(
        "<!doctype html><meta charset=utf-8><title>#4523 lite vs Yigdzin: 40 pages for by-eye arbitration</title>"
        "<style>body{font-family:sans-serif;margin:1rem}section{border-top:2px solid #444;padding:.5rem 0 1.5rem}img{max-width:100%;border:1px solid #ccc}"
        ".cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem}pre{white-space:pre-wrap;font-size:1.15rem;background:#f6f6f6;padding:.5rem}.v{color:#555}</style>"
        "<h1>Gemini-lite vs Yigdzin: 40 disagreement pages (#4523)</h1><p>Protocol: scripts/eval/PREREGISTRATION-tibetan-lite-vs-yigdzin.md. "
        "Judge each read against the image; record the verdict in arbitration-40.json. Unjudged: no model has looked at these.</p>" + cards)
    json.dump(summary, open(f"{R}/summary.json", "w"), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
