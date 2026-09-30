#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-preprocessing/build-results.py (round 1) — loaded as a module for load_texts() and
# rewrite_store() and its RUNS engine records, so round-2 store rows have the same shapes; this only maps the
# round-2 score files (tibetan-score-r2.py, syriac-score.py per-set) onto them.
"""Assemble the #5250 ROUND-2 results.

usage: build-results-r2.py <land_dir>
  <land_dir>: tibetan-scores.json, tibetan-scores-rows.json, tibetan-texts.jsonl.gz, syriac-scores.json, syriac-texts.jsonl.gz
Writes (repo-relative):
  scripts/eval/results/ocr-preprocessing-2026-09-29-r2.json          summary + rows (read by benchmark-dashboard-data.mjs)
  scripts/eval/store/outputs/<engine>/2026-09.jsonl                   one row per (page, arm) read (appended)
  scripts/eval/store/scores/ocr-preproc-5250@1/2026-09.jsonl           one row per (page, arm) score (appended)
Idempotent on the round-2 run_ids.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("br1", os.path.join(HERE, "build-results.py"))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)

AT = "2026-09-29"
RUN_T = "5250r2-tibetan-yigdzin-2026-09-29"
RUN_S = "5250r2-syriac-kraken-2026-09-29"
TEXTS = "scripts/eval/results/ocr-preprocessing-2026-09-29-r2"


def main():
    land = sys.argv[1]
    res = {"issue": 5250, "round": 2, "at": AT,
           "design": "https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5250 (Round 2 — pre-registered 2026-09-29)",
           "decision_rule": "counts iff |paired median delta| > p90 |delta| over the A/A pages AND two-sided sign test p < 0.05",
           "strata": {}}
    outputs, scores = {}, []

    # ── Tibetan: every arm vs leafcrop ──
    ts = json.load(open(f"{land}/tibetan-scores.json"))
    rows = json.load(open(f"{land}/tibetan-scores-rows.json"))["rows"]
    texts = B.load_texts(f"{land}/tibetan-texts.jsonl.gz")
    R = dict(B.RUNS["tibetan"], run_id=RUN_T)
    tables = {m: {"noise_floor": {"leaf": t["noise_floor"]}, "paired": t["paired"]} for m, t in ts["tables"].items()}
    res["strata"]["tibetan-dbu-can"] = {
        "run_id": RUN_T, "engine": R["engine"], "measure": "accuracy",
        "reference": "Derge Kangyur e-text (OpenPecha P000001), locus fixed at round-1 draw time, window +/-2 pages",
        "sample": {"referenced_books": 100, "controls": 18}, "canonical": True, "grade": "decision-grade (canonical-dependent)",
        "baseline": "leafcrop (production per-leaf crop)", "tables": tables, "control_at_14": ts["control"],
        "merge": ts["merge"], "reproduces_round1": ts["reproduces_round1"],
        "skipped_arms": {"leaf-lines": "line-segmenter gate failed (BDRC PhotiLines matched the book's line mode on "
                                       "2/17 pages before the check was stopped; >= 95/100 unreachable)"},
        "rows": rows}
    if os.path.exists(f"{land}/tibetan-scores-always.json"):  # POST HOC, labelled as such; never a pre-registered cell
        pa = json.load(open(f"{land}/tibetan-scores-always.json"))
        res["strata"]["tibetan-dbu-can"]["post_hoc_merge_always"] = {
            "note": "NOT pre-registered. Drops band n+1's first line unconditionally (the geometry puts one shared line "
                    "there). The lower band's copy of the overlap line is read with its above-line vowel signs clipped "
                    "at the cut (identity 0.55-0.74 vs the upper copy), so the pre-registered 0.8 rule keeps it as a "
                    "duplicate. With it removed, both band arms are null on identity and matched syllables.",
            "tables": {m: {k: {kk: c[kk] for kk in ("n", "wins", "losses", "ties", "median_delta", "ci95", "sign_p", "counts")}
                           for k, c in t["paired"].items() if "band" in k} for m, t in pa["tables"].items()},
            "merge": {k: v for k, v in pa["merge"].items() if "band" in k}}
    for r in rows:
        t = texts.get((r["arm"], r["stem"]))
        slug = f"tib-{r['stem']}"
        outputs.setdefault(R["engine"], []).append({
            "run_id": RUN_T, "slug": slug, "arm": r["arm"], "engine": R["engine"], "model": R["model"],
            "engine_version": R["engine_version"], "prompt_id": R["prompt_id"], "prompt_hash": None, "params": R["params"],
            "at": AT, "by": "ocr-preproc-5250-r2", "issue": 5250, "finish_reason": None, "cost_usd": 0, "latency_ms": None,
            "chars": len(t["text"]) if t else 0,
            "outcome": "merge_failed" if r["merge_failed"] else ("loop" if r["loop"] else ("text" if r["syl"] else "empty")),
            "text_path": f"{TEXTS}/tibetan-texts.jsonl.gz#{r['arm']}/{r['stem']}",
            "text_hash": t["text_hash"] if t else None, "substratum": r["substratum"], "host": R["host"]})
        metric = {k: r.get(k) for k in ("identity", "matched", "syl", "lines", "mode", "loop", "line_dup", "merge_dropped", "merge_failed")}
        scores.append({"slug": slug, "arm": r["arm"], "measure": "accuracy" if r["substratum"] == "referenced" else "structure",
                       "against": {"reference_id": f"derge:{r['stem']}" if r["substratum"] == "referenced" else None},
                       "scorer": "ocr-preproc-5250@1", "scorer_version": 1, "normaliser_version": "kanjur_align.syllables",
                       "at": AT, "engine": R["engine"], "run_id": RUN_T, "outcome": "text", "metric": metric,
                       "abstain": False, "substratum": r["substratum"]})

    # ── Syriac: pre-registered strata, one per manuscript ──
    ss = json.load(open(f"{land}/syriac-scores.json"))
    stexts = B.load_texts(f"{land}/syriac-texts.jsonl.gz")
    R = dict(B.RUNS["syriac"], run_id=RUN_S)
    names = {"jerusalem36": ("syriac-estrangela-dark", "Jerusalem SMMJ 36, dark two-page spreads"),
             "onb-syr1": ("syriac-estrangela-clean", "ONB Cod. Syr. 1, clean single leaves")}
    for st, v in ss["by_set"].items():
        sid, desc = names[st]
        res["strata"][sid] = {
            "run_id": RUN_S, "engine": R["engine"], "measure": "accuracy", "manuscript": desc,
            "reference": "published PAGE-XML transcriptions (HTR Winter School 2024/25, CC BY 4.0)",
            "origin": "external", "sample": {"pages": 20, "manuscripts": 1}, "grade": "exploratory",
            "metric": ss["metric"], "baseline_median": v["baseline_median"], "noise_floor": v["noise_floor"],
            "paired": v["paired"]}
    res["syriac_rows"] = ss["rows"]
    for r in ss["rows"]:
        t = stexts.get((r["arm"], r["slug"]))
        outputs.setdefault(R["engine"], []).append({
            "run_id": RUN_S, "slug": r["slug"], "arm": r["arm"], "engine": R["engine"], "model": R["model"],
            "engine_version": R["engine_version"], "prompt_id": None, "prompt_hash": None, "params": R["params"],
            "at": AT, "by": "ocr-preproc-5250-r2", "issue": 5250, "finish_reason": None, "cost_usd": 0, "latency_ms": None,
            "chars": r["chars"], "outcome": "text" if r["chars"] else "empty",
            "text_path": f"{TEXTS}/syriac-texts.jsonl.gz#{r['arm']}/{r['slug']}",
            "text_hash": t["text_hash"] if t else None, "host": R["host"], "origin": "external"})
        scores.append({"slug": r["slug"], "arm": r["arm"], "measure": "accuracy", "against": {"reference_id": f"page-xml:{r['slug']}"},
                       "scorer": "ocr-preproc-5250@1", "scorer_version": 1, "normaliser_version": "score-syriac-retest n2",
                       "at": AT, "engine": R["engine"], "run_id": RUN_S, "outcome": "text",
                       "metric": {k: r[k] for k in ("line_cer_n2", "line_cer_n1", "dice_n2", "loop")}, "abstain": False})

    json.dump(res, open(f"{B.EV}/results/ocr-preprocessing-2026-09-29-r2.json", "w"), ensure_ascii=False, indent=1)
    for eng, rows_ in outputs.items():
        B.rewrite_store(f"{B.EV}/store/outputs/{eng}/2026-09.jsonl", {RUN_T, RUN_S}, rows_)
    B.rewrite_store(f"{B.EV}/store/scores/ocr-preproc-5250@1/2026-09.jsonl", {RUN_T, RUN_S}, scores)
    print(json.dumps({"strata": list(res["strata"]), "outputs": {k: len(v) for k, v in outputs.items()}, "scores": len(scores)}))


if __name__ == "__main__":
    main()
