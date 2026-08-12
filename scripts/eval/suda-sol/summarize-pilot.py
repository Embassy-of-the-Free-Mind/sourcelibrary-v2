# Merge pilot verdicts (gold-labels.jsonl + pilot/*.verdict.json) and summarize. #3884
import json, glob
from collections import Counter
from pathlib import Path
import os

D = Path(os.environ.get("SOL_DATA_DIR", "scripts/output/sol-harvest"))
rows = {}
for l in open(D / "gold-labels.jsonl"):
    r = json.loads(l); rows[r["adler_id"]] = r
for f in sorted(glob.glob(str(D / "pilot" / "*.verdict.json"))):
    try:
        r = json.loads(open(f).read()); rows[r["adler_id"]] = r
    except Exception as e:
        print("BAD VERDICT FILE:", f, e)
rows = list(rows.values())
with open(D / "gold-labels-merged.jsonl", "w") as f:
    for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")

n = len(rows)
fid = Counter(r["fidelity"] for r in rows)
align = sum(1 for r in rows if r.get("alignment_ok"))
found = sum(1 for r in rows if r.get("our_translation_found"))
recit = [r for r in rows if r.get("recitation_signal")]
err_types = Counter(e["type"] for r in rows for e in r.get("errors", []))
err_sev = Counter(e["severity"] for r in rows for e in r.get("errors", []))
div_kinds = Counter(d["kind"] for r in rows for d in r.get("divergences", []))
major = [r["adler_id"] for r in rows if r["fidelity"] == "major_errors"]
our_err_entries = [r["adler_id"] for r in rows
                   if any(d["kind"] == "our_error" for d in r.get("divergences", []))]
sol_err_entries = [r["adler_id"] for r in rows
                   if any(d["kind"] == "sol_error" for d in r.get("divergences", []))]

print(f"entries judged: {n}")
print(f"alignment_ok: {align}/{n}")
print(f"our_translation_found: {found}/{n}")
print(f"fidelity: {dict(fid)}")
print(f"error types: {dict(err_types)}  severities: {dict(err_sev)}")
print(f"divergence kinds: {dict(div_kinds)}")
print(f"recitation_signal: {len(recit)}  -> {[r['adler_id'] for r in recit]}")
print(f"major_errors entries: {major}")
print(f"entries with our_error divergences: {our_err_entries}")
print(f"entries with sol_error divergences: {sol_err_entries}")
