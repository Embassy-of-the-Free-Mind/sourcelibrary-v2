#!/usr/bin/env python3
# PRIOR ART: scripts/eval/en-ocr-reference-5124.mjs (store row shapes, lines ~864-915) — this writes the same
# store/outputs + store/scores shapes for the #5250 arms, from the per-stratum score files the scorers produced.
"""Assemble the #5250 results from the per-stratum scorer outputs.

usage: build-results.py <land_dir>
  <land_dir> holds: tibetan scores.json, scores-rows.json, referenced.jsonl, mark.jsonl, tibetan-texts.jsonl.gz,
                    syriac-scores.json, syriac-by-set.json, syriac-texts.jsonl.gz, [gemini-*.json]
Writes (repo-relative):
  scripts/eval/results/ocr-preprocessing-2026-09-29.json            summary tables + one row per page x arm
  scripts/eval/store/outputs/<engine>/2026-09.jsonl                  one row per (page, arm) read (appended)
  scripts/eval/store/scores/ocr-preproc-5250@1/2026-09.jsonl          one row per (page, arm) score (appended)
Idempotent: rows for these run_ids are removed from the store files before being re-appended.
"""
import gzip
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
EV = os.path.join(REPO, "scripts", "eval")
AT = "2026-09-29"
RUNS = {
    "tibetan": {"run_id": "5250-tibetan-yigdzin-2026-09-29", "engine": "bdrc-yigdzin-v1", "model": "BDRC/tibetan-ocr",
                "engine_version": "50506eb6d8ed8738df86b448f6f6cdc688de29ea", "prompt_id": "yigdzin-extract-v1",
                "params": {"thinking": None, "temperature": 0, "max_tokens": 4096, "batch": True, "context_given": None,
                           "retry": "T=0.4 n=2 on repetition; min_tokens=300 re-decode under 40 syllables",
                           "dry": {"dry_multiplier": 0.8, "dry_base": 1.75, "dry_allowed_length": 12}},
                "host": "scaleway sl-mitra-1 L4, vLLM 0.29.0 + vllm-paddleocr-seqpos"},
    "syriac": {"run_id": "5250-syriac-kraken-2026-09-29", "engine": "kraken-sophro-mhiro", "model": "sophro-mhiro.mlmodel",
               "engine_version": "kraken 7.1; model zenodo 17406773 md5 bd9f13a9067b971e5cab9c2fe3354ca3",
               "prompt_id": None,
               "params": {"thinking": None, "temperature": None, "max_tokens": None, "batch": False, "context_given": None,
                          "segment": "-bl -d horizontal-rl (default segmenter)", "ocr": "--base-dir R", "device": "cuda:0 (L4)"},
               "host": "scaleway sl-mitra-1 L4"},
}


def load_texts(path):
    out = {}
    if os.path.exists(path):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for l in f:
                r = json.loads(l)
                out[(r["arm"], r["stem"])] = r
    return out


def rewrite_store(path, run_ids, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    keep = []
    if os.path.exists(path):
        keep = [l for l in open(path) if l.strip() and json.loads(l).get("run_id") not in run_ids]
    with open(path, "w") as f:
        f.writelines(keep)
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main():
    land = sys.argv[1]
    res = {"issue": 5250, "at": AT, "design": "https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5250",
           "decision_rule": "counts iff |paired median delta| > p90 |delta| over the A/A pages AND two-sided sign test p < 0.05",
           "strata": {}}
    outputs, scores = {}, []

    # ── Tibetan ──
    ts = json.load(open(f"{land}/scores.json"))
    rows = json.load(open(f"{land}/scores-rows.json"))["rows"]
    texts = load_texts(f"{land}/tibetan-texts.jsonl.gz")
    R = RUNS["tibetan"]
    res["strata"]["tibetan-dbu-can"] = {
        "run_id": R["run_id"], "engine": R["engine"], "measure": "accuracy",
        "reference": "Derge Kangyur e-text (OpenPecha P000001), locus fixed at draw time, window +/-2 pages",
        "sample": {"referenced_books": 100, "controls": 18, "mark_books": 50}, "canonical": True, "grade": "decision-grade (canonical-dependent)",
        "tables": ts["tables"], "control_at_14": ts["control"], "mark_structural": ts["mark"],
        "mark_by_eye": {"n": 10, "dbu_can_correct_at_line_start": 5, "dbu_med_unverifiable": 5,
                        "note": "read from image, upper leaf first 2-3 lines; structure is not correctness"},
        "rows": rows}
    for r in rows:
        t = texts.get((r["arm"], r["stem"]))
        slug = f"tib-{r['stem']}"
        outputs.setdefault(R["engine"], []).append({
            "run_id": R["run_id"], "slug": slug, "arm": r["arm"], "engine": R["engine"], "model": R["model"],
            "engine_version": R["engine_version"], "prompt_id": R["prompt_id"], "prompt_hash": None, "params": R["params"],
            "at": AT, "by": "ocr-preproc-5250", "issue": 5250, "finish_reason": None, "cost_usd": 0, "latency_ms": None,
            "chars": len(t["text"]) if t else 0, "outcome": "loop" if r["loop"] else ("text" if r["syl"] else "empty"),
            "text_path": f"scripts/eval/results/ocr-preprocessing-2026-09-29/tibetan-texts.jsonl.gz#{r['arm']}/{r['stem']}",
            "text_hash": t["text_hash"] if t else None, "substratum": r["substratum"], "host": R["host"]})
        metric = {k: r.get(k) for k in ("identity", "matched", "syl", "lines", "mode", "at_mode", "loop", "line_dup", "accept", "derge_identity")}
        scores.append({"slug": slug, "arm": r["arm"], "measure": "accuracy" if r["substratum"] == "referenced" else "structure",
                       "against": {"reference_id": f"derge:{r.get('stem')}" if r["substratum"] == "referenced" else None},
                       "scorer": "ocr-preproc-5250@1", "scorer_version": 1, "normaliser_version": "kanjur_align.syllables",
                       "at": AT, "engine": R["engine"], "run_id": R["run_id"], "outcome": "text", "metric": metric,
                       "abstain": False, "substratum": r["substratum"]})

    # ── Syriac ──
    ss = json.load(open(f"{land}/syriac-scores.json"))
    byset = json.load(open(f"{land}/syriac-by-set.json"))
    stexts = load_texts(f"{land}/syriac-texts.jsonl.gz")
    R = RUNS["syriac"]
    res["strata"]["syriac-estrangela"] = {
        "run_id": R["run_id"], "engine": R["engine"], "measure": "accuracy",
        "reference": "published PAGE-XML transcriptions (HTR Winter School 2024/25, Jerusalem SMMJ 36 + ONB Cod. Syr. 1, CC BY 4.0)",
        "origin": "external", "sample": {"pages": 40, "manuscripts": 2}, "grade": "exploratory",
        "metric": ss["metric"], "baseline_median": ss["baseline_median"], "noise_floor": ss["noise_floor"],
        "paired": ss["paired"], "by_manuscript_post_hoc": byset, "rows": ss["rows"]}
    for r in ss["rows"]:
        t = stexts.get((r["arm"], r["slug"]))
        outputs.setdefault(R["engine"], []).append({
            "run_id": R["run_id"], "slug": r["slug"], "arm": r["arm"], "engine": R["engine"], "model": R["model"],
            "engine_version": R["engine_version"], "prompt_id": None, "prompt_hash": None, "params": R["params"],
            "at": AT, "by": "ocr-preproc-5250", "issue": 5250, "finish_reason": None, "cost_usd": 0, "latency_ms": None,
            "chars": r["chars"], "outcome": "text" if r["chars"] else "empty",
            "text_path": f"scripts/eval/results/ocr-preprocessing-2026-09-29/syriac-texts.jsonl.gz#{r['arm']}/{r['slug']}",
            "text_hash": t["text_hash"] if t else None, "host": R["host"], "origin": "external"})
        scores.append({"slug": r["slug"], "arm": r["arm"], "measure": "accuracy", "against": {"reference_id": f"page-xml:{r['slug']}"},
                       "scorer": "ocr-preproc-5250@1", "scorer_version": 1, "normaliser_version": "score-syriac-retest n2",
                       "at": AT, "engine": R["engine"], "run_id": R["run_id"], "outcome": "text",
                       "metric": {k: r[k] for k in ("line_cer_n2", "line_cer_n1", "dice_n2", "loop")}, "abstain": False})

    # ── Gemini strata (optional) ──
    for f in sorted(os.listdir(land)):
        if f.startswith("gemini-") and f.endswith(".json"):
            g = json.load(open(f"{land}/{f}"))
            res["strata"][g["stratum"]] = {k: v for k, v in g.items() if k not in ("store_outputs", "store_scores")}
            for o in g.get("store_outputs", []):
                outputs.setdefault(o["model"], []).append(o)
            scores.extend(g.get("store_scores", []))

    run_ids = {s["run_id"] for s in res["strata"].values() if "run_id" in s}
    json.dump(res, open(f"{EV}/results/ocr-preprocessing-2026-09-29.json", "w"), ensure_ascii=False, indent=1)
    for eng, rows_ in outputs.items():
        rewrite_store(f"{EV}/store/outputs/{eng}/2026-09.jsonl", run_ids, rows_)
    rewrite_store(f"{EV}/store/scores/ocr-preproc-5250@1/2026-09.jsonl", run_ids, scores)
    print(json.dumps({"strata": list(res["strata"]), "outputs": {k: len(v) for k, v in outputs.items()}, "scores": len(scores)}))


if __name__ == "__main__":
    main()
