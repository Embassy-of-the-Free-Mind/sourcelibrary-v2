#!/usr/bin/env python3
# PRIOR ART: the #6332 C38 import was done by hand (cli-results/strip-log.json on the box, no script committed); this
# is that step as a script, and it reproduces the committed C38 rows byte for byte before it writes anything new.
"""
import-cli-arm.py — $0. Copy CLI arm rows (scripts/eval/run-cli-arm.py output) into <work>/arms/ for scoring.

  python3 scripts/eval/syriac-pareto-6295/import-cli-arm.py --work <dir> --raw <arm>.raw.jsonl [--raw ...]

Per row (the last row for a uid wins): Gemini's safety-filter message ("This request was blocked by Gemini's
filters…") is cut together with any half-written tag before it, and the text before it is kept and marked
`blocked` — a reader would get the same stub. A row without text is not imported (the arm stays incomplete and
the run is re-run). Rows already in arms/<arm>.jsonl for other uids are kept (C38-ocr-b: 16 laptop rows + 8 here).
The raw rows go to <work>/cli-results/<arm>.clean.jsonl as they came back, as #6332 kept them.
"""
import json, os, re, sys

M = "This request was blocked by Gemini's filters"
STRIPPED = 'safety-filter message ("This request was blocked by Gemini\'s filters") cut; text before it kept'
opt = lambda k: [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == f"--{k}"]
W = opt("work")[0]
read = lambda p: [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()] if os.path.exists(p) else []


def strip(t):
    return re.sub(r"<[^>\n]*$", "", t[:t.index(M)].rstrip()).rstrip() if M in t else t


# Guard: the rule must reproduce the committed C38 import before it touches a new arm.
for a in ("C38-ocr", "C38-ocr-b"):
    raw = {r["uid"]: r for r in read(f"{W}/cli-results/{a}.clean.jsonl")}
    for r in read(f"{W}/arms/{a}.jsonl"):
        if r["uid"] in raw and strip(raw[r["uid"]]["text"]) != r["text"]:
            sys.exit(f"strip rule does not reproduce {a} {r['uid']}: refusing to import")

for rawf in opt("raw"):
    rows = {}
    for r in read(rawf):
        rows[r["uid"]] = r
    arm = next(iter(rows.values()))["arm"]
    kept = [r for r in rows.values() if (r.get("text") or "").strip()]
    clean_path, arm_path = f"{W}/cli-results/{arm}.clean.jsonl", f"{W}/arms/{arm}.jsonl"
    have_raw = {r["uid"]: r for r in read(clean_path)}
    have_arm = {r["uid"]: r for r in read(arm_path)}
    for r in kept:
        have_raw[r["uid"]] = r
        x = {k: v for k, v in r.items()}
        x["text"] = strip(r["text"])
        x["blocked"] = M in r["text"]
        if x["blocked"]:
            x["stripped"] = STRIPPED
        have_arm[r["uid"]] = x
    for path, d in ((clean_path, have_raw), (arm_path, have_arm)):
        with open(path, "w", encoding="utf-8") as f:
            for r in d.values():
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(arm, f"{len(kept)} imported ({len(rows) - len(kept)} without text skipped), {sum(M in r['text'] for r in kept)} cut by the safety filter;",
          f"arms/{arm}.jsonl now {len(have_arm)} rows")
