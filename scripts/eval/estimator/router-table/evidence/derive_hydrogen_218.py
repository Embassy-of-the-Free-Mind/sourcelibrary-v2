#!/usr/bin/env python3
# PRIOR ART: scripts/eval/router-next-7263/split_evidence.py — cuts a source score.json by script type from the
# evidence_pages.py / classify-evidence.mjs page rows; that chain rebuilds every source at once and needs the whole
# backfill. The 8632 by-script file was written by hand for one source. This does the same cut for one source
# (route-judge results/hydrogen-218), with the page's script type from script-type.mjs classifyPages saved beside it
# (results/hydrogen-218/script-type.json, read 2026-11-14), and split_evidence.py's agg() for the fields.
"""Hydrogen (#218) evidence by script type. Stdlib only.

  python3 scripts/eval/estimator/router-table/evidence/derive_hydrogen_218.py   (repo root)

Writes evidence/by-script/hydrogen-218--score.json with cells `<cell>|print` and `<cell>|unknown` for the three Hydrogen
routes, and checks the unsplit counts against the source score.json.
"""
import collections, gzip, importlib.util, json, re

SRC = 'scripts/eval/route-judge-6740/results/hydrogen-218/'
spec = importlib.util.spec_from_file_location('split', 'scripts/eval/router-next-7263/split_evidence.py')
split = importlib.util.module_from_spec(spec); spec.loader.exec_module(split)


def cls(d):
    m = re.match(r'^[IOTDE]\d+', str(d.get('class') or '').upper())
    return m.group(0) if m else 'E2'


def main():
    key = json.load(open(SRC + 'key.json'))
    V = {}
    for line in gzip.open(SRC + 'verdicts-opus.jsonl.gz', 'rt'):
        r = json.loads(line)
        if r.get('verdict'): V[r['id']] = r['verdict']
    script = json.load(open(SRC + 'script-type.json'))
    S = json.load(open(SRC + 'score.json'))
    rows = collections.defaultdict(list)
    for k in key:
        if k['kind'] != 'item': continue
        v = V.get(k.get('judged_as'))
        if not v: continue
        rows[(k['cell'], k['route'])].append(dict(book_id=k['book_id'], accept=bool(v.get('accept')),
            wrong_text=any(d.get('severity') == 'wrong_text' for d in v.get('defects') or []),
            classes=[cls(d) for d in v.get('defects') or []], script=script.get(k['page_id'], 'unknown')))
    out = collections.defaultdict(lambda: {'routes': {}})
    for (cell, route), rs in rows.items():
        src = S['cells'][cell]['routes'][route]
        if src['accept'] != f"{sum(r['accept'] for r in rs)}/{len(rs)}":
            raise SystemExit(f'{cell}/{route}: rows {sum(r["accept"] for r in rs)}/{len(rs)} != score {src["accept"]}')
        allb = len({r['book_id'] for r in rs})
        for sc in split.SCRIPTS:
            part = [r for r in rs if r['script'] == sc]
            if part: out[f'{cell}|{sc}']['routes'][route] = split.agg(part, src['books'], allb)
    doc = {'_about': '#218 job hydrogen-panels-218: judge.mjs score of route-judge results/hydrogen-218 cut by the page script type (script-type.mjs, read 2026-11-14). The stored baselines on the same pages stay in router-tests-2026-10-26 (German) and latin-flash3-live-route-8632 (Latin).',
           'source': SRC + 'score.json', 'cells': dict(out)}
    json.dump(doc, open('scripts/eval/estimator/router-table/evidence/by-script/hydrogen-218--score.json', 'w'), indent=1)
    for c, x in sorted(out.items()): print(c, {r: v['accept'] for r, v in x['routes'].items()})


if __name__ == '__main__':
    main()
