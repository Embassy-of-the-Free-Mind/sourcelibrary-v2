# PRIOR ART: scripts/eval/results/paired-translate-6559/score.py (one judge, one pair); this scores every packet
# (pair of arms) under TWO judges (agy gemini-3.8-flash-high, claude opus), each in both A/B orders.
# Run from this directory: python3 score.py [packet ...]
import json, re, statistics as st, collections, random, os, sys
def parse(t):
    t = re.sub(r'^```[a-z]*\n|```$', '', t.strip()).strip(); i, j = t.find('{'), t.rfind('}'); return json.loads(t[i:j + 1])
def load(d, keyf, outf):
    key = {k['uid']: k for k in json.load(open(f'{d}/{keyf}'))}; res = {}
    if not os.path.exists(f'{d}/{outf}'): return res
    for l in open(f'{d}/{outf}'):
        r = json.loads(l)
        if not r.get('text'): continue
        k = key[r['uid']]
        try: j = parse(r['text'])
        except Exception: print('  unparsed', d, outf, r['uid']); continue
        bt = j.get('better', 'tie')
        res[k['page_id']] = dict(k=k, arms={k['A']: j['A'], k['B']: j['B']}, xA=k['A'], better='tie' if bt not in ('A', 'B') else k[bt])
    return res
FIELDS = {'translate': ('omitted', 'added', 'mistranslated'), 'ocr': ('dropped', 'invented', 'misread', 'normalised')}
summary = {}
for d in (sys.argv[1:] or sorted(x for x in os.listdir('.') if os.path.isdir(x) and os.path.exists(f'{x}/key.json'))):
    key0 = json.load(open(f'{d}/key.json')); x, y = key0[0]['A'], key0[0]['B']
    task = 'ocr' if d.startswith('ocr') else 'translate'; F = FIELDS[task]
    for judge, sfx in [('gemini-3.8-flash-high', 'gemini'), ('claude opus', 'claude')]:
        a = load(d, 'key.json', f'judge-{sfx}.jsonl'); b = load(d, 'key-swap.json', f'judge-{sfx}-swap.jsonl')
        both = [pid for pid in a if pid in b]
        if not both: continue
        x, y = sorted(a[both[0]]['arms'])  # alphabetical, stable
        print(f'\n### {d} — judge {judge}: {len(both)} pages in both orders ({x} vs {y})')
        diffA = [r['arms'][x]['fidelity'] - r['arms'][y]['fidelity'] for r in list(a.values()) + list(b.values()) if r['xA'] == x]
        diffB = [r['arms'][x]['fidelity'] - r['arms'][y]['fidelity'] for r in list(a.values()) + list(b.values()) if r['xA'] != x]
        print(f'position: {x}−{y} with {x} as A {st.mean(diffA):+.2f} (n={len(diffA)}), as B {st.mean(diffB):+.2f} (n={len(diffB)})')
        books = collections.defaultdict(list)
        for pid in both:
            ra, rb = a[pid], b[pid]; k = ra['k']
            books[f"{k['language'][:12]} · {k['title'][:28]}"].append(dict(
                fx=(ra['arms'][x]['fidelity'] + rb['arms'][x]['fidelity']) / 2, fy=(ra['arms'][y]['fidelity'] + rb['arms'][y]['fidelity']) / 2,
                wx=[ra['better'], rb['better']].count(x), wy=[ra['better'], rb['better']].count(y), agree=ra['better'] == rb['better'],
                nx=[len(ra['arms'][x].get(f, [])) + len(rb['arms'][x].get(f, [])) for f in F], ny=[len(ra['arms'][y].get(f, [])) + len(rb['arms'][y].get(f, [])) for f in F]))
        print(f'| book | pages | {x} | {y} | {x} − {y} | preferred {x[0]}/{y[0]} | same pick both orders | ' + ' | '.join(f'{f} {x[0]}/{y[0]}' for f in F) + ' |')
        print('|' + '---|' * (6 + len(F)))
        rows = sorted(books.items()) + [('**all**', [r for rs in books.values() for r in rs])]
        for bk, rs in rows:
            print(f"| {bk} | {len(rs)} | {st.mean(r['fx'] for r in rs):.2f} | {st.mean(r['fy'] for r in rs):.2f} | {st.mean(r['fx'] - r['fy'] for r in rs):+.2f} | {sum(r['wx'] for r in rs)}/{sum(r['wy'] for r in rs)} | {sum(r['agree'] for r in rs)}/{len(rs)} | "
                  + ' | '.join(f"{sum(r['nx'][i] for r in rs)}/{sum(r['ny'][i] for r in rs)}" for i in range(len(F))) + ' |')
        alld = [r['fx'] - r['fy'] for r in rows[-1][1]]
        random.seed(1); bs = sorted(st.mean(random.choices(alld, k=len(alld))) for _ in range(5000))
        print(f'pages {x} higher / equal / {y} higher: {sum(v > 0 for v in alld)} / {sum(v == 0 for v in alld)} / {sum(v < 0 for v in alld)}; mean {st.mean(alld):+.2f}, bootstrap 95% CI {bs[125]:+.2f} to {bs[4875]:+.2f}')
        summary[(d, judge)] = dict(x=x, y=y, n=len(alld), fx=st.mean(r['fx'] for r in rows[-1][1]), fy=st.mean(r['fy'] for r in rows[-1][1]), d=st.mean(alld), lo=bs[125], hi=bs[4875],
                                   nx=[sum(r['nx'][i] for r in rows[-1][1]) for i in range(len(F))], ny=[sum(r['ny'][i] for r in rows[-1][1]) for i in range(len(F))])
json.dump({f'{k[0]}|{k[1]}': v for k, v in summary.items()}, open('summary.json', 'w'), indent=1)
m = [summary.get(('maya-opus-gemini', j)) for j in ('gemini-3.8-flash-high', 'claude opus')]
if all(m):
    sign = [v['d'] if v['x'] == 'opus' else -v['d'] for v in m]
    print('\nMAYA VERDICT RULE (Opus only if BOTH judges, order-averaged, put Opus ahead):', 'OPUS' if all(s > 0 for s in sign) else 'GEMINI', [round(s, 3) for s in sign])
