#!/usr/bin/env python3
# PRIOR ART: /root/cli-set-6331/cli-arm.sh and the CS arm of #6331 (one-shot arms on the same prompts; no check step);
# scripts/eval/run-cli-arm.py (Gemini CLI harness, not Claude). This adds draft → check → revise with per-call usage.
"""
build-arms.py — $0 (Claude subscription). Agentic QA arms for #6182 on the 138-unit #6331 canon set.

  python3 scripts/eval/agentic-qa-6182/build-arms.py [--arms SA,GQ] [--par 6] [--limit N]

SA: Sonnet draft (unit prompt, unchanged) → fresh Sonnet check (source + draft only) → revise (only listed fixes).
GQ: stored C38 draft → the same check → revise.
Each step is one `claude -p --model sonnet` process with no tools, no CLAUDE.md, no API key (subscription OAuth).
Appends one row per unit to $OUT/{SA,GQ}.jsonl as it finishes and skips finished units on restart. Exits 3 on a
usage limit. Rows hold model text only (no reference text).
"""
import json, os, re, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

D = "/root/cli-set-6331"
REC = "/mnt/HC_Volume_105839809/jobs/zh-set-6331/records.jsonl"
OUT = os.environ.get("AQ_OUT", "/mnt/HC_Volume_105839809/jobs/agentic-qa-6182/arms")
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
ARMS = arg("--arms", "SA,GQ").split(",")
PAR = int(arg("--par", "6"))
LIMIT = int(arg("--limit", "0"))
os.makedirs(OUT, exist_ok=True)
read = lambda p: [json.loads(l) for l in open(p) if l.strip()]
units = read(f"{D}/units.jsonl")
src = {r["id"]: r["ocr_text"] for r in read(REC)}  # source only; reference_text is never read into a prompt
c38 = {r["uid"]: r["text"] for r in read(f"{D}/arms/C38.jsonl")}
lock = threading.Lock()
STOP = threading.Event()
now = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

SYS = "You are a careful translator and reviser of historical texts. Follow the user's instructions exactly. Output only what is asked for."

CHECK = """You are checking an English translation of one passage against its source text. You see only the source and the translation.

List every place where the translation does not say what the source says, of these four kinds:
- "reversal": the sense is reversed — affirmed ↔ negated, a number or quantity changed so the claim changes, subject/object or speaker swapped, a condition turned into its opposite.
- "omission": a sentence, clause, list item, name, number or repeated formula in the source is missing from the translation.
- "mistranslation": a word, phrase or clause is rendered with a wrong meaning (not merely a different but defensible word choice).
- "addition": the translation states something the source does not support — invented content, text filled in where the source has none, or a note/gloss asserting a wrong fact. The house format allows <note>, <gloss>, <term>, <meta>, <summary> and <keywords> tags and bracketed explanations: these are NOT additions unless what they assert is wrong or they are presented as part of the source.

Do not list style, fluency, layout, transliteration conventions, or defensible alternative renderings. If you find nothing wrong, return an empty list; do not manufacture findings.

Output ONLY one JSON object, no prose, no code fence:
{"findings":[{"type":"reversal|omission|mistranslation|addition","source_span":"<verbatim from the source, ≤ 40 characters/words>","draft_span":"<verbatim from the translation, ≤ 25 words; empty for an omission>","problem":"<one line>","fix":"<the corrected English>"}]}

=== SOURCE ===
{SRC}

=== TRANSLATION ===
{DRAFT}
"""

REVISE = """Below are a source text, an English translation of it, and a list of findings from a reviewer who checked the translation against the source.

Revise the translation by applying ONLY the listed fixes. Where a finding is plainly wrong when you check it against the source, leave that place unchanged. Change nothing else: keep every other word, the markdown, headings, line breaks and all tags (<note>, <gloss>, <term>, <meta>, <summary>, <keywords>, etc.) exactly as they are.

Output ONLY the complete revised translation, from its first character to its last, with no preface and no comment.

=== SOURCE ===
{SRC}

=== FINDINGS ===
{FINDINGS}

=== TRANSLATION ===
{DRAFT}
"""


class Limit(Exception):
    pass


def claude(prompt, tries=3):
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENROUTER_API_KEY")}
    for t in range(tries):
        t0 = now()
        p = subprocess.run(["claude", "-p", "--model", "sonnet", "--safe-mode", "--tools", "", "--strict-mcp-config", "--no-session-persistence",
                            "--system-prompt", SYS, "--output-format", "json"], input=prompt, capture_output=True, text=True, cwd="/tmp", env=env, timeout=1200)
        t1 = now()
        try:
            o = json.loads(p.stdout)
        except Exception:
            o = None
        blob = (p.stdout + p.stderr)[-2000:]
        if o and not o.get("is_error") and (o.get("result") or "").strip():
            u = o.get("usage") or {}
            mu = next(iter((o.get("modelUsage") or {}).values()), {})
            return o["result"], {"start": t0, "end": t1, "model": next(iter(o.get("modelUsage") or {"?": 0})), "input": u.get("input_tokens", 0),
                                 "output": u.get("output_tokens", 0), "thinking": (u.get("output_tokens_details") or {}).get("thinking_tokens", 0),
                                 "cache_read": u.get("cache_read_input_tokens", 0), "cache_write": u.get("cache_creation_input_tokens", 0),
                                 "cost_list_usd": o.get("total_cost_usd", mu.get("costUSD", 0)), "secs": round(o.get("duration_ms", 0) / 1000, 1)}
        if re.search(r"usage limit|limit reached|rate.?limit|hit your limit|429|quota|resets", blob, re.I):
            raise Limit(blob[-300:])
        print(f"retry {t}: {blob[-300:]!r}", file=sys.stderr, flush=True)
        time.sleep(20)
    raise RuntimeError(f"claude failed: {blob[-300:]}")


def parse_findings(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    o = json.loads(m.group(0))
    f = o["findings"]
    assert isinstance(f, list)
    return [x for x in f if isinstance(x, dict) and x.get("type") in ("reversal", "omission", "mistranslation", "addition")]


def check_revise(uid, draft, calls):
    s = src[uid]
    for t in range(2):
        txt, c = claude(CHECK.replace("{SRC}", s).replace("{DRAFT}", draft)); c["step"] = "check"; calls.append(c)
        try:
            findings = parse_findings(txt); break
        except Exception:
            findings = None
    if findings is None:
        return None, draft, "check_unparsable"
    if not findings:
        return findings, draft, None
    fl = "\n".join(f"{i + 1}. [{x['type']}] source: {x.get('source_span', '')} | translation: {x.get('draft_span', '')} | problem: {x.get('problem', '')} | fix: {x.get('fix', '')}"
                   for i, x in enumerate(findings))
    for t in range(2):
        final, c = claude(REVISE.replace("{SRC}", s).replace("{FINDINGS}", fl).replace("{DRAFT}", draft)); c["step"] = "revise"; calls.append(c)
        if len(final) >= 0.7 * len(draft):
            return findings, final.strip(), None
    return findings, final.strip(), "revise_short"


def run(arm, u):
    uid = u["uid"]; calls = []; t0 = now()
    row = {"uid": uid, "set": u["set"], "lang": u["lang"], "arm": arm, "model": "claude-sonnet-5-5 via claude -p (subscription)"}
    if arm == "SA":
        draft, c = claude(u["prompt"]); c["step"] = "draft"; calls.append(c)
        row["draft"] = draft.strip()
    else:
        row["draft_from"] = "C38"
    findings, final, flag = check_revise(uid, row.get("draft") or c38[uid], calls)
    row.update({"findings": findings, "text": final, "flag": flag, "calls": calls, "n_calls": len(calls), "start": t0, "end": now()})
    for k in ("input", "output", "thinking", "cache_read", "cache_write", "cost_list_usd"):
        row[k] = round(sum(c[k] for c in calls), 6)
    with lock:
        open(f"{OUT}/{arm}.jsonl", "a").write(json.dumps(row, ensure_ascii=False) + "\n")
    return arm, uid, len(findings or []), flag


done = {a: {r["uid"] for r in read(f"{OUT}/{a}.jsonl")} if os.path.exists(f"{OUT}/{a}.jsonl") else set() for a in ARMS}
todo = [(a, u) for u in units for a in ARMS if u["uid"] not in done[a]]
if LIMIT: todo = todo[:LIMIT]
print(f"{now()} todo {len(todo)} ({ {a: 138 - len(done[a]) for a in ARMS} })", flush=True)
code = 0
with ThreadPoolExecutor(PAR) as ex:
    fut = {}
    for a, u in todo:
        fut[ex.submit(lambda a=a, u=u: None if STOP.is_set() else run(a, u))] = (a, u["uid"])
    for f in as_completed(fut):
        try:
            r = f.result()
            if r: print(now(), *r, flush=True)
        except Limit as e:
            STOP.set(); code = 3; print(now(), "LIMIT", fut[f], str(e)[-200:], flush=True)
        except Exception as e:
            print(now(), "FAIL", fut[f], repr(e)[-300:], flush=True)
print(now(), "EXIT", code, flush=True)
sys.exit(code)
