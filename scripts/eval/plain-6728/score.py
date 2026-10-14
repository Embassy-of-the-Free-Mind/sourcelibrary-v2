#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/score.py — parse_obj / decode (with pareto-6182/score-xl.py `norm`),
# boot (2,000 draws by work), paired(), locate() and the plant-located rule are its code, cut to one judge per family.
"""
score.py — $0. Scores #6728 from $W/judge/{G,O}/{key.json,texts.json,out.jsonl}, $W/bodies.json and the arm rows.
Writes scripts/eval/results/plain-6728/scores.json (numbers, no reference text) and prints the tables.
"""
import importlib.util, json, os, random, re, statistics, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('scorexl', os.path.join(HERE, '..', 'pareto-6182', 'score-xl.py'))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)

W = os.environ.get('W6728', os.environ.get('JOB_SCRATCH', '') + '/w')
RESULTS = 'scripts/eval/results/plain-6728'
LANGS = ['Persian', 'Sanskrit', 'Chinese', 'Greek', 'Hebrew']
BODIES = json.load(open(f'{W}/bodies.json'))
NB = 2000
SENT = re.compile(r'<<<\s*BEGIN\s*>>>([\s\S]*?)(<<<\s*END\s*>>>|$)')


def parse_obj(raw):
    m = SENT.search(raw or ''); t = m.group(1) if m else (raw or '')
    m = re.search(r'\{[\s\S]*\}', t)
    if not m: return None
    try: return json.loads(m.group(0))
    except ValueError: return None


def decode(o, labels):
    tier = {}
    for t, grp in enumerate(o.get('ranking') or []):
        for l in (grp if isinstance(grp, list) else [grp]): tier[l] = t
    res = {}
    for l, s in (o.get('scores') or {}).items():
        if l not in labels or not isinstance(s, dict): continue
        try: n = sx.norm(s, tier.get(l))
        except Exception: continue
        try: n['fid'] = float(n['fid']) if n['fid'] is not None else None
        except (TypeError, ValueError): n['fid'] = None
        n['spans'] = [x for x in (s.get('spans') or []) if isinstance(x, dict) and x.get('quote')]
        n['inv'] = [x for x in (s.get('invention') or []) if isinstance(x, dict)]
        n['revq'] = (s.get('reversal') or {}).get('candidate') if isinstance(s.get('reversal'), dict) else None
        n['label'] = l
        res[labels[l]] = n
    return res


mean = lambda x: sum(x) / len(x) if x else None
r3 = lambda v: None if v is None else round(v, 3)


def boot(pages, stat, seed=6728):
    if len(pages) < 2: return None
    rng = random.Random(seed); vals = []
    for _ in range(NB):
        v = stat([pages[rng.randrange(len(pages))] for _ in pages])
        if v is not None: vals.append(v)
    vals.sort()
    return [round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3)] if vals else None


norm_ws = lambda s: re.sub(r'\s+', ' ', s).strip().lower()


def locate(quote, text):
    t = norm_ws(text); q = norm_ws(quote).strip('"\'“”‘’.…')
    if not q: return None
    k = t.find(q)
    if k < 0:
        w = q.split(' ')
        for n in (6, 4, 3):
            if len(w) >= n:
                k = t.find(' '.join(w[:n]))
                if k >= 0: break
    return None if k < 0 else (k, k + len(q))


def family(F):
    J = f'{W}/judge/{F}'
    key = json.load(open(f'{J}/key.json')); items = key['items']; texts = json.load(open(f'{J}/texts.json'))
    dec, unparsed = {}, []
    p = f'{J}/out.jsonl'
    rows = {}
    if os.path.exists(p):
        for l in open(p, encoding='utf-8'):
            if l.strip():
                r = json.loads(l)
                if r.get('text') or r['uid'] not in rows: rows[r['uid']] = r
    for i, r in rows.items():
        o = parse_obj(r.get('raw') or r.get('text'))
        d = decode(o, items[i]['labels']) if o else None
        if not d or any(v['fid'] is None for v in d.values()) or len(d) != len(items[i]['labels']): unparsed.append(i)
        if d: dec[i] = d
    CUR, PLAIN, CUR2 = f'{F}-CUR', f'{F}-PLAIN', f'{F}-CUR2'
    arms_items = lambda L=None: [i for i, k in items.items() if k['kind'] == 'ARMS' and (L is None or k['lang'] == L)]
    fid = lambda i, a: (dec.get(i, {}).get(a) or {}).get('fid')

    def paired(L, x, y):
        its = [i for i in arms_items(L) if fid(i, x) is not None and fid(i, y) is not None]
        if not its: return None
        d = lambda s: mean([fid(i, x) - fid(i, y) for i in s])
        w = sum(1 for i in its if fid(i, x) > fid(i, y)); lo = sum(1 for i in its if fid(i, x) < fid(i, y))
        return {'n': len(its), 'mean': r3(d(its)), 'ci_by_work': boot(its, d), 'wins': w, 'losses': lo, 'ties': len(its) - w - lo}

    def arm_tab(L, a):
        its = [i for i in arms_items(L) if fid(i, a) is not None]
        if not its: return None
        g = lambda i: dec[i][a]
        acc = lambda i: [s for s in g(i)['spans'] if s.get('type') == 'accuracy']
        inv_k = {}
        for i in its:
            for x in g(i)['inv']: inv_k[x.get('kind')] = inv_k.get(x.get('kind'), 0) + 1
        f = lambda s: mean([fid(i, a) for i in s])
        return {'n': len(its), 'fidelity': r3(f(its)), 'ci_by_work': boot(its, f),
                'reversal_pages': sum(g(i)['rev'] for i in its), 'omission_pages': sum(g(i)['om'] for i in its),
                'acc_spans_per_page': r3(mean([len(acc(i)) for i in its])),
                'major_acc_spans_per_page': r3(mean([len([s for s in acc(i) if s.get('severity') == 'major']) for i in its])),
                'omission_spans_per_page': r3(mean([len([s for s in acc(i) if re.search(r'omit|missing|drop|absent|left out|lost', s.get('why', ''), re.I)]) for i in its])),
                'invention_per_page': r3(mean([len(g(i)['inv']) for i in its])), 'invention_by_kind': inv_k,
                'pages_with_invention': sum(1 for i in its if g(i)['inv'])}

    out = {'judge': key['judge'], 'items': len(items), 'judged': len(dec), 'unparsed': unparsed, 'panels': {}}
    for L in LANGS + [None]:
        name = L or 'pooled'
        out['panels'][name] = {'arms': {a: arm_tab(L, a) for a in (CUR, PLAIN, CUR2)},
                               'PLAIN-CUR': paired(L, PLAIN, CUR), 'floor CUR2-CUR': paired(L, CUR2, CUR),
                               'PLAIN-CUR on floor pages': None}
        fl = [i for i in arms_items(L) if fid(i, CUR2) is not None]
        if fl:
            d = lambda s: mean([fid(i, PLAIN) - fid(i, CUR) for i in s if fid(i, PLAIN) is not None])
            out['panels'][name]['PLAIN-CUR on floor pages'] = {'n': len(fl), 'mean': r3(d(fl)), 'ci_by_work': boot(fl, d)}
    # plants: located at the planted span (non-twin)
    pr = []
    for i, k in items.items():
        if k['kind'] != 'PLANT' or i not in dec: continue
        d = dec[i].get(f'{F}-CUR_PLANT')
        if not d: continue
        text = texts[i][d['label']]; pl = k['plant']
        pos = norm_ws(text).find(norm_ws(pl['new'])[:60])
        region = (pos, pos + len(norm_ws(pl['new']))) if pos >= 0 else None
        quotes = [s['quote'] for s in d['spans']] + ([d['revq']] if d['revq'] else [])
        located = bool(region) and any((lambda loc: loc and loc[0] < region[1] + 20 and loc[1] > region[0] - 20)(locate(q, text)) for q in quotes)
        pr.append({'item': i, 'lang': k['lang'], 'kind': pl['kind'], 'how': pl.get('how'), 'located': located, 'fid': d['fid']})
    out['plants'] = {'n': len(pr), 'located': sum(r['located'] for r in pr), 'rows': pr}
    return out


def mech():
    """Per arm: output tokens, body / raw characters, interpretive-tag share, did-not-read."""
    res = {}
    for tag, st in BODIES['stats'].items():
        rows = list(st.values())
        ot = [r['out_tok'] for r in rows if r['out_tok'] is not None]
        th = [r['think_tok'] for r in rows if r['think_tok'] is not None]
        raw = sum(r['raw_chars'] for r in rows); tags = {}
        for r in rows:
            for k, v in r['tags'].items(): tags[k] = tags.get(k, 0) + v
        res[tag] = {'reads': len(rows), 'did_not_read': len(BODIES['dnr'].get(tag, {})), 'dnr_why': sorted(set(BODIES['dnr'].get(tag, {}).values())),
                    'out_tok_mean': r3(mean(ot)), 'out_tok_median': statistics.median(ot) if ot else None,
                    'think_tok_mean': r3(mean(th)) if th else None,
                    'secs_median': statistics.median([r['secs'] for r in rows if r['secs'] is not None]) if rows else None,
                    'raw_chars_mean': r3(raw / len(rows)) if rows else None, 'body_chars_mean': r3(mean([r['body_chars'] for r in rows])),
                    'tag_share_of_raw': {k: round(v / raw, 4) for k, v in sorted(tags.items())} if raw else {}}
    # paired output tokens PLAIN vs CUR, per family
    for F in ('G', 'O'):
        a, b = BODIES['stats'].get(f'{F}-PLAIN', {}), BODIES['stats'].get(f'{F}-CUR', {})
        us = [u for u in a if u in b and a[u]['out_tok'] is not None and b[u]['out_tok'] is not None]
        if us:
            d = lambda s: mean([a[u]['out_tok'] - b[u]['out_tok'] for u in s])
            rel = lambda s: sum(a[u]['out_tok'] for u in s) / sum(b[u]['out_tok'] for u in s) - 1
            res[f'{F} out_tok PLAIN-CUR'] = {'n': len(us), 'mean': r3(d(us)), 'ci_by_work': boot(us, d), 'relative': r3(rel(us)), 'relative_ci': boot(us, rel)}
            bd = lambda s: sum(a[u]['body_chars'] for u in s) / sum(b[u]['body_chars'] for u in s) - 1
            res[f'{F} body_chars PLAIN/CUR-1'] = {'n': len(us), 'relative': r3(bd(us)), 'ci_by_work': boot(us, bd)}
    return res


if __name__ == '__main__':
    S = {'mechanical': mech()}
    for F in ('G', 'O'):
        if os.path.exists(f'{W}/judge/{F}/key.json'): S[F] = family(F)
    os.makedirs(RESULTS, exist_ok=True)
    json.dump(S, open(f'{RESULTS}/scores.json', 'w'), ensure_ascii=False, indent=1)
    for F in ('G', 'O'):
        if F not in S: continue
        s = S[F]
        print(f"\n== {F} arms, judge {s['judge']}: {s['judged']}/{s['items']} judged, unparsed {len(s['unparsed'])}; plants located {s['plants']['located']}/{s['plants']['n']}")
        for L, p in s['panels'].items():
            a = p['arms']; c, pl = a.get(f'{F}-CUR'), a.get(f'{F}-PLAIN')
            if not c or not pl: continue
            print(f"{L:9s} n={c['n']:3d} CUR {c['fidelity']:.2f} PLAIN {pl['fidelity']:.2f}  PLAIN-CUR {p['PLAIN-CUR']['mean']:+.2f} {p['PLAIN-CUR']['ci_by_work']} W/L/T {p['PLAIN-CUR']['wins']}/{p['PLAIN-CUR']['losses']}/{p['PLAIN-CUR']['ties']}"
                  + (f"  floor {p['floor CUR2-CUR']['mean']:+.2f} {p['floor CUR2-CUR']['ci_by_work']} (n={p['floor CUR2-CUR']['n']})" if p['floor CUR2-CUR'] else '')
                  + f"  rev {c['reversal_pages']}/{pl['reversal_pages']} om {c['omission_pages']}/{pl['omission_pages']} acc {c['acc_spans_per_page']}/{pl['acc_spans_per_page']} inv {c['invention_per_page']}/{pl['invention_per_page']}")
    print('\nmechanical:')
    for k, v in S['mechanical'].items(): print(' ', k, json.dumps(v, ensure_ascii=False))
