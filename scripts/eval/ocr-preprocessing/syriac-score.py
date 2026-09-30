#!/usr/bin/env python3
# PRIOR ART: scripts/eval/benchmark/syriac-retest/score-syriac-retest.py — its n1/n2 normalisers and order-free
# line_cer() are the metric of the 2026-09-16 Sophro result (0.188). Loaded from that file (its definitions only,
# up to engines_of) so the #5250 numbers are on the same instrument; this adds the per-arm pairing.
"""Score the #5250 Syriac arms (Hetzner). measure = accuracy (published PAGE-XML transcription of the same leaf).
Primary metric: order-free line CER under N2 (points stripped), lower is better. Also N1 line CER, bag-of-words
Dice (N2) and the loop score. Writes /root/pp5250/syriac/scores.json and prints the paired table."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paired as P  # noqa: E402

R = os.environ.get("GT", "/root/ocr-bench/syriac-retest")  # gt-manifest.json + gt-text/
S = os.environ.get("S", "/root/pp5250/syriac")
src = open(os.environ.get("SCORER", "/root/sourcelibrary/scripts/eval/benchmark/syriac-retest/score-syriac-retest.py")).read()
ns = {}
exec(src[:src.index("def engines_of")], ns)
n1, n2, line_cer, dice, loop_score = ns["n1"], ns["n2"], ns["line_cer"], ns["dice"], ns["loop_score"]

ARMS = os.environ.get("ARMS", "none none-repeat otsu sauvola clahe deskew upscale2x gutter pagecrop").split()
# Round 2 (#5250): the two manuscripts are PRE-REGISTERED strata (jerusalem36 = dark spreads, onb-syr1 = clean
# leaves); every arm is also tabled per set, with the floor computed per set.


def read(p):
    return open(p, encoding="utf-8").read() if os.path.exists(p) else None


def hyp(arm, slug):
    if arm in ("gutter", "pagecrop"):
        parts = [read(f"{S}/out/{arm}.{h}/{slug}.txt") for h in ("R", "L")]
        if arm == "gutter" and not os.path.exists(f"{S}/img/gutter/{slug}.R.jpg"):
            return read(f"{S}/out/none/{slug}.txt")  # no gutter found: the lane reads the page whole
        if parts[0] is None:
            return None
        if arm == "pagecrop" and os.path.exists(f"{S}/img/pagecrop/{slug}.L.jpg") and parts[1] is None:
            return None
        return "\n".join(p for p in parts if p)
    return read(f"{S}/out/{arm}/{slug}.txt")


def main():
    manifest = json.load(open(f"{R}/gt-manifest.json"))
    rows = []
    for m in manifest:
        slug = m["slug"]
        ref = read(f"{R}/gt-text/{slug}.txt")
        for arm in ARMS:
            h = hyp(arm, slug)
            if h is None:
                continue
            rows.append({"slug": slug, "set": m["set"], "arm": arm, "chars": len(h),
                         "line_cer_n2": line_cer(h, ref, n2), "line_cer_n1": line_cer(h, ref, n1),
                         "dice_n2": round(dice(n2(h), n2(ref)), 4), "loop": round(loop_score(n2(h)), 4)})
    def tables(rs):
        by = {}
        for r in rs:
            by.setdefault(r["arm"], {})[r["slug"]] = r["line_cer_n2"]
        floor = P.noise_floor(by.get("none", {}), by.get("none-repeat", {}))
        table = {}
        for arm in ARMS:
            if arm in ("none", "none-repeat") or arm not in by:
                continue
            c = P.paired(by["none"], by[arm], higher_is_better=False)
            c["counts"] = P.counts(c, floor)
            c["arm_median"] = round(sorted(by[arm].values())[len(by[arm]) // 2], 4)
            table[arm] = c
        return by, floor, table

    by, floor, table = tables(rows)
    by_set = {}
    for st in sorted({r["set"] for r in rows}):
        b, f, t = tables([r for r in rows if r["set"] == st])
        by_set[st] = {"baseline_median": round(sorted(b["none"].values())[len(b["none"]) // 2], 4) if b.get("none") else None,
                      "noise_floor": f, "paired": t}
    out = {"stratum": "syriac-estrangela", "measure": "accuracy", "metric": "line_cer_n2 (order-free, lower is better)",
           "baseline": "none", "baseline_median": round(sorted(by["none"].values())[len(by["none"]) // 2], 4) if by.get("none") else None,
           "noise_floor": floor, "paired": table, "by_set": by_set, "rows": rows}
    json.dump(out, open(f"{S}/scores.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ("baseline_median", "noise_floor")}))
    for arm, c in table.items():
        print(f"{arm:10s} n={c['n']:3d} W-L-T {c['wins']}-{c['losses']}-{c['ties']}  medΔ(gain)={c['median_delta']}  "
              f"CI={c['ci95']}  p={c['sign_p']}  arm_med={c['arm_median']}  counts={c['counts']}")
    for st, v in by_set.items():
        print(f"-- {st}  baseline_median={v['baseline_median']}  floor={v['noise_floor']}")
        for arm, c in v["paired"].items():
            print(f"   {arm:10s} n={c['n']:3d} W-L-T {c['wins']}-{c['losses']}-{c['ties']}  medΔ(gain)={c['median_delta']}  "
                  f"CI={c['ci95']}  p={c['sign_p']}  arm_med={c['arm_median']}  counts={c['counts']}")


if __name__ == "__main__":
    main()
