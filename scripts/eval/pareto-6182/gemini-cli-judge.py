#!/usr/bin/env python3
# PRIOR ART: scripts/batch/cli-translate.mjs (agy -p on the subscription: empty scratch cwd, quota → STOP, every call
# logged to /var/log/sourcelibrary/agy-calls.jsonl). This applies that call shape to the #6182 judge packet: the
# Tengyur judge prompt (JUDGE-PROMPT-REF-R3.md) verbatim with the one item inlined, because a print-mode CLI call
# has no file to read. A cross-family check on the Opus arm (O) for fable-judge.py; never a primary judge.
"""
gemini-cli-judge.py — $0 (Antigravity subscription, `agy -p --model gemini-3.1-pro-low`). No paid Gemini API call.
  python3 scripts/eval/pareto-6182/gemini-cli-judge.py --in '/root/pareto-6182/tibjudge/in-J1-*.jsonl' --out DIR [--par 2] [--ids X001,X002]
Writes DIR/out-G-<id>.json per item (the judge's JSON line, same schema as out-J*), skips items already written,
stops the whole run on the first quota error.
"""
import glob, json, os, re, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

A = sys.argv
IN, OUT = A[A.index("--in") + 1], A[A.index("--out") + 1]
PAR = int(A[A.index("--par") + 1]) if "--par" in A else 2
ONLY = set(A[A.index("--ids") + 1].split(",")) if "--ids" in A else None
MODEL = "gemini-3.1-pro-low"
os.makedirs(OUT, exist_ok=True)
prompt_path = os.path.join(os.path.dirname(sorted(glob.glob(IN))[0]), "PROMPT.md")
rubric = open(prompt_path).read()
rubric = rubric[rubric.index("-->") + 3:] if rubric.startswith("<!--") else rubric
rubric = rubric[:rubric.index("Process items FIRST through LAST")]   # file-handling lines do not apply to one inlined item
TAIL = ("\nThe INPUT_FILE has exactly one item, given below as its JSON line. Do not use any tool and do not read or "
        "write any file. Reply with ONLY the one JSON output line for this item, in the Output format above, and nothing else.\n\nITEM:\n")
STOP = os.path.join(OUT, "STOP")


def log(rec):
    try:
        with open("/var/log/sourcelibrary/agy-calls.jsonl", "a") as f:
            f.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "job": "judge-fable-6182b", "model": MODEL, "kind": "judge", **rec}) + "\n")
    except OSError:
        pass


def judge(line):
    item = json.loads(line); iid = item["id"]; dst = os.path.join(OUT, f"out-G-{iid}.json")
    if os.path.exists(dst) or os.path.exists(STOP): return
    for attempt in range(3):
        ws = tempfile.mkdtemp(prefix="gj-"); t0 = time.time()
        r = subprocess.run(["agy", "-p", rubric + TAIL + line.strip(), "--model", MODEL, "--print-timeout", "600s"],
                           cwd=ws, capture_output=True, text=True, timeout=700)
        os.rmdir(ws) if not os.listdir(ws) else None
        txt = r.stdout or ""
        quota = bool(re.search(r"RESOURCE_EXHAUSTED|quota", txt + r.stderr, re.I)) and len(txt) < 400
        got = None
        for m in re.finditer(r"\{\s*\"id\"", txt):   # the reply's JSON line; the CLI may print its own preamble first
            try:
                got, _ = json.JSONDecoder().raw_decode(txt[m.start():]); break
            except json.JSONDecodeError:
                continue
        ok = bool(got) and got.get("id") == iid and set(got.get("scores", {})) == set(item["candidates"])
        log({"seconds": round(time.time() - t0, 1), "ok": ok, "error_class": "quota" if quota else None if ok else f"bad_{r.returncode}"})
        if quota:
            open(STOP, "w").write(f"{datetime.now(timezone.utc).isoformat()} {iid}: {(r.stderr or txt)[-300:]}"); print("QUOTA: stopping", iid, flush=True); return
        if ok:
            json.dump(got, open(dst, "w"), ensure_ascii=False); print("OK", iid, flush=True); return
        print("BAD", iid, attempt, txt[-200:].replace("\n", " "), flush=True)


lines = [l for f in sorted(glob.glob(IN)) for l in open(f) if l.strip() and (ONLY is None or json.loads(l)["id"] in ONLY)]
print(len(lines), "items", flush=True)
with ThreadPoolExecutor(PAR) as ex:
    list(ex.map(judge, lines))
print("DONE", len(glob.glob(os.path.join(OUT, "out-G-*.json"))), "STOP" if os.path.exists(STOP) else "", flush=True)
