#!/usr/bin/env python3
# PRIOR ART: build.py --before shows one earlier decision beside each row (labels included, so a '(k/n: why)' wording
# change reads as a change); lane-judge-sampler.mjs rebuild() lists flips the same way (#7263 2026-11-01: 56 "changed",
# most of them label-only). Neither attributes a change to a step. This compares decision CLASS + route, and walks a chain
# of attribution builds (each turns one more change on) to name the step that moved each cell.
"""Decision diff between router tables, attributed to the step that moved each cell (#7263). Stdlib only.

  python3 scripts/eval/estimator/router-table/decision_diff.py <reference.json> <step1-name>=<t1.json> [<step2-name>=<t2.json> ...] [--md]

The reference is the table the diff is against (e.g. 2026-10-31-correction-pass-7818; or current.json, read as the live
rows: its table with each `cells` override from its own build); each later table turns one more
change on. A cell's decision is its class (keep / switch / HOLD / UNTESTED / held / planned, the text before ' (') and its
route; for HOLD and UNTESTED the route only names the best candidate, so a HOLD whose candidate moves is listed apart as
'route only'. Each changed cell is attributed to every step at which its decision moved.
"""
import json, os, sys

cls = lambda d: d.split(' (')[0].strip()


def key(row):
    c = cls(row['decision'])
    return (c, row['route'])


def live(path):
    """current.json as a table: the rows of its `table`, each cell named in `cells` taken from that cell's own build
    (the rows router-binding.mjs reads as live)."""
    d = os.path.dirname(os.path.abspath(path)) + '/'
    cur = json.load(open(path))
    rows = {r['id']: r for r in json.load(open(d + cur['table'] + '.json'))['rows']}
    for cid, c in cur.get('cells', {}).items():
        rows[cid] = next(r for r in json.load(open(d + c['table'] + '.json'))['rows'] if r['id'] == cid)
    return dict(rows=list(rows.values()))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ref = live(args[0]) if args[0].endswith('current.json') else json.load(open(args[0]))
    steps = [(a.split('=', 1)[0], json.load(open(a.split('=', 1)[1]))) for a in args[1:]]
    chain = [('reference', {r['id']: r for r in ref['rows']})] + [(n, {r['id']: r for r in t['rows']}) for n, t in steps]
    ids = list(dict.fromkeys([i for _, t in chain for i in t]))
    out = []
    for i in ids:
        ks = [(n, key(t[i]) if i in t else ('(absent)', None), t.get(i)) for n, t in chain]
        if ks[0][1] == ks[-1][1]: continue
        moved = [(ks[j][0], ks[j - 1][1], ks[j][1], ks[j][2]) for j in range(1, len(ks)) if ks[j][1] != ks[j - 1][1]]
        a, b = ks[0][1], ks[-1][1]
        kind = 'route only' if a[0] == b[0] and a[0] in ('HOLD', 'UNTESTED') else 'decision'
        out.append(dict(cell=i, before=f"{a[0]} {a[1] or ''}".strip(), after=f"{b[0]} {b[1] or ''}".strip(), kind=kind,
                        pages_waiting=(ks[-1][2] or ks[0][2] or {}).get('pages_waiting'),
                        steps=[dict(step=n, frm=f"{x[0]} {x[1] or ''}".strip(), to=f"{y[0]} {y[1] or ''}".strip(), label=(r or {}).get('decision')) for n, x, y, r in moved]))
    if '--md' in sys.argv:
        dec = [o for o in out if o['kind'] == 'decision']
        print(f"{len(dec)} cells change decision, {len(out) - len(dec)} change only the candidate a HOLD names.\n")
        print('| cell | pages waiting | before | after | moved by |'); print('|---|---|---|---|---|')
        for o in sorted(out, key=lambda o: (o['kind'] != 'decision', o['cell'])):
            print(f"| {o['cell']} | {o['pages_waiting'] or 0:,} | {o['before']} | {o['after']} | " + '; '.join(f"{s['step']}: {s['frm']} → {s['to']}" for s in o['steps']) + (' (route only)' if o['kind'] != 'decision' else '') + ' |')
    else:
        print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
