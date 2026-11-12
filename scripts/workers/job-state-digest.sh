#!/usr/bin/env bash
# PRIOR ART: brief-route-check.sh (refuses a Route that contradicts the live translation table, #8606) — it checks one
# line of a brief at start; it does not tell the job what the router, holds, dial or other jobs say. #8609 (ops store)
# is the long-term home for shared state; this reads only sources that already exist and stores nothing.
#
# job-state-digest.sh <brief-file> — a short "what is true right now" block that claude-job.sh appends after a
# brief, so a headless job starts from today's router, spend dial, holds and running work instead of the dated
# copies it finds in docs and old issue comments. Why (2026-11-11): kangyur-finish-8482 ran Opus from a 10-27 router
# eval while the live table had moved Tibetan to agy that day; two lanes translated the same book at once (#8550);
# Derek: "they don't know what's up with routers". It adds no new store to keep current: every line is READ from
# the live source at start, and says which source.
#
# Never fails a start: every part has a timeout and prints nothing on error. Output is at most ~40 lines.
set -u
brief="${1:-}"; self="${2:-}"; [ -f "$brief" ] || exit 0   # $2: this job's own name, left out of "other jobs"
here=$(cd "$(dirname "$0")" && pwd); SL=$(cd "$here/../.." && pwd)
tmo() { if command -v timeout >/dev/null; then timeout "$@"; elif command -v gtimeout >/dev/null; then gtimeout "$@"; else shift; "$@"; fi; }
envf="$SL/.env.production.local"; [ -s "$envf" ] || envf=/root/sourcelibrary/.env.production.local

echo "## Current state (job-state-digest.sh, $(date -u +%FT%TZ)) — read from live sources at start; it overrides older docs, evals and comments"

# 1. Router (.claude/docs/routing.md): router-table/current.json names the live table; OCR lanes read its cells as
# `router_cells` in ocr-routing-table.json; translation lanes read the hand rows in translation-routing-table.json.
# (ocr-routing-table.json `rows` are page-kind descriptions for /quality, not routes, so they are not printed.)
python3 - "$SL/scripts/lib/translation-routing-table.json" "$SL/scripts/lib/ocr-routing-table.json" "$brief" "$SL/scripts/eval/estimator/router-table/current.json" <<'PY' 2>/dev/null
import json, re, sys
tr, ocr, brief, cur = sys.argv[1:5]
text = open(brief, errors="replace").read().lower()
def named(lang):
    # "English" is in nearly every brief as the target language, so an English OCR cell would match them all.
    if lang == "english": return re.search(r"\benglish[- ](books?|print|pages? (are|were) (in|printed))", text) is not None
    return re.search(r"\b" + re.escape(lang), text) is not None
try:
    t = json.load(open(tr))
    print(f"- TRANSLATION router (scripts/lib/translation-routing-table.json, as of {t.get('as_of','?')}); first matching row wins:")
    for r in t.get("rows", []):
        m = r.get("match", {})
        keys = m.get("language_prefix") or ([f"provider={m['provider']}"] if "provider" in m else ["any language"] if m.get("any") else [json.dumps(m)])
        hit = any(isinstance(k, str) and re.search(r"\b" + re.escape(k.split("=")[-1]), text) for k in keys)
        print(f"    {'*' if hit else ' '} {', '.join(keys)[:60]} → {r.get('engine')}  ({r.get('id')})")
except Exception as e:
    pass
try:
    c = json.load(open(cur))
    o = json.load(open(ocr))
    cells = o.get("router_cells") or []
    langs = sorted({x["cell"].split("-")[0] for x in cells if x.get("cell")})
    mine = [x for x in cells if named(x["cell"].split("-")[0])]
    print(f"- OCR router (live table {c.get('table','?')}, set {c.get('set','?')}; cells in ocr-routing-table.json router_cells):")
    for x in mine[:14]:
        print(f"    * {x['cell']} → {x.get('route')}  {x.get('k_of_n','')}  ({x.get('decision','')})")
    if not mine:
        print(f"      no cell for a language named in your brief (cells exist for: {', '.join(langs)[:200]}). An untested cell gets agy, never the incumbent.")
    for k, v in (c.get("cells") or {}).items():
        if named(k.split("-")[0]):
            print(f"    * decided override {k}: table {v.get('table')} — {str(v.get('why',''))[:160]}")
except Exception:
    pass
print("  (* = named in your brief.) Lanes route through router-binding.mjs / translation-routing.mjs; never pick --model by hand. A dated table or eval cited in an issue is history unless current.json names it.")
PY

# 2. Spend: the dial binds (CLAUDE.md, spend-controls.md); a remembered value is not the dial.
if [ -s "$envf" ]; then
  d=$(cd "$SL" && tmo 30 node --env-file="$envf" scripts/maintenance/set-dial.mjs --show 2>/dev/null | head -3 | paste -sd ' ' -)
  [ -n "$d" ] && echo "- Spend dial (set-dial.mjs --show): $d. Paid Gemini API = flash-lite only; everything else on the subscription CLIs."
fi

# 3. Holds: any book id in the brief that is held is out of every lane (pipeline-hold.mjs).
ids=$(grep -oE '\b[0-9a-f]{24}\b' "$brief" | sort -u | head -200 | paste -sd ' ' -)
if [ -n "$ids" ] && [ -s "$envf" ]; then
  h=$(cd "$SL" && IDS="$ids" tmo 30 node --env-file="$envf" --input-type=module -e '
import { MongoClient, ObjectId } from "mongodb";
const ids = process.env.IDS.split(" ");
const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
await c.connect();
const oids = ids.map(i => { try { return new ObjectId(i) } catch { return null } }).filter(Boolean);
const rows = await c.db("bookstore").collection("books").find(
  { $or: [{ id: { $in: ids } }, { _id: { $in: oids } }], "pipeline_auto.hold": { $exists: true, $ne: null } },
  { projection: { id: 1, title: 1, "pipeline_auto.hold": 1 } }).limit(20).toArray();
for (const b of rows) console.log(`${b.id || b._id} "${String(b.title || "").slice(0, 50)}" — ${JSON.stringify(b.pipeline_auto.hold).slice(0, 120)}`);
await c.close();' 2>/dev/null)
  if [ -n "$h" ]; then echo "- HELD books named in your brief (pipeline-hold.mjs; leave them out unless the brief is about the hold):"; echo "$h" | sed 's/^/    /'
  else echo "- None of the $(echo "$ids" | wc -w | tr -d ' ') book ids in your brief is held."; fi
fi

# 4. Other work on the same issue, on every box: two jobs on one issue have overwritten each other (#8550).
lands=$(head -15 "$brief" | grep -m1 -iE '^[[:space:]]*Lands:' | grep -oE '[0-9]{3,5}' | head -1)
if [ -n "$lands" ]; then
  live=$({ /root/bin/claude-job.sh status 2>/dev/null | sed 's/^/this-box: /'
           [ -x /root/bin/box.sh ] && tmo 40 /root/bin/box.sh others status </dev/null 2>/dev/null; } |
         awk '/^== /{box=$2} /^this-box:/{box="this box"; sub(/^this-box: /,"")} $1 ~ /^(RUNNING|LIVE|WAIT|RESUMING)/ {print box": "$0}' |
         grep -E -- "-$lands\b|#$lands\b" | { if [ -n "$self" ]; then grep -vE -- "[[:space:]]$self([[:space:]]|$)"; else cat; fi; } | head -5)
  [ -n "$live" ] && { echo "- Other jobs on #$lands running now (coordinate; do not write the same books):"; echo "$live" | cut -c1-160 | sed 's/^/    /'; }
fi
exit 0
