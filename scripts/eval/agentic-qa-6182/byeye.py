#!/usr/bin/env python3
# PRIOR ART: the #6331 by-eye packets (/mnt/HC_Volume_105839809/jobs/judge-set-6331/byeye: source + reference + blind A/B,
# fidelity, reversals, omissions, better). Here A/B are one arm's draft and final, so the read judges the revision.
"""
byeye.py — $0.  python3 scripts/eval/agentic-qa-6182/byeye.py build | run | score
build: picks the 15 units whose final differs most from its draft (1 − difflib ratio, over SA and GQ; one pair per unit),
       writes blind A/B packets to $AQ/byeye (hold reference text: never committed) and key.json there.
run:   3 Opus readers (`claude -p --model opus`), 5 units each.
score: numbers only → scripts/eval/results/agentic-qa-6182/byeye.json. Read from text: no page image.
"""
import json, os, random, subprocess, sys, difflib

D = "/root/cli-set-6331"
REC = "/mnt/HC_Volume_105839809/jobs/zh-set-6331/records.jsonl"
AQ = "/mnt/HC_Volume_105839809/jobs/agentic-qa-6182"
BW = f"{AQ}/byeye"
OUT = "scripts/eval/results/agentic-qa-6182"
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
os.makedirs(BW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
PROMPT = f"""You are a careful reader of English translations of historical texts (Chinese, Sanskrit, Pali). INPUT_FILE has one JSON
line per unit: `source` (the text as transcribed), `reference` (a published human translation: your guide to meaning,
never to wording; it may be cut a little wider or narrower than the source), and two English translations `A` and `B` of
the source. A and B differ in a few places; you do not know which, if either, is a revision, and you must not guess.

Per unit: read the source, then A and B against it. List every place where A and B differ in meaning (ignore pure wording
or formatting differences), and for each say which is right against the SOURCE: "A", "B", "both" (both acceptable) or
"neither". Then give each a fidelity 1–5 (5 = same meaning throughout; 4 = minor slips; 3 = a sentence or list wrong; 2 =
substantial parts wrong or missing; 1 = not a translation of this text), and say which is better overall ("A", "B" or
"TIE"). Do not reward style. Never quote more than 15 consecutive words of the reference.

Write EXACTLY one JSON line per unit, in input order, to OUTPUT_FILE, e.g.
{{"id":"...","diffs":[{{"where":"≤ 12 words of A","source":"≤ 12 characters/words of the source","right":"B","why":"one line"}}],"A":{{"fidelity":4}},"B":{{"fidelity":5}},"better":"B","note":"one line"}}
Write the file in ONE Write call or append line by line with python3. Do not read any other file. When done print only DONE <n>."""


def build():
    recs = {r["id"]: r for r in read(REC)}
    c38 = {r["uid"]: r["text"] for r in read(f"{D}/arms/C38.jsonl")}
    cand = {}
    for a in ("SA", "GQ"):
        for r in read(f"{AQ}/arms/{a}.jsonl"):
            d = r["draft"] if a == "SA" else c38[r["uid"]]
            ch = 1 - difflib.SequenceMatcher(None, d, r["text"], autojunk=False).ratio()
            if ch > 0 and ch > cand.get(r["uid"], (0,))[0]:
                cand[r["uid"]] = (ch, a, d, r["text"], len(r["findings"] or []))
    top = sorted(cand.items(), key=lambda x: -x[1][0])[:15]
    rng = random.Random(6182); key = {}; lines = []
    for uid, (ch, a, d, f, nf) in top:
        r = recs[uid]; flip = rng.random() < 0.5
        A, Bv = (f, d) if flip else (d, f)
        key[uid] = {"arm": a, "A": "final" if flip else "draft", "B": "draft" if flip else "final", "change": round(ch, 4), "findings": nf, "lang": r["lang"]}
        lines.append({"id": uid, "lang": r["lang"], "reference_translator": r["reference_meta"].get("translator"), "reference_style": r["reference_meta"].get("style"),
                      "source": r["ocr_text"], "reference": r["reference_text"], "A": A, "B": Bv})
    json.dump(key, open(f"{BW}/key.json", "w"), indent=1, ensure_ascii=False)
    for p in range(3):
        with open(f"{BW}/in-{p + 1}.jsonl", "w") as fh:
            for l in lines[p::3]: fh.write(json.dumps(l, ensure_ascii=False) + "\n")
    open(f"{BW}/PROMPT.md", "w").write(PROMPT)
    print({u: k for u, k in key.items()})


def run():
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    ps = []
    for p in range(1, 4):
        if os.path.exists(f"{BW}/out-{p}.jsonl") and len(read(f"{BW}/out-{p}.jsonl")) == len(read(f"{BW}/in-{p}.jsonl")): continue
        msg = f"Read {BW}/PROMPT.md and follow it exactly, with INPUT_FILE = {BW}/in-{p}.jsonl and OUTPUT_FILE = {BW}/out-{p}.jsonl."
        ps.append(subprocess.Popen(["claude", "-p", "--model", "opus", "--allowedTools", "Bash", "Read", "Write"], stdin=subprocess.PIPE, text=True, cwd="/tmp", env=env,
                                   stdout=open(f"{BW}/.log-{p}", "w"), stderr=subprocess.STDOUT))
        ps[-1].stdin.write(msg); ps[-1].stdin.close()
    for p in ps: p.wait()


def score():
    key = json.load(open(f"{BW}/key.json")); rows = []
    for p in range(1, 4):
        for o in read(f"{BW}/out-{p}.jsonl"):
            k = key[o["id"]]; m = {"A": k["A"], "B": k["B"], "both": "both", "neither": "neither", "TIE": "TIE"}
            rows.append({"uid": o["id"], "lang": k["lang"], "arm": k["arm"], "change": k["change"], "findings": k["findings"],
                         "fid": {k["A"]: o["A"]["fidelity"], k["B"]: o["B"]["fidelity"]}, "better": m.get(o["better"], o["better"]),
                         "diffs_right": {x: sum(m.get(d.get("right")) == x for d in o.get("diffs") or []) for x in ("final", "draft", "both", "neither")}})
    s = {"label": "read from text (typed corpora; no page image); Opus readers, blind A/B of draft vs final, not scholars", "units": len(rows),
         "by_arm": {}}
    for a in ("SA", "GQ"):
        rs = [r for r in rows if r["arm"] == a]
        if not rs: continue
        s["by_arm"][a] = {"units": len(rs), "fid_draft": round(sum(r["fid"]["draft"] for r in rs) / len(rs), 2), "fid_final": round(sum(r["fid"]["final"] for r in rs) / len(rs), 2),
                          "better": {x: sum(r["better"] == x for r in rs) for x in ("final", "draft", "TIE")},
                          "diffs_right": {x: sum(r["diffs_right"][x] for r in rs) for x in ("final", "draft", "both", "neither")}}
    s["rows"] = rows
    json.dump(s, open(f"{OUT}/byeye.json", "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in s.items() if k != "rows"}, indent=1))


{"build": build, "run": run, "score": score}[sys.argv[1]]()
