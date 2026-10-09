#!/usr/bin/env python3
# PRIOR ART: scripts/eval/syriac-pareto-6295/import-cli-arm.py (the #6332 safety-filter cut, for that panel's arms/
# layout); ocr-pareto-6293/run-arms.mjs collect step (writes Batch results into the bench for benchmark-score.mjs).
# Neither lays CLI rows into the bench tree with a meter, so this does, with the same cut rule.
"""
import-cli-arm.py — $0, read-only. Lay a Gemini CLI arm (scripts/eval/run-cli-arm.py output, uid "stratum|slug")
into the #6293 bench so benchmark-score.mjs and score-syriac-retest.py score it exactly as the stored arms.

  python3 scripts/eval/ocr-pareto-6293/import-cli-arm.py --bench <bench> --raw <arm>.raw.jsonl \
      --engine gemini-3.8-flash+antigravity-cli [--results scripts/eval/results/ocr-pareto-6293]

Per page (the last row per uid wins):
  <bench>/<stratum>/out/<engine>/<slug>.txt   the text; a safety-filter stub is cut at Gemini's message (and any
                                              half-written tag before it) and the text before it is kept
  <bench>/<stratum>/out/<engine>/_meter.jsonl one row per page: finishReason STOP, SAFETY (a cut stub, so a partial
                                              read, never a refusal: refusals.mjs needs an empty output) or CLI_EMPTY
                                              (no text after the retries: scored as a blank read, NOT inferred to be
                                              a refusal, so it never removes the page from a chart's shared set)
<results>/outputs-<engine>.jsonl and meter-<engine>.jsonl: the same rows, committed, as #6011 wave 2 did.
A page with no row at all is not written (the arm is incomplete there).
"""
import json, os, re, sys

M = "This request was blocked by Gemini's filters"
opt = lambda k, d=None: sys.argv[sys.argv.index(f"--{k}") + 1] if f"--{k}" in sys.argv else d
BENCH, RAW, ENGINE = opt("bench"), opt("raw"), opt("engine")
RES = opt("results", "scripts/eval/results/ocr-pareto-6293")


def strip(t):
    return re.sub(r"<[^>\n]*$", "", t[:t.index(M)].rstrip()).rstrip() if M in t else t


rows = {}
for l in open(RAW, encoding="utf-8"):
    if l.strip():
        r = json.loads(l); rows[r["uid"]] = r
outs, meters, by = [], [], {}
for uid, r in sorted(rows.items()):
    st, slug = uid.split("|", 1)
    raw = r.get("text") or ""
    text = strip(raw)
    fr = "SAFETY" if M in raw else ("STOP" if raw.strip() else "CLI_EMPTY")
    d = os.path.join(BENCH, st, "out", ENGINE)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"{slug}.txt"), "w", encoding="utf-8") as f:
        f.write(text)
    m = {"slug": slug, "engine": ENGINE, "finishReason": fr, "chars": len(text), "route": "cli", "model": r["model"],
         "cli_mode": r.get("cli_mode") or "skip-permissions (before the 2026-10-08 19:20Z fix)", "nudged": bool(r.get("nudged")),
         "attempts": r.get("attempts"), "secs": r.get("secs"), "at": r.get("date"), "error": (r.get("error") or None) and r["error"][-200:]}
    by.setdefault(d, []).append(m)
    meters.append({"stratum": st, **m})
    outs.append({"stratum": st, "slug": slug, "engine": ENGINE, "text": text})
for d, ms in by.items():
    with open(os.path.join(d, "_meter.jsonl"), "w", encoding="utf-8") as f:
        f.write("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in ms))
os.makedirs(RES, exist_ok=True)
for name, xs in (("outputs", outs), ("meter", meters)):
    with open(os.path.join(RES, f"{name}-{ENGINE}.jsonl"), "w", encoding="utf-8") as f:
        f.write("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in xs))
c = {k: sum(1 for m in meters if m["finishReason"] == k) for k in ("STOP", "SAFETY", "CLI_EMPTY")}
print(f"{ENGINE}: {len(meters)} pages laid into {len(by)} strata; {c}; nudged {sum(m['nudged'] for m in meters)}; "
      f"before the plan-mode fix {sum(1 for m in meters if m['cli_mode'] != 'plan')}")
