#!/usr/bin/env python3
# PRIOR ART: scripts/eval/nalanda-readiness/summ_redraw.py (PR #5449) computes the "lines < book median" proxy on a
# 100-page draw; /root/tibetan-reocr/leaf_finalize.py + leaf_v4.py judge leaf reads. Neither asks WHERE served lines are
# lost (leaf cut vs whole-page read) over the whole corpus, which is what the 2026-10-01 leaf-cut handoff needed first.
"""Does the per-leaf crop drop the lower leaf's first line? A whole-corpus audit of the #4722 leaf run (#4523).

Runs on Hetzner over /root/tibetan-reocr (no GPU, no model, no writes except the --flagged-out list):
  python3 audit.py [--flagged-out FILE] > summary.json

Sections of the output:
  leaf_position   on pages short vs their book median, WHICH leaf is short (a cut that drops the lower leaf's first
                  line would make the lower leaf short far more often than the upper one)
  leaf_count      pages whose detected leaf count is below / at / above the book's mode
  rejected_leaf   leaf reads acceptance v4 refused, and whether they had MORE lines than the served whole-page read
  missing_lines   for fewer-syllables rejects: where the whole-page lines absent from the leaf read sit
  served          which read each served page carries, and the proxy's short share per group
  gain            syllable gain of accepted leaf reads over the whole-page read, by leaf-run scope
"""
import argparse, collections, difflib, json, os, random, statistics as st, sys

D = "/root/tibetan-reocr"
sys.path.insert(0, D); sys.path.insert(0, "/root/tibetan-eval")
import leaf_finalize as F  # noqa: E402


def load():
    led = {}
    for l in open(f"{D}/leaf-run-logs/pages.jsonl"):
        r = json.loads(l); led[r["id"]] = r          # later rows supersede earlier ones
    prov = {}
    for l in open(f"{D}/txt-yigdzin-leaf/_provenance.jsonl"):
        r = json.loads(l); prov["%s_%05d" % (r["book"], r["page"])] = r
    return led, prov


def old_text(stem):
    p = f"{D}/txt-yigdzin-preleaf/{stem}.txt"   # v3/v4 copied accepted leaf reads over txt-yigdzin; the original is here
    return F.rd(p if os.path.exists(p) else f"{D}/txt-yigdzin/{stem}.txt")


def leaf_position(led):
    by = collections.defaultdict(list)
    for r in led.values(): by[r["id"].rsplit("_", 1)[0]].append(r)
    which = collections.Counter(); tot = short = 0
    for rs in by.values():
        for k in {len(r.get("leaf", [])) for r in rs}:
            grp = [r for r in rs if len(r.get("leaf", [])) == k]
            if k < 2 or len(grp) < 5: continue
            med = st.median(r["lines"] for r in grp)
            pm = [st.median(r["leaf"][i]["lines"] for r in grp) for i in range(k)]
            for r in grp:
                tot += 1
                if r["lines"] < med:
                    short += 1
                    which[f"{k}-leaf:{','.join(str(i) for i in range(k) if r['leaf'][i]['lines'] < pm[i]) or 'none'}"] += 1
    return {"pages": tot, "short": short, "short_leaves": dict(which.most_common(12))}


def leaf_count(led):
    by = collections.defaultdict(list)
    for r in led.values(): by[r["id"].rsplit("_", 1)[0]].append(r)
    out = collections.defaultdict(lambda: {"n": 0, "short": 0, "deficit": []})
    for rs in by.values():
        if len(rs) < 10: continue
        mode = collections.Counter(len(r.get("leaf", [])) for r in rs).most_common(1)[0][0]
        medl = st.median(r["lines"] for r in rs if len(r.get("leaf", [])) == mode)
        for r in rs:
            k = len(r.get("leaf", [])); c = "at-mode" if k == mode else ("above-mode" if k > mode else "below-mode")
            out[c]["n"] += 1; out[c]["short"] += r["lines"] < medl; out[c]["deficit"].append(medl - r["lines"])
    return {c: {"n": v["n"], "short": v["short"], "mean_line_deficit": round(st.mean(v["deficit"]), 2)} for c, v in out.items()}


def rejected_leaf(prov):
    c = collections.Counter()
    for stem, r in prov.items():
        if r.get("accepted"): c["accepted"] += 1; continue
        why = r.get("reject_reason") or "?"; c[f"rejected:{why}"] += 1
        if why in ("loop", "duplication"):
            new, old = F.rd(f"{D}/txt-yigdzin-leaf/{stem}.txt"), old_text(stem)
            more = F.norm_lines(new) > F.norm_lines(old)
            tag = "old-read-also-loops" if why == "loop" and F.hard_loop(old) else "leaf-read-only"
            c[f"{why}:{tag}:{'leaf-has-more-lines' if more else 'not-more'}"] += 1
    return dict(c.most_common())


def missing_lines(led, prov, n=3000):
    rows = sorted(s for s, r in prov.items() if r.get("reject_reason") == "fewer-syllables")
    random.seed(4523); sample = random.sample(rows, min(n, len(rows)))
    def lines(t): return [l for l in t.split("\n") if len(F.syls(l)) >= 4]
    def found(line, text):
        m = difflib.SequenceMatcher(None, line, text, autojunk=False)
        return sum(b.size for b in m.get_matching_blocks()) / max(1, len(line)) >= 0.6
    dl = collections.Counter(); pos = collections.Counter(); pages = 0
    for stem in sample:
        g = led.get(stem)
        if not g or len(g.get("leaf", [])) < 2: continue
        new, old = F.rd(f"{D}/txt-yigdzin-leaf/{stem}.txt"), old_text(stem)
        ol, nl = lines(old), lines(new); pages += 1; d = len(nl) - len(ol); dl[max(-3, min(3, d))] += 1
        if d >= 0: continue
        bounds, acc = [], 0
        for lf in g["leaf"][:-1]: acc += lf["lines"]; bounds.append(acc)
        tot = sum(lf["lines"] for lf in g["leaf"])
        for i, l in enumerate(ol):
            if found(l, new): continue
            near = min(abs(i / max(1, len(ol) - 1) * tot - b) for b in bounds)
            pos["first" if i == 0 else "last" if i == len(ol) - 1 else ("within-1-line-of-a-cut" if near <= 1.0 else "interior")] += 1
    return {"sampled_pages": pages, "line_delta_leaf_minus_whole": {str(k): v for k, v in sorted(dl.items())},
            "missing_whole_page_lines_by_position": dict(pos.most_common())}


def served(led, prov, flagged_out=None):
    lines = {}
    for f in os.listdir(f"{D}/txt-yigdzin"):
        if f.endswith(".txt"):
            t = open(f"{D}/txt-yigdzin/{f}", encoding="utf-8", errors="replace").read()
            lines[f[:-4]] = sum(1 for x in t.split("\n") if x.strip())
    by = collections.defaultdict(list)
    for s, k in lines.items(): by[s.rsplit("_", 1)[0]].append((s, k))
    c = collections.defaultdict(collections.Counter); flagged = []
    for rs in by.values():
        if len(rs) < 10: continue
        med = st.median(k for _, k in rs)
        for s, k in rs:
            g = ("serves-leaf" if prov[s].get("accepted") else "serves-whole:leaf-rejected") if s in prov else \
                ("leaf-read-no-verdict" if s in led else "serves-whole:never-leaf-read")
            c[g]["n"] += 1; c[g]["short"] += k < med; c[g]["short_by_2+"] += k <= med - 2
            if g == "serves-whole:never-leaf-read" and k < med: flagged.append({"id": s, "lines": k, "book_median": med})
    if flagged_out:
        with open(flagged_out, "w") as f:
            for r in flagged: f.write(json.dumps(r) + "\n")
    n = sum(v["n"] for v in c.values()); sh = sum(v["short"] for v in c.values())
    return {"served_pages_in_books_of_10+": n, "short_vs_book_median": sh, "short_share": round(sh / n, 4),
            "by_read": {g: dict(v) for g, v in c.items()}}


def gain(prov):
    g = collections.defaultdict(list)
    for r in prov.values():
        if r.get("accepted") and r.get("old_syl") is not None and r.get("new_syl") is not None:
            g[r.get("scope")].append((r["new_syl"] - r["old_syl"]) / max(1, r["old_syl"]))
    out = {}
    for sc, v in g.items():
        v.sort(); n = len(v)
        out[sc] = {"n": n, "median_rel_syllable_gain": round(st.median(v), 3), "p25": round(v[n // 4], 3),
                   "p75": round(v[3 * n // 4], 3), "gain_10pct+": sum(x >= 0.10 for x in v)}
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--flagged-out"); a = ap.parse_args()
    led, prov = load()
    print(json.dumps({"leaf_position": leaf_position(led), "leaf_count": leaf_count(led), "rejected_leaf": rejected_leaf(prov),
                      "missing_lines": missing_lines(led, prov), "served": served(led, prov, a.flagged_out), "gain": gain(prov)},
                     indent=1, ensure_ascii=False))
