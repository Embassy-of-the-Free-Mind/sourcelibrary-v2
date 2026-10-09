"""PRIOR ART: none for `claude -p` run cost; run-reviewers.sh is new (#6174). $25.2 API-eq per weekly point is the
2026-10-07 calibration (climits history vs transcripts), ±50%.
Cost of a run-reviewers.sh output dir from `claude -p --output-format json` results. Usage: python3 scripts/eval/spot-check/run-cost.py <arm_dir> [...]"""
import json, glob, os, sys
for d in sys.argv[1:]:
    tot = 0; turns = 0; dur = 0; pages = 0; ok = 0
    for f in sorted(glob.glob(os.path.join(d, 'meta', '*.json'))):
        try: r = json.load(open(f))
        except Exception: print('  unreadable', f); continue
        tot += r.get('total_cost_usd', 0); turns += r.get('num_turns', 0); dur = max(dur, r.get('duration_ms', 0))
        rv = os.path.join(d, 'reviews', os.path.basename(f))
        if os.path.exists(rv):
            ok += 1; pages += sum(len(b.get('pages', [])) for b in json.load(open(rv)))
    print(f"{os.path.basename(d)}: ${tot:.2f} API-eq, {ok} reviews, {pages} pages, ${tot/max(pages,1):.3f}/page, {turns} turns, wall {dur/60000:.1f} min, ≈ {tot/25.2:.1f} weekly pts")
