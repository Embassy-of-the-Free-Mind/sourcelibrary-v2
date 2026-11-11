#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/score.py — parse_obj, decode (with score-xl.py's `norm`), locate, the
# page bootstrap and the plant catch (a judge quote located at the planted sentence) are its code, cut to one judge and
# two arms. New here: the paired O10 − O1 table by run, a run-clustered bootstrap, the judge's boundary/span calls,
# a mechanical page-boundary bleed count (a sentence of one arm's page that matches only the other arm's NEIGHBOURING
# page), and quota per 100 pages from the CLI's own usage block.
"""
score.py — $0. Reads $W/judge/{key.json, texts.json, out.jsonl}, $W/arms/{O1,O10}.jsonl, $W/pages.jsonl. Writes
scripts/eval/results/opus10-6690/scores.json (numbers only, no source or reference text) and prints a summary.
"""
import importlib.util, json, os, random, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
W = os.environ.get('W6690', os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'w'))
RESULTS = os.path.join(HERE, '..', 'results', 'opus10-6690')
sys.path.insert(0, os.path.join(HERE, '..', 'pro-translate-6545'))
from prompts import unwrap
spec = importlib.util.spec_from_file_location('scorexl', os.path.join(HERE, '..', 'pareto-6182', 'score-xl.py'))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)
read = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
B = 2000
RUNS = ['fa', 'sa', 'zh', 'grc', 'he']

KEY = json.load(open(f'{W}/judge/key.json')); ITEMS = KEY['items']
TEXTS = json.load(open(f'{W}/judge/texts.json'))
PAGES = read(f'{W}/pages.jsonl')


def parse_obj(raw):
    t, _ = unwrap(raw)
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
        n['span'] = s.get('span')
        n['revq'] = (s.get('reversal') or {}).get('candidate') if isinstance(s.get('reversal'), dict) else None
        n['label'] = l
        res[labels[l]] = n
    return res


RAW = {}
if os.path.exists(f'{W}/judge/out.jsonl'):
    for r in read(f'{W}/judge/out.jsonl'):
        o = parse_obj(r.get('text') or r.get('raw') or '')
        if o and r['uid'] in ITEMS: RAW[r['uid']] = o
DEC = {i: decode(o, ITEMS[i]['labels']) for i, o in RAW.items()}
mean = lambda x: sum(x) / len(x) if x else None
norm_ws = lambda s: re.sub(r'\s+', ' ', s).strip().lower()


def ci(vals):
    vals = sorted(v for v in vals if v is not None)
    return [round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3)] if vals else None


def boot(rows, stat, seed=6690):
    rng = random.Random(seed)
    return ci([stat([rows[rng.randrange(len(rows))] for _ in rows]) for _ in range(B)]) if len(rows) > 1 else None


def boot_cluster(rows, run_of, stat, seed=6690):
    """Resample runs, then pages within each drawn run: the 5 runs are 5 books, pages within a book are not independent."""
    rng = random.Random(seed); by = {}
    for r in rows: by.setdefault(run_of(r), []).append(r)
    ks = list(by); out = []
    for _ in range(B):
        d = []
        for k in (ks[rng.randrange(len(ks))] for _ in ks):
            g = by[k]; d += [g[rng.randrange(len(g))] for _ in g]
        out.append(stat(d))
    return ci(out)


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


def arms_items(kind='ARMS', run=None):
    return [i for i, k in ITEMS.items() if k['kind'] == kind and (run is None or k['run'] == run)]


def fid(i, a):
    d = DEC.get(i, {}).get(a)
    return d['fid'] if d and d['fid'] is not None else None


def arm_table(items):
    out = {}
    for a in ('O1', 'O10'):
        rows = [i for i in items if fid(i, a) is not None]
        if not rows: continue
        g = lambda i, k: DEC[i][a][k]
        out[a] = {'n': len(rows), 'fidelity': round(mean([fid(i, a) for i in rows]), 3), 'ci_by_page': boot(rows, lambda d: mean([fid(i, a) for i in d])),
                  'reversals_per_100': round(100 * mean([g(i, 'rev') for i in rows]), 1), 'omission_pct': round(100 * mean([g(i, 'om') for i in rows]), 1),
                  'acc_spans_per_page': round(mean([len([s for s in g(i, 'spans') if s.get('type') == 'accuracy']) for i in rows]), 2),
                  'major_acc_spans_per_page': round(mean([len([s for s in g(i, 'spans') if s.get('type') == 'accuracy' and s.get('severity') == 'major']) for i in rows]), 2),
                  'boundary_inventions': sum(1 for i in rows for x in g(i, 'inv') if x.get('kind') == 'boundary'),
                  'boundary_pages': sum(1 for i in rows if any(x.get('kind') == 'boundary' for x in g(i, 'inv'))),
                  'unreadable_fill_pages': sum(1 for i in rows if any(x.get('kind') == 'unreadable_fill' for x in g(i, 'inv'))),
                  'span_not_same': {s: sum(1 for i in rows if g(i, 'span') == s) for s in ('starts_later', 'ends_earlier', 'extends_before', 'extends_after', 'different', 'cant_tell')}}
    return out


def paired(items, cluster=False):
    rows = [i for i in items if fid(i, 'O1') is not None and fid(i, 'O10') is not None]
    if not rows: return None
    d = lambda s: mean([fid(i, 'O10') - fid(i, 'O1') for i in s])
    w = sum(1 for i in rows if fid(i, 'O10') > fid(i, 'O1')); l = sum(1 for i in rows if fid(i, 'O10') < fid(i, 'O1'))
    out = {'n': len(rows), 'mean_O10_minus_O1': round(d(rows), 3), 'ci_by_page': boot(rows, d), 'O10_better': w, 'O10_worse': l, 'ties': len(rows) - w - l,
           'worse_pages': [{'item': i, 'page': ITEMS[i]['page_id'][-5:], 'run': ITEMS[i]['run'], 'O1': fid(i, 'O1'), 'O10': fid(i, 'O10')} for i in rows if fid(i, 'O10') < fid(i, 'O1')]}
    if cluster: out['ci_by_run_then_page'] = boot_cluster(rows, lambda i: ITEMS[i]['run'], d)
    return out


def plants():
    rows = []
    for i, k in ITEMS.items():
        if k['kind'] != 'PLANT' or i not in DEC: continue
        d = DEC[i].get('O1_PLANT')
        if not d: continue
        text = TEXTS[i][d['label']]; pl = k['plant']
        pos = norm_ws(text).find(norm_ws(pl['new'])[:60])
        region = (pos, pos + len(norm_ws(pl['new']))) if pos >= 0 else None
        quotes = [s['quote'] for s in d['spans']] + ([d['revq']] if d['revq'] else [])
        located = bool(region) and any((lambda loc: loc and loc[0] < region[1] + 20 and loc[1] > region[0] - 20)(locate(q, text)) for q in quotes)
        ai = next((a for a, kk in ITEMS.items() if kk['kind'] == 'ARMS' and kk['page_id'] == k['page_id']), None)
        ref = fid(ai, 'O1') if ai else None
        rows.append({'item': i, 'run': k['run'], 'kind': pl['kind'], 'how': pl.get('how'), 'located': located, 'fid': d['fid'], 'O1_fid_unplanted': ref,
                     'lower': d['fid'] is not None and ref is not None and d['fid'] < ref})
    return {'n': len(rows), 'located': sum(r['located'] for r in rows), 'lower': sum(r['lower'] for r in rows), 'rows': rows}


def repeats():
    rows = []
    for i, k in ITEMS.items():
        if k['kind'] != 'REPEAT' or i not in DEC: continue
        a = next((x for x, kk in ITEMS.items() if kk['kind'] == 'ARMS' and kk['page_id'] == k['page_id']), None)
        for arm in ('O1', 'O10'):
            if fid(a, arm) is not None and fid(i, arm) is not None: rows.append((fid(a, arm), fid(i, arm), arm, k['page_id'][-5:]))
    same = sum(1 for x, y, *_ in rows if x == y)
    deltas = []
    for i, k in ITEMS.items():
        if k['kind'] != 'REPEAT' or i not in DEC: continue
        a = next((x for x, kk in ITEMS.items() if kk['kind'] == 'ARMS' and kk['page_id'] == k['page_id']), None)
        if all(fid(z, arm) is not None for z in (a, i) for arm in ('O1', 'O10')):
            deltas.append((fid(a, 'O10') - fid(a, 'O1'), fid(i, 'O10') - fid(i, 'O1')))
    return {'scores': len(rows), 'identical': same, 'mean_abs_diff': round(mean([abs(x - y) for x, y, *_ in rows]), 3) if rows else None,
            'delta_pairs': deltas, 'delta_same_sign_or_both_zero': sum(1 for x, y in deltas if (x > 0) == (y > 0) and (x < 0) == (y < 0))}


# ---------- mechanical page-boundary bleed ----------
STOP = set('the and that this with from have which they their them then there were what when will would shall should into upon your '
           'been also more than such some only very said thou thee hath doth other these those whom whose where while about after before '
           'because being does each every here itself like most much must never over same since through under until well whether'.split())


def body(t):
    t = re.sub(r'<(summary|keywords|note|meta|image-desc|vocab|page-num|header|sig)[^>]*>[\s\S]*?</\1>', ' ', t or '')
    return re.sub(r'<[^>]+>', ' ', t)


cw = lambda s: [w for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 3 and w not in STOP]


def sentences(t):
    return [s for s in re.split(r'(?<=[.!?;:])\s+|\n+', body(t)) if len(set(cw(s))) >= 6]


def bleed(o1, o10):
    """A sentence of arm X's page k is MOVED when ≥ 60% of its content words are in arm Y's page k±1 and < 40% in Y's page k.
    Counted both ways (O10 sentences against O1 pages, and O1 sentences against O10 pages): the first finds text the block
    put on the wrong page, the second text the block took away from its page; together, text moved across a turn."""
    out = {'O10_vs_O1': [], 'O1_vs_O10': []}
    for run in RUNS:
        P = sorted([p for p in PAGES if p['run'] == run], key=lambda p: p['page_number'])
        for x, y, name in ((o10, o1, 'O10_vs_O1'), (o1, o10, 'O1_vs_O10')):
            bag = {p['uid']: set(cw(body(y.get(p['uid'], '')))) for p in P}
            for k, p in enumerate(P):
                for s in sentences(x.get(p['uid'], '')):
                    ws = set(cw(s)); own = len(ws & bag[p['uid']]) / len(ws)
                    for dk in (-1, 1):
                        if 0 <= k + dk < len(P):
                            nb = len(ws & bag[P[k + dk]['uid']]) / len(ws)
                            if nb >= 0.6 and own < 0.4:
                                out[name].append({'run': run, 'page': p['page_number'], 'to_neighbour': dk, 'own': round(own, 2), 'nb': round(nb, 2), 'words': len(ws)})
    return {k: {'sentences': len(v), 'pages': len({(r['run'], r['page']) for r in v}), 'rows': v} for k, v in out.items()}


def lengths(o1, o10):
    r = []
    for p in PAGES:
        a, b = len(body(o1.get(p['uid'], ''))), len(body(o10.get(p['uid'], '')))
        if a and b: r.append(b / a)
    r.sort()
    return {'n': len(r), 'median_O10_over_O1': round(r[len(r) // 2], 3), 'p10': round(r[len(r) // 10], 3), 'p90': round(r[9 * len(r) // 10], 3),
            'below_0.8': sum(1 for x in r if x < 0.8), 'above_1.25': sum(1 for x in r if x > 1.25)}


def quota():
    def agg(rows, pages):
        s = {'calls': 0, 'output_tokens': 0, 'cache_creation': 0, 'cache_read': 0, 'list_usd': 0.0, 'secs': 0.0}
        for r in rows:
            for u in r['usage']:
                s['calls'] += 1; s['output_tokens'] += u.get('output') or 0; s['cache_creation'] += u.get('cache_creation') or 0
                s['cache_read'] += u.get('cache_read') or 0; s['list_usd'] += u.get('list_cost_usd') or 0
            s['secs'] += r['secs']
        per = {k: round(v / pages * 100, 2) for k, v in s.items()}
        return {'pages': pages, 'total': {k: round(v, 2) for k, v in s.items()}, 'per_100_pages': per}
    o1 = [r for r in read(f'{W}/arms/O1.jsonl') if r.get('text')]
    o10 = [r for r in read(f'{W}/arms/O10.jsonl') if r.get('pages_text')]
    return {'O1': agg(o1, len(o1)), 'O10': agg(o10, sum(len(r['pages_text']) for r in o10)),
            'note': 'O1 counts the 45 one-page calls made here; the 5 anchor pages reuse #6545 OPUS rows, which kept no usage.'}


def main():
    o1 = {}
    for r in read('/mnt/HC_Volume_105839809/jobs/pro-translate-6545/w/arms/OPUS.jsonl'):
        if r.get('text'): o1[r['uid']] = r['text']
    for r in read(f'{W}/arms/O1.jsonl'):
        if r.get('text'): o1[r['uid']] = r['text']
    o10 = {}
    for r in read(f'{W}/arms/O10.jsonl'):
        if r.get('pages_text'): o10.update(r['pages_text'])
    allA = arms_items()
    S = {'judge': 'gemini-3.8-flash-high (agy -p), one item per call, #6545 JUDGE-PROMPT-PRO.md', 'items_judged': len(DEC), 'items': len(ITEMS),
         'arms': arm_table(allA), 'paired_all': paired(allA, cluster=True),
         'by_run': {r: {'arms': arm_table(arms_items(run=r)), 'paired': paired(arms_items(run=r))} for r in RUNS},
         'anchor_vs_rest': {'anchor': paired([i for i in allA if ITEMS[i]['page_id'] in {p['uid'] for p in PAGES if p['anchor']}]),
                            'non_anchor': paired([i for i in allA if ITEMS[i]['page_id'] in {p['uid'] for p in PAGES if not p['anchor']}])},
         'by_position_in_block': {str(k): paired([i for i in allA if ITEMS[i]['page_id'] in {p['uid'] for p in PAGES if (p['page_number'] - min(q['page_number'] for q in PAGES if q['run'] == p['run'])) in k}])
                                  for k in ((0,), (1, 2, 3, 4), (5, 6, 7, 8), (9,))},
         'plants': plants(), 'repeats': repeats(), 'bleed_mechanical': bleed(o1, o10), 'lengths': lengths(o1, o10), 'quota': quota()}
    os.makedirs(RESULTS, exist_ok=True)
    json.dump(S, open(f'{RESULTS}/scores.json', 'w'), ensure_ascii=False, indent=1)
    pa = S['paired_all']
    print('judged', len(DEC), '/', len(ITEMS))
    for a, t in S['arms'].items(): print(a, {k: v for k, v in t.items() if k != 'span_not_same'}, t['span_not_same'])
    if pa: print('O10-O1', {k: v for k, v in pa.items() if k != 'worse_pages'})
    for r in RUNS:
        p = S['by_run'][r]['paired']
        if p: print(' ', r, p['n'], p['mean_O10_minus_O1'], p['ci_by_page'], f"+{p['O10_better']}/-{p['O10_worse']}/={p['ties']}",
                    {a: S['by_run'][r]['arms'][a]['fidelity'] for a in S['by_run'][r]['arms']})
    print('position', {k: (v['n'], v['mean_O10_minus_O1']) if v else None for k, v in S['by_position_in_block'].items()})
    print('plants', {k: v for k, v in S['plants'].items() if k != 'rows'}); print('repeats', S['repeats'])
    print('bleed', {k: {kk: vv for kk, vv in v.items() if kk != 'rows'} for k, v in S['bleed_mechanical'].items()})
    print('lengths', S['lengths']); print('quota', json.dumps(S['quota'], indent=None))


if __name__ == '__main__':
    main()
