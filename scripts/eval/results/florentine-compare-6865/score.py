# PRIOR ART: scripts/eval/results/paired-translate-maya-6559/score.py (one fidelity per translation); this scores the
# NAHUATL and SPANISH columns separately, under two judges (agy gemini-3.8-flash-high, claude opus), each in both A/B orders.
# Run from this directory: python3 score.py
import json, re, statistics as st, collections, random, os
def parse(t):
    t = re.sub(r'^```[a-z]*\n|```$', '', t.strip()).strip(); i, j = t.find('{'), t.rfind('}'); return json.loads(t[i:j + 1])
def load(d, keyf, outf):
    key = {k['uid']: k for k in json.load(open(f'{d}/{keyf}'))}; res = {}
    if not os.path.exists(f'{d}/{outf}'): return res
    for l in open(f'{d}/{outf}'):
        r = json.loads(l)
        if not r.get('text'): continue
        k = key[r['uid']]
        try: j = parse(r['text']); [j[s][c]['fidelity'] for s in 'AB' for c in COLS]
        except Exception: print('  unparsed', d, outf, r['uid']); continue
        res[k['page_id']] = dict(k=k, arms={k['A']: j['A'], k['B']: j['B']}, xA=k['A'], better={c: (k[j.get(f'better_{c}')] if j.get(f'better_{c}') in ('A', 'B') else 'tie') for c in COLS})
    return res
COLS = ('nahuatl', 'spanish'); F = ('omitted', 'added', 'mistranslated')
JUDGES = [('gemini-3.8-flash-high', 'gemini'), ('claude opus', 'claude')]
summary, arm = {}, collections.defaultdict(lambda: collections.defaultdict(list))
for d in sorted(x for x in os.listdir('.') if os.path.isdir(x) and os.path.exists(f'{x}/key.json')):
    for judge, sfx in JUDGES:
        a = load(d, 'key.json', f'judge-{sfx}.jsonl'); b = load(d, 'key-swap.json', f'judge-{sfx}-swap.jsonl')
        both = [pid for pid in a if pid in b]
        if not both: continue
        x, y = sorted(a[both[0]]['arms'])
        for c in COLS:
            fx = lambda r, z: r['arms'][z][c]['fidelity']
            per = [dict(page=a[p]['k']['page_number'], vol=a[p]['k']['title'][-12:], d=(fx(a[p], x) + fx(b[p], x) - fx(a[p], y) - fx(b[p], y)) / 2, fx=(fx(a[p], x) + fx(b[p], x)) / 2, fy=(fx(a[p], y) + fx(b[p], y)) / 2,
                        agree=a[p]['better'][c] == b[p]['better'][c]) for p in both]
            pos = [fx(r, x) - fx(r, y) for r in list(a.values()) + list(b.values()) if r['xA'] == x], [fx(r, x) - fx(r, y) for r in list(a.values()) + list(b.values()) if r['xA'] != x]
            alld = [r['d'] for r in per]; random.seed(1); bs = sorted(st.mean(random.choices(alld, k=len(alld))) for _ in range(5000))
            summary[f'{d}|{judge}|{c}'] = dict(x=x, y=y, n=len(per), fx=st.mean(r['fx'] for r in per), fy=st.mean(r['fy'] for r in per), d=st.mean(alld), lo=bs[125], hi=bs[4875],
                                              wins=[sum(v > 0 for v in alld), sum(v == 0 for v in alld), sum(v < 0 for v in alld)], same_pick=sum(r['agree'] for r in per),
                                              pos_xA=st.mean(pos[0]), pos_xB=st.mean(pos[1]), pages={r['page']: r['d'] for r in per})
            print(f"{d:16} {judge:22} {c:8} {x}={summary[f'{d}|{judge}|{c}']['fx']:.2f} {y}={summary[f'{d}|{judge}|{c}']['fy']:.2f} {x}−{y} {st.mean(alld):+.2f} ({bs[125]:+.2f},{bs[4875]:+.2f}) pages {x}>/=/<{y} {summary[f'{d}|{judge}|{c}']['wins']} same pick {summary[f'{d}|{judge}|{c}']['same_pick']}/{len(per)} pos {st.mean(pos[0]):+.2f}/{st.mean(pos[1]):+.2f}")
        for p in both:
            for r in (a[p], b[p]):
                for z in (x, y):
                    for c in COLS:
                        v = r['arms'][z][c]; A = arm[(z, judge, c)]
                        A['fid'].append(v['fidelity']); A['summ'].append(bool(v.get('summarised')))
                        for f in F: A[f].append(len(v.get(f) or []))
print('\n| arm | column | judge | mean fidelity (all pairs) | omitted · added · mistranslated per page | summarised (share of judgements) | n judgements |')
print('|---|---|---|---|---|---|---|')
for (z, judge, c), A in sorted(arm.items(), key=lambda kv: (kv[0][2], kv[0][0], kv[0][1])):
    print(f"| {z} | {c} | {judge} | {st.mean(A['fid']):.2f} | {' · '.join(f'{st.mean(A[f]):.1f}' for f in F)} | {sum(A['summ'])}/{len(A['summ'])} | {len(A['fid'])} |")
json.dump({'pairs': summary, 'arms': {f'{z}|{j}|{c}': {'fid': st.mean(A['fid']), **{f: st.mean(A[f]) for f in F}, 'summarised': sum(A['summ']), 'n': len(A['fid'])} for (z, j, c), A in arm.items()}}, open('summary.json', 'w'), indent=1)
