#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-preprocessing/tibetan-score.py (round 1) — loaded as a module; its instruments (Derge
# window identity via kanjur_align, matched syllables, lines, hard loop, line duplicate, book mode) and paired.py are
# used unchanged. Round 2 adds only the pre-registered band MERGE rule and the round-2 arm list.
"""Score the #5250 ROUND-2 Tibetan arms (Hetzner). Texts: /root/pp5250/r2/tibetan/out/txt/<arm>/<stem>.{txt,parts.json}.

Merge rule (pre-registered on #5250, 2026-09-29): bands are read in order; when concatenating, the first line of
band n+1 is dropped if its syllable string matches the last line of band n at identity >= 0.8 (difflib ratio over
syllable lists). Bands are merged within a leaf only (the overlap exists only there); leaves are joined top to bottom
as in production. A merge failure — no band geometry (the job has no files) or any band read empty — is scored as a
LOSS (identity 0, matched 0, lines 0), never an abstention.

Every arm is paired against `leafcrop` on the same pages; the floor is leafcrop vs leafcrop-repeat (p90 |Δ|).
Also reports: the 18 controls at 14 lines per arm (must stay 18/18), how often the merge rule fired, and whether the
round-2 leafcrop control reproduces the round-1 leafcrop reads.
Writes /root/pp5250/r2/tibetan/{scores.json,scores-rows.json} and prints the tables.
"""
import importlib.util
import json
import os
import pickle
import sys
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("tscore", os.path.join(HERE, "tibetan-score.py"))
S1 = importlib.util.module_from_spec(spec); spec.loader.exec_module(S1)
ka, P = S1.ka, S1.P

R1 = "/root/pp5250/tibetan"
W = "/root/pp5250/r2/tibetan"
ARMS = ["leafcrop", "leafcrop-repeat", "leaf-2band", "leaf-3band", "leaf-lines",
        "leaf+unsharp", "leaf+gamma08", "leaf+gamma12", "leaf+flatten", "leaf+gray", "leaf+denoise"]
MERGE_ID = 0.8
# POST HOC (not pre-registered; added after the round-2 reads were scored): MERGE=always drops band n+1's first line
# unconditionally (the band geometry puts exactly one shared line there). Diagnoses whether the band arms' matched-
# syllable gain survives once the overlap duplicate is gone: the lower band's copy of that line is read with its
# above-line vowel signs clipped at the cut, so it scores 0.55-0.74 against the upper copy and the 0.8 rule keeps it.
MERGE_MODE = os.environ.get("MERGE", "rule")
OUT_SUFFIX = "" if MERGE_MODE == "rule" else f"-{MERGE_MODE}"


def merge(parts, groups):
    """-> (text, n_dropped) or (None, 0) on a merge failure."""
    if not groups or any(not parts[i].strip() for g in groups for i in g):
        return None, 0
    leaves, dropped = [], 0
    for g in groups:
        lines = []
        for k, i in enumerate(g):
            bl = [l for l in parts[i].split("\n") if l.strip()]
            if k > 0 and lines and bl:
                if MERGE_MODE == "always" or SequenceMatcher(None, S1.syls(lines[-1]), S1.syls(bl[0]), autojunk=False).ratio() >= MERGE_ID:
                    bl = bl[1:]; dropped += 1
            lines += bl
        leaves.append("\n".join(lines))
    return "\n".join(x for x in leaves if x.strip()), dropped


def main():
    idx = pickle.load(open("/root/tibetan-eval/etext-index-full.pkl", "rb"))
    ref = {f"{r['book']}_{int(r['page']):05d}": r for r in map(json.loads, open(f"{R1}/referenced.jsonl"))}
    ctrl = {f"{r['book']}_{int(r['page']):05d}": r for r in map(json.loads, open("/root/tibetan-reocr/_tmp-reread-control18.jsonl"))}
    man = {(m["arm"], m["stem"]): m for m in map(json.loads, open(f"{W}/manifest.jsonl"))}
    rows = []
    for sub, pages in (("referenced", ref), ("control", ctrl)):
        for stem, r in pages.items():
            mode = 14 if sub == "control" else r["mode"]
            wsyl = ka.window_syllables(idx, r["vol"], r["imgnum"], 2) if sub == "referenced" else None
            for arm in ARMS:
                m = man.get((arm, stem))
                if m is None:
                    continue
                base = f"{W}/out/txt/{arm}/{stem}"
                if not os.path.exists(base + ".txt"):
                    continue  # not read (a job that never ran is missing, not a loss)
                dropped, failed = 0, False
                if len(m["files"]) != len(m["groups"]) or any(len(g) > 1 for g in m["groups"]) or not m["files"]:
                    parts = json.load(open(base + ".parts.json")) if os.path.exists(base + ".parts.json") else []
                    t, dropped = merge(parts, m["groups"]) if parts else (None, 0)
                    failed = t is None
                    t = t or ""
                else:
                    t = open(base + ".txt", encoding="utf-8").read()
                s = ka.syllables(t)
                row = {"stem": stem, "book": r["book"], "substratum": sub, "arm": arm, "syl": len(s), "lines": S1.nlines(t),
                       "mode": mode, "loop": S1.hard_loop(t), "line_dup": S1.line_dup(t), "merge_dropped": dropped,
                       "merge_failed": failed, "n_files": len(m["files"])}
                if sub == "referenced":
                    ident = ka.nw_identity(s, wsyl) if s else 0.0
                    row.update(identity=round(ident, 4), matched=round(ident * len(s)))
                rows.append(row)
    json.dump({"rows": rows}, open(f"{W}/scores-rows{OUT_SUFFIX}.json", "w"))
    summarise(rows)


def summarise(rows):
    def col(sub, arm, key):
        return {r["stem"]: float(r[key]) for r in rows if r["substratum"] == sub and r["arm"] == arm and r.get(key) is not None}

    out = {"stratum": "tibetan-dbu-can", "round": 2, "merge_mode": MERGE_MODE, "engine": "BDRC/tibetan-ocr (Yigdzin-v1) @ 50506eb6",
           "baseline": "leafcrop", "tables": {}}
    for metric in ("identity", "matched", "lines"):
        floor = P.noise_floor(col("referenced", "leafcrop", metric), col("referenced", "leafcrop-repeat", metric))
        t = {"noise_floor": floor, "paired": {}}
        for arm in ARMS[2:]:
            a = col("referenced", arm, metric)
            if not a:
                continue
            c = P.paired(col("referenced", "leafcrop", metric), a, higher_is_better=True)
            c["baseline"] = "leafcrop"; c["counts"] = P.counts(c, floor)
            t["paired"][arm] = c
        out["tables"][metric] = t
    out["control"] = {arm: {"n": len(rs), "at_14": sum(1 for r in rs if r["lines"] >= 14)}
                      for arm in ARMS if (rs := [r for r in rows if r["substratum"] == "control" and r["arm"] == arm])}
    out["merge"] = {arm: {"pages": len(rs), "failed": sum(r["merge_failed"] for r in rs),
                          "pages_with_drop": sum(1 for r in rs if r["merge_dropped"]),
                          "drops": sum(r["merge_dropped"] for r in rs),
                          "line_dup_pages": sum(1 for r in rs if r["line_dup"]), "loops": sum(1 for r in rs if r["loop"])}
                    for arm in ARMS if (rs := [r for r in rows if r["arm"] == arm])}
    # does the round-2 control reproduce round 1? (same images, same engine, fresh read)
    same = n = 0
    for r in rows:
        if r["arm"] != "leafcrop":
            continue
        p1, p2 = f"{R1}/out/txt/leafcrop/{r['stem']}.txt", f"{W}/out/txt/leafcrop/{r['stem']}.txt"
        if os.path.exists(p1):
            n += 1; same += open(p1, encoding="utf-8").read() == open(p2, encoding="utf-8").read()
    r1 = {rr["stem"]: rr for rr in json.load(open(f"{R1}/scores-rows.json"))["rows"] if rr["arm"] == "leafcrop" and rr["substratum"] == "referenced"}
    r2 = col("referenced", "leafcrop", "identity")
    out["reproduces_round1"] = {"pages": n, "byte_identical": same,
                                "paired_identity_vs_r1": P.paired({k: v["identity"] for k, v in r1.items()}, r2)}
    json.dump(out, open(f"{W}/scores{OUT_SUFFIX}.json", "w"), indent=1)
    for metric, t in out["tables"].items():
        print(f"== {metric}  floor={t['noise_floor']}")
        for arm, c in t["paired"].items():
            print(f"  {arm:13s} n={c['n']:3d} W-L-T {c['wins']}-{c['losses']}-{c['ties']} medΔ={c['median_delta']} "
                  f"CI={c['ci95']} p={c['sign_p']} counts={c['counts']}")
    print("control at 14:", json.dumps(out["control"]))
    print("merge:", json.dumps(out["merge"]))
    print("reproduces r1:", json.dumps(out["reproduces_round1"]))


if __name__ == "__main__":
    main()
