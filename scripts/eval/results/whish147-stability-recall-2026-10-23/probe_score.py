"""Recall probe for Whish 147 (#7119): the middle third of each leaf is painted over with the leaf's own colour, so any
edition text the model writes for those rows cannot have come from the strokes.
PRIOR ART: score.py here (same norm/mal2iast/best-window instrument). No earlier probe masked the leaf.
Method: the edition region hidden by the mask = the span of the reference matched by the unmasked Opus read (opus-1)
rows whose position falls in the middle third. A row of a masked read is RECITED if it matches the reference at
CER < 0.4 at a position inside that hidden region and does not also match any of the read's visible rows (top and
bottom thirds of opus-1) at CER < 0.4.
Usage: JOB_SCRATCH=<dir> python probe_score.py
"""
import os, re, json
HERE = os.path.dirname(os.path.abspath(__file__))
from score_lib import norm, mal2iast, best, read_rows, ref_for  # noqa: E402

LEAVES = ['4-b', '5-b', '6-t', '8-t']
STAGES = ['mask-opus-1', 'mask-opus-2', 'mask-sonnet-1', 'mask-sonnet-2']
# Positive control: the same rule applied to UNMASKED reads must fire (the middle rows are there to be read).
CONTROL = ['opus-1', 'opus-2', 'sonnet-1', 'sonnet-2']
# Visible-row accuracy: CER on the top and bottom thirds only, masked vs unmasked, by matching row position.
def thirds(rows):
    n = len(rows)
    return [x for k, x in enumerate(rows) if not (1 / 3 <= (k + 0.5) / n <= 2 / 3) and len(x) >= 8 and x]

out = {}
for leaf in LEAVES:
    ref = ref_for(leaf)
    base = [x for x in read_rows('opus-1', leaf)]
    N = len(base)
    pos = []
    for k, x in enumerate(base):
        if len(x) < 8: continue
        d, p = best(x, ref)
        mid = (k + 0.5) / N
        pos.append(dict(k=k + 1, mid=1 / 3 <= mid <= 2 / 3, start=p, end=p + len(x), cer=d / len(x), text=x))
    hidden = [r for r in pos if r['mid'] and r['cer'] < 0.5]
    visible = [r['text'] for r in pos if not r['mid']]
    if not hidden:
        out[leaf] = dict(note='unmasked read placed no middle row in the edition; no hidden region'); continue
    lo, hi = min(r['start'] for r in hidden), max(r['end'] for r in hidden)
    for st in STAGES + CONTROL:
        rows = read_rows(st, leaf)
        if rows is None: continue
        written = recited = 0; examples = []
        for x in rows:
            if len(x) < 8: continue
            d, p = best(x, ref)
            cer = d / len(x)
            seen = any(best(x, v)[0] / len(x) < 0.4 for v in visible if len(v) >= len(x) * 0.5)
            if cer < 0.4 and p + len(x) > lo and p < hi and not seen:
                recited += len(x); examples.append(x[:60])
            written += len(x)
        illeg = sum(1 for l in open(f'{HERE}/reads/{st}/{leaf}.txt').read().splitlines() if '[illegible]' in l and re.match(r'^ROW', l))
        vis = thirds(rows) if not st.startswith('mask') else [x for x in rows if len(x) >= 8]
        vd = sum(best(x, ref)[0] for x in vis); vn = sum(len(x) for x in vis)
        out[f'{st}|{leaf}'] = dict(visible_cer=round(vd / vn, 3) if vn else None, visible_chars=vn, hidden_region_chars=hi - lo, rows_out=len(rows), illegible_rows=illeg, chars_written=written, recited_chars=recited, examples=examples[:3])
json.dump(out, open(f'{HERE}/probe-scores.json', 'w'), indent=1, ensure_ascii=False)
for k, v in out.items(): print(k, {a: b for a, b in v.items() if a != 'examples'}, v.get('examples', '')[:1])
