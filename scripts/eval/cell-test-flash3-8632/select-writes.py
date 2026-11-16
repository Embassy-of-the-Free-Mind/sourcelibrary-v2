#!/usr/bin/env python3
# PRIOR ART: scripts/eval/hebrew-mss-cell-8632/select-step4.cjs — the same prereg rule for one cell with fixed arm dirs
# and a Gemini second judge; this one walks four cells, takes the floor-clearing arms from the build's hard_floor_blocked,
# and applies the cell-test-flash3 tie rule (fresh read wins a tie).
"""Pages to write after the flash3 cell tests (v2#8632, prereg comment 6848364669, 'Useful pages').

  python3 select-writes.py <ct dir> <build table .json> <out.json>

A judged page is written only when: its arm clears the hard floor in its cell (the build's hard_floor_blocked); the
Opus judge accepted that output with no invented / wrong-leaf defect (O1 O2 I1 I2 I6 T14); its fidelity is above the
stored text's; no other agy arm on the page scored higher (tie: the fresh read). Only the judged page; the Opus arm never.
"""
import collections, hashlib, json, os, sys

CT, TABLE, OUT = sys.argv[1:4]
INV = {'O1', 'O2', 'I1', 'I2', 'I6', 'T14'}
ARMS = {'3flash>agy-flash-low': ('3flash>agy-flash-low', '3flash_agy_flash_low'), 'agy-flash-low@4': ('agy-flash-low@4-read', 'agy_flash_low_4')}
key = json.load(open(f'{CT}/key.json'))
op = {}
for l in open(f'{CT}/verdicts-opus.jsonl'):
    v = json.loads(l); op[v['id']] = v['verdict']
rows = {r['id']: r for r in json.load(open(TABLE))['rows']}
blocked = lambda cell, route: route in (rows.get(f"{cell.rsplit('-', 1)[0]}/{cell.rsplit('-', 1)[1]}", {}).get('hard_floor_blocked') or [])
inv = lambda v: any(d.get('class') in INV for d in v.get('defects') or [])
pages = collections.defaultdict(list)
for k in key:
    if k['kind'] == 'item': pages[(k['cell'], k['page_id'])].append(k)
out, why = [], collections.Counter()
for (cell, pid), ks in sorted(pages.items()):
    st = next((k for k in ks if k['route'] == '3flash'), None)
    st_f = op.get(st['judged_as'], {}).get('fidelity', 0) if st else 0
    c = []
    for k in ks:
        if k['route'] not in ARMS: continue
        rid, d = ARMS[k['route']]; v = op.get(k['judged_as'])
        r = 'arm blocked by the hard floor in its cell' if blocked(cell, rid) else 'no verdict' if not v else 'judge rejected' if not v['accept'] \
            else 'invented / wrong-leaf defect' if inv(v) else 'fidelity not above stored' if not v['fidelity'] > st_f else None
        if r: why[f"{cell} {k['route']}: {r}"] += 1; continue
        f = f'{CT}/corr/{cell}/{d}/{pid}.txt'
        t = open(f).read().strip()
        c.append(dict(cell=cell, route=k['route'], dir=f'{CT}/corr/{cell}/{d}', page_id=pid, book_id=k['book_id'], page_number=k['page_number'], fidelity=v['fidelity'],
                      stored_fidelity=st_f, judged_as=k['judged_as'], read_sha256=hashlib.sha256(t.encode()).hexdigest()))
    c.sort(key=lambda x: (-x['fidelity'], x['route'] != 'agy-flash-low@4'))
    if c: out.append(c[0])
for k, v in sorted(why.items()): print(v, k, file=sys.stderr)
print('selected', len(out), collections.Counter((x['cell'], x['route']) for x in out), file=sys.stderr)
json.dump(out, open(OUT, 'w'), indent=1)
