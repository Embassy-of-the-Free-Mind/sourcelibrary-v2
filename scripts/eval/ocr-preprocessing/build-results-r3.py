#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-preprocessing/build-results-r2.py (round 2) — same store row shapes, loaded from
# build-results.py (load_texts, rewrite_store, RUNS). Round 3 is Syriac only and adds the pre-registered PREDICTION
# per (stratum, arm) and the confirm/deny verdict; nothing else differs, so this maps the round-3 score file onto them.
"""Assemble the #5250 ROUND-3 (Syriac confirmatory) results.

usage: build-results-r3.py <land_dir> [--at YYYY-MM-DD]
  <land_dir>: syriac-scores.json (syriac-score.py with GT=/root/ocr-bench/syriac-r3), syriac-texts.jsonl.gz,
              gt-manifest.json, draw-log.json
Writes (repo-relative):
  scripts/eval/results/ocr-preprocessing-<at>-r3.json                  summary + rows (read by benchmark-dashboard-data.mjs)
  scripts/eval/store/outputs/kraken-sophro-mhiro/<yyyy-mm>.jsonl        one row per (page, arm) read
  scripts/eval/store/scores/ocr-preproc-5250@1/<yyyy-mm>.jsonl          one row per (page, arm) score
Idempotent on the round-3 run_id. Prints the per-stratum confirm/deny table.

Verdict rule (pre-registered on #5250, "Round 3", plus the amendments comment): a cell CONFIRMS iff the sign of its
paired median gain matches the prediction, |median gain| > the stratum's A/A p90 floor, and the sign test p < 0.05.
`flatten` on clean-leaves is judged against round 2's measured direction (helps); the plan's literal text ("hurts")
is shown beside it, per the amendment.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("br1", os.path.join(HERE, "build-results.py"))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)

STRATA = {"jerusalem36": ("syriac-estrangela-dark-fresh", "dark-spreads", "Jerusalem SMMJ 36, dark two-page spreads (40 fresh folios)"),
          "onb-syr1": ("syriac-estrangela-clean-fresh", "clean-leaves", "ONB Cod. Syr. 1, clean single leaves (40 fresh folios)")}
# prediction: +1 helps, -1 hurts, 0 = predicted null / no help, None = no prediction (exploratory cell)
PRED = {("dark-spreads", "unsharp"): +1, ("clean-leaves", "unsharp"): +1,
        ("dark-spreads", "denoise"): +1, ("clean-leaves", "denoise"): 0,
        ("dark-spreads", "flatten"): None, ("clean-leaves", "flatten"): +1,
        ("dark-spreads", "sauvola"): +1}
PRED_NOTE = {("clean-leaves", "flatten"): "plan text says HURTS; round 2 measured HELPS (20-0, -10.6 pp); judged against round 2, "
                                         "see the amendments comment on #5250",
             ("clean-leaves", "denoise"): "plan: 'denoise helps dark only' -> predicted no gain on clean",
             ("dark-spreads", "flatten"): "no prediction (round 2: 8-12, null); exploratory"}


def pack_texts(out_dir, gz_path):
    """out/<arm>/<slug>.txt -> jsonl.gz rows {arm, stem, text, text_hash} (the round-1/2 shape load_texts reads)."""
    import gzip
    import hashlib
    n = 0
    with gzip.open(gz_path, "wt", encoding="utf-8") as f:
        for arm in sorted(os.listdir(out_dir)):
            for fn in sorted(os.listdir(f"{out_dir}/{arm}")):
                if not fn.endswith(".txt"):
                    continue
                text = open(f"{out_dir}/{arm}/{fn}", encoding="utf-8").read()
                f.write(json.dumps({"arm": arm, "stem": fn[:-4], "text": text,
                                    "text_hash": hashlib.sha256(text.encode("utf-8")).hexdigest()}, ensure_ascii=False) + "\n")
                n += 1
    print(f"packed {n} texts -> {gz_path}")


def verdict(c, floor, pred):
    """confirmed / denied / exploratory, with the reason."""
    if pred is None:
        return "exploratory", "no prediction"
    med = c["median_delta"]
    counts = c["counts"]
    if pred == 0:
        return ("confirmed", "predicted null; arm does not count") if not counts else ("denied", f"predicted null; arm counts ({'helps' if med > 0 else 'hurts'})")
    if not counts:
        return "denied", "does not count (median within floor or p >= 0.05)"
    return ("confirmed", "sign matches, counts") if (med > 0) == (pred > 0) else ("denied", "counts with the OPPOSITE sign")


def main():
    land = sys.argv[1]
    at = sys.argv[sys.argv.index("--at") + 1] if "--at" in sys.argv else "2026-09-29"
    run_id = f"5250r3-syriac-kraken-{at}"
    month = at[:7]
    texts_dir = f"scripts/eval/results/ocr-preprocessing-{at}-r3"
    ss = json.load(open(f"{land}/syriac-scores.json"))
    if not os.path.exists(f"{land}/syriac-texts.jsonl.gz") and os.path.isdir(f"{land}/out"):
        pack_texts(f"{land}/out", f"{land}/syriac-texts.jsonl.gz")
    manifest = {m["slug"]: m for m in json.load(open(f"{land}/gt-manifest.json"))}
    draw = json.load(open(f"{land}/draw-log.json"))
    stexts = B.load_texts(f"{land}/syriac-texts.jsonl.gz")
    R = dict(B.RUNS["syriac"], run_id=run_id, host="hetzner (CPU, one worker, nice 10)",
             params=dict(B.RUNS["syriac"]["params"], device="cpu"))
    res = {"issue": 5250, "round": 3, "at": at,
           "design": "https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5250 (Round 3 — Syriac confirmatory, "
                     "pre-registered 2026-09-29, amendments comment 5890832946)",
           "decision_rule": "confirms iff sign matches the prediction AND |paired median delta| > p90 |delta| over the stratum's "
                            "A/A pages AND two-sided sign test p < 0.05",
           "draw": {"seed": draw["seed"], "overlap_with_rounds_1_2": draw["overlap_with_round1"], "edge_skipped": draw["edge_skipped"],
                    "candidates": {k: {"interior": v["interior"], "fresh": v["fresh"], "drawn": v["drawn"]} for k, v in draw["sets"].items()}},
           "strata": {}, "verdicts": []}
    assert res["draw"]["overlap_with_rounds_1_2"] == [], "fresh pages overlap rounds 1-2"
    for st, v in ss["by_set"].items():
        sid, stratum, desc = STRATA[st]
        paired = {}
        for arm, c in v["paired"].items():
            pred = PRED.get((stratum, arm))
            vd, why = verdict(c, v["noise_floor"], pred)
            c = dict(c, prediction={+1: "helps", -1: "hurts", 0: "null"}.get(pred) if pred is not None else None,
                     confirmed=(vd == "confirmed") if vd != "exploratory" else None, verdict=vd, verdict_why=why)
            if (stratum, arm) in PRED_NOTE:
                c["prediction_note"] = PRED_NOTE[(stratum, arm)]
            paired[arm] = c
            res["verdicts"].append({"stratum": stratum, "arm": arm, "prediction": c["prediction"], "verdict": vd, "why": why,
                                    "wins": c["wins"], "losses": c["losses"], "ties": c["ties"], "median_gain": c["median_delta"],
                                    "ci95": c["ci95"], "p": c["sign_p"], "floor_p90": v["noise_floor"]["p90_abs"] if v["noise_floor"] else None})
        res["strata"][sid] = {
            "run_id": run_id, "engine": R["engine"], "measure": "accuracy", "manuscript": desc, "stratum_name": stratum,
            "reference": "published PAGE-XML transcriptions (HTR Winter School 2024/25, CC BY 4.0)",
            "origin": "external", "sample": {"pages": sum(1 for m in manifest.values() if m["set"] == st), "manuscripts": 1,
                                             "fresh": True, "aa_pages": v["noise_floor"]["n"] if v["noise_floor"] else 0},
            "grade": "exploratory", "confirmatory_of": "5250r2-syriac-kraken-2026-09-29",
            "metric": ss["metric"], "baseline_median": v["baseline_median"], "noise_floor": v["noise_floor"], "paired": paired}
    res["syriac_rows"] = ss["rows"]
    outputs, scores = [], []
    for r in ss["rows"]:
        t = stexts.get((r["arm"], r["slug"]))
        outputs.append({
            "run_id": run_id, "slug": r["slug"], "arm": r["arm"], "engine": R["engine"], "model": R["model"],
            "engine_version": R["engine_version"], "prompt_id": None, "prompt_hash": None, "params": R["params"],
            "at": at, "by": "ocr-preproc-5250-r3", "issue": 5250, "finish_reason": None, "cost_usd": 0, "latency_ms": None,
            "chars": r["chars"], "outcome": "text" if r["chars"] else "empty",
            "text_path": f"{texts_dir}/syriac-texts.jsonl.gz#{r['arm']}/{r['slug']}",
            "text_hash": t["text_hash"] if t else None, "host": R["host"], "origin": "external",
            "substratum": manifest[r["slug"]]["stratum"]})
        scores.append({"slug": r["slug"], "arm": r["arm"], "measure": "accuracy", "against": {"reference_id": f"page-xml:{r['slug']}"},
                       "scorer": "ocr-preproc-5250@1", "scorer_version": 1, "normaliser_version": "score-syriac-retest n2",
                       "at": at, "engine": R["engine"], "run_id": run_id, "outcome": "text",
                       "metric": {k: r[k] for k in ("line_cer_n2", "line_cer_n1", "dice_n2", "loop")}, "abstain": False,
                       "substratum": manifest[r["slug"]]["stratum"]})
    json.dump(res, open(f"{B.EV}/results/ocr-preprocessing-{at}-r3.json", "w"), ensure_ascii=False, indent=1)
    B.rewrite_store(f"{B.EV}/store/outputs/{R['engine']}/{month}.jsonl", {run_id}, outputs)
    B.rewrite_store(f"{B.EV}/store/scores/ocr-preproc-5250@1/{month}.jsonl", {run_id}, scores)
    print(json.dumps({"run_id": run_id, "strata": list(res["strata"]), "outputs": len(outputs), "scores": len(scores)}))
    for sid, s in res["strata"].items():
        print(f"-- {s['stratum_name']}  baseline_median={s['baseline_median']}  floor_p90={s['noise_floor']['p90_abs'] if s['noise_floor'] else None}"
              f"  aa_n={s['sample']['aa_pages']}")
        for arm, c in s["paired"].items():
            print(f"   {arm:8s} pred={str(c['prediction']):5s} W-L-T {c['wins']}-{c['losses']}-{c['ties']}  med gain={c['median_delta']}  "
                  f"CI={c['ci95']}  p={c['sign_p']}  arm_med={c['arm_median']}  -> {c['verdict'].upper()} ({c['verdict_why']})")


if __name__ == "__main__":
    main()
