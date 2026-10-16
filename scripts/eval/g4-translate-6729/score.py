#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/score.py — decode(), the by-work bootstrap, plant location (`locate`) and
# the arm tables are its code, cut to #6729's three arms; `norm` comes unchanged from pareto-6182/score-xl.py.
# Agreement goes through scripts/eval/lib/agreement-stats.mjs (judgeReliability, PR #6730) via alpha.mjs, not through
# #6545's own kalpha. New here: both orders per page (mean of the two; their difference is test–retest and position),
# and the recitation check (longest word n-gram shared with the published reference).
"""
score.py — $0. Scores #6729's judging round. Reads $W/judge/r1/{key.json, texts.json, opus/out-*.jsonl, g38/out.jsonl},
the arm rows in $W/arms/ and the #6182 records (reference text). Writes scripts/eval/results/g4-translate-6729/scores.json
(numbers only, no reference text) and $W/recitation.json (the shared strings, for the by-eye read; stays in $W).
"""
import importlib.util, json, os, random, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
P6545 = os.path.join(HERE, '..', 'pro-translate-6545')
sys.path.insert(0, P6545)
from common import W, read, records, panel_uids
from prompts import unwrap
from arms import load

spec = importlib.util.spec_from_file_location('scorexl', os.path.join(HERE, '..', 'pareto-6182', 'score-xl.py'))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)

RESULTS = 'scripts/eval/results/g4-translate-6729'
J = f'{W}/judge/r1'
KEY = json.load(open(f'{J}/key.json'))
TEXTS = json.load(open(f'{J}/texts.json'))
ITEMS = KEY['items']
LANGS = KEY['langs']
ARMS = ['G4L', 'OPUS', 'C38S']
JUDGES = ['opus', 'g38']
B = 2000
FLAG = 12


def parse_obj(raw):
    t, _ = unwrap(raw)
    m = re.search(r'\{[\s\S]*\}', t)
    if not m: return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def load_judges():
    out = {'opus': {}, 'g38': {}}
    d = f'{J}/opus'
    for f in sorted(os.listdir(d)):
        if f.startswith('out-'):
            for l in open(f'{d}/{f}', encoding='utf-8'):
                if l.strip():
                    try:
                        o = json.loads(l); out['opus'][o['id']] = o
                    except (ValueError, KeyError):
                        pass
    p = f'{J}/g38/out.jsonl'
    if os.path.exists(p):
        for r in read(p):
            o = parse_obj(r.get('text') or '')
            if o and r['uid'] in ITEMS: out['g38'][r['uid']] = o
    return out


def decode(o, labels):
    tier = {}
    for t, grp in enumerate(o.get('ranking') or []):
        for l in (grp if isinstance(grp, list) else [grp]):
            tier[l] = t
    res = {}
    for l, s in (o.get('scores') or {}).items():
        if l not in labels or not isinstance(s, dict): continue
        try:
            n = sx.norm(s, tier.get(l))
            n['fid'] = None if n['fid'] is None else float(n['fid'])
        except Exception:
            continue
        n['spans'] = [x for x in (s.get('spans') or []) if isinstance(x, dict) and x.get('quote')]
        n['revq'] = (s.get('reversal') or {}).get('candidate') if isinstance(s.get('reversal'), dict) else None
        n['label'] = l; n['slot'] = int(l[1:])
        res[labels[l]] = n
    return res


RAW = load_judges()
DEC = {j: {i: decode(o, ITEMS[i]['labels']) for i, o in RAW[j].items() if i in ITEMS} for j in RAW}
mean = lambda x: sum(x) / len(x) if x else None
r3 = lambda x: None if x is None else round(x, 3)


def boot(pages, stat, seed=6729):
    if len(pages) < 2: return None
    rng = random.Random(seed); vals = []
    for _ in range(B):
        v = stat([pages[rng.randrange(len(pages))] for _ in pages])
        if v is not None: vals.append(v)
    vals.sort()
    return [round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3)] if vals else None


# per page: {(judge, page, arm): {'ORD1': dec, 'ORD2': dec}}
PAGE = {}
for j in JUDGES:
    for i, d in DEC[j].items():
        k = ITEMS[i]
        if k['kind'] not in ('ORD1', 'ORD2'): continue
        for a, n in d.items():
            PAGE.setdefault((j, k['page_id'], a), {})[k['kind']] = n
PAGES = {L: [u for u in panel_uids(L)] for L in LANGS}


def pf(j, u, a, field='fid'):
    """Page value: mean over the orders the judge returned."""
    v = [n[field] for n in PAGE.get((j, u, a), {}).values() if n.get(field) is not None]
    return mean([float(x) for x in v]) if v else None


def panel(j, L, a):
    us = [u for u in PAGES[L] if pf(j, u, a) is not None]
    if not us: return None
    f = lambda d: mean([pf(j, u, a) for u in d])
    return {'n': len(us), 'fidelity': r3(f(us)), 'ci_by_book': boot(us, f), 'reversals_per_100': round(100 * mean([pf(j, u, a, 'rev') for u in us]), 1),
            'omission_per_100': round(100 * mean([pf(j, u, a, 'om') for u in us]), 1)}


def paired(j, us, x, y):
    us = [u for u in us if pf(j, u, x) is not None and pf(j, u, y) is not None]
    if not us: return None
    d = lambda s: mean([pf(j, u, x) - pf(j, u, y) for u in s])
    w = sum(pf(j, u, x) > pf(j, u, y) for u in us); l = sum(pf(j, u, x) < pf(j, u, y) for u in us)
    return {'n': len(us), 'mean': r3(d(us)), 'ci_by_book': boot(us, d), 'wins': w, 'losses': l, 'ties': len(us) - w - l}


def paired_by_order(j, us, x, y, order):
    vals = []
    for u in us:
        a, b = PAGE.get((j, u, x), {}).get(order), PAGE.get((j, u, y), {}).get(order)
        if a and b and a['fid'] is not None and b['fid'] is not None: vals.append(a['fid'] - b['fid'])
    return {'n': len(vals), 'mean': r3(mean(vals))}


def position(j):
    by = {}
    for (jj, u, a), o in PAGE.items():
        if jj != j: continue
        for n in o.values():
            if n['fid'] is not None: by.setdefault(n['slot'], []).append(n['fid'])
    swings = [abs(o['ORD1']['fid'] - o['ORD2']['fid']) for (jj, u, a), o in PAGE.items() if jj == j and 'ORD1' in o and 'ORD2' in o
              and o['ORD1']['fid'] is not None and o['ORD2']['fid'] is not None]
    # slot effect paired within page×arm: fid when first minus fid when last
    fl = []
    for (jj, u, a), o in PAGE.items():
        if jj != j or len(o) < 2: continue
        s = {n['slot']: n['fid'] for n in o.values() if n['fid'] is not None}
        if 1 in s and 3 in s: fl.append(s[1] - s[3])
    return {'mean_by_slot': {f'T{k}': r3(mean(v)) for k, v in sorted(by.items())}, 'first_minus_last_same_text': r3(mean(fl)), 'n_first_last': len(fl),
            'order_swing_mean_abs': r3(mean(swings)), 'order_disagree_share': r3(mean([s > 0 for s in swings]))}


# ---------- agreement via agreement-stats.mjs ----------
def reliability():
    req = {}
    for field, level in (('fid', 'ordinal'), ('rev', 'nominal')):
        name = 'fidelity' if field == 'fid' else 'reversal'
        units = []
        for L in LANGS:
            for u in PAGES[L]:
                for a in ARMS:
                    for o in ('ORD1', 'ORD2'):
                        v = [PAGE.get((j, u, a), {}).get(o, {}).get(field) for j in JUDGES]
                        units.append({'cluster': u, 'values': [None if x is None else float(x) for x in v]})
        req[f'Opus–Gemini 3.8 {name}'] = {'level': level, 'units': units, 'unit': 'page×arm×order units'}
        for L in LANGS:
            req[f'Opus–Gemini 3.8 {name}, {L}'] = {'level': level, 'unit': 'page×arm×order units',
                                                   'units': [x for x in units if x['cluster'] in PAGES[L]]}
        for j in JUDGES:
            us = []
            for L in LANGS:
                for u in PAGES[L]:
                    for a in ARMS:
                        o = PAGE.get((j, u, a), {})
                        us.append({'cluster': u, 'values': [None if o.get(k, {}).get(field) is None else float(o[k][field]) for k in ('ORD1', 'ORD2')]})
            req[f'{j} test–retest (two orders) {name}'] = {'level': level, 'units': us, 'unit': 'page×arm units'}
    return json.loads(subprocess.check_output(['node', os.path.join(HERE, 'alpha.mjs')], input=json.dumps(req).encode()))


# ---------- plants ----------
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


def plants():
    res = {}
    for j in JUDGES:
        rows = []
        for i, k in ITEMS.items():
            if k['kind'] != 'PLANT' or i not in DEC[j]: continue
            d = DEC[j][i].get('C38_PLANT')
            if not d: continue
            text = TEXTS[i][d['label']]; pl = k['plant']
            pos = norm_ws(text).find(norm_ws(pl['new'])[:60])
            region = (pos, pos + len(norm_ws(pl['new']))) if pos >= 0 else None
            located = False
            if region:
                for q in [s['quote'] for s in d['spans']] + ([d['revq']] if d['revq'] else []):
                    loc = locate(q, text)
                    if loc and loc[0] < region[1] + 20 and loc[1] > region[0] - 20: located = True
            rows.append({'item': i, 'lang': k['lang'], 'kind': pl['kind'], 'located': located, 'fid': d['fid']})
        res[j] = {'n': len(rows), 'located': sum(r['located'] for r in rows),
                  'by_kind': {kd: [sum(r['located'] for r in rows if r['kind'] == kd), sum(1 for r in rows if r['kind'] == kd)] for kd in sorted({r['kind'] for r in rows})},
                  'rows': rows}
    return res


# ---------- recitation: longest shared word n-gram with the published reference ----------
TAG = re.compile(r'</?[a-z][a-z-]*[^>]*>|<<<\s*(BEGIN|END)\s*>>>|->|<-|\[context\]', re.I)
WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def words(t):
    return WORD.findall(TAG.sub(' ', t or '').lower().replace('’', "'"))


def longest_shared(a, b):
    best, end = 0, 0
    prev = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        ai = a[i - 1]
        for k in range(1, len(b) + 1):
            if ai == b[k - 1]:
                cur[k] = prev[k - 1] + 1
                if cur[k] > best: best, end = cur[k], i
        prev = cur
    return best, ' '.join(a[end - best:end])


def recitation():
    recs = records()
    uids = [u for L in LANGS for u in PAGES[L]]
    texts, _, _ = load(uids, ARMS)
    per, private = {}, {}
    for L in LANGS:
        rows = {}
        for a in ARMS:
            lens = []
            for u in PAGES[L]:
                if u not in texts[a]: continue
                ref = words(recs[u]['reference_text'])
                n, s = longest_shared(words(texts[a][u]), ref)
                lens.append(n)
                private.setdefault(u, {'lang': L})[a] = {'n': n, 'shared': s}
            flagged = [u for u in PAGES[L] if private.get(u, {}).get(a, {}).get('n', 0) > FLAG]
            srt = sorted(lens)
            rows[a] = {'n': len(lens), 'median': srt[len(srt) // 2] if srt else None, 'max': max(lens) if lens else None,
                       'flagged_gt12': len(flagged), 'flagged_pages': flagged}
        per[L] = rows
    json.dump(private, open(f'{W}/recitation.json', 'w'), ensure_ascii=False, indent=1)
    return per


def main():
    out = {'langs': LANGS, 'arms': ARMS, 'judged_items': {j: len(DEC[j]) for j in JUDGES}, 'items': len(ITEMS),
           'failed_reads': {a: len(v) for a, v in KEY['failed_reads'].items()}, 'failed_reads_detail': KEY['failed_reads'], 'panels': {}, 'pooled': {}}
    allp = [u for L in LANGS for u in PAGES[L]]
    for L in LANGS:
        p = {'pages': len(PAGES[L]), 'by_judge': {}}
        for j in JUDGES:
            p['by_judge'][j] = {'arms': {a: panel(j, L, a) for a in ARMS},
                                'G4L-OPUS': paired(j, PAGES[L], 'G4L', 'OPUS'), 'G4L-C38S': paired(j, PAGES[L], 'G4L', 'C38S'),
                                'OPUS-C38S': paired(j, PAGES[L], 'OPUS', 'C38S'),
                                'G4L-OPUS_by_order': {o: paired_by_order(j, PAGES[L], 'G4L', 'OPUS', o) for o in ('ORD1', 'ORD2')}}
        out['panels'][L] = p
    for j in JUDGES:
        out['pooled'][j] = {'G4L-OPUS': paired(j, allp, 'G4L', 'OPUS'), 'G4L-C38S': paired(j, allp, 'G4L', 'C38S'), 'OPUS-C38S': paired(j, allp, 'OPUS', 'C38S'),
                            'position': position(j)}
    out['reliability'] = {k: {kk: v[kk] for kk in ('alpha', 'ci', 'n_units', 'level', 'verdict', 'line')} for k, v in reliability().items()}
    out['plants'] = plants()
    out['recitation'] = recitation()
    # the rule (DESIGN.md), mechanical part; the by-eye recitation read is added by hand in the experiment file
    rule = {}
    for L in LANGS:
        d = [out['panels'][L]['by_judge'][j]['G4L-OPUS'] for j in JUDGES]
        fails = len([u for u in KEY['failed_reads'].get('G4L', {}) if u in PAGES[L]])
        rec = out['recitation'][L]
        excess_count = rec['G4L']['flagged_gt12'] - rec['OPUS']['flagged_gt12'] >= 3
        if any(x is None or x['ci_by_book'] is None for x in d): rule[L] = 'incomplete'; continue
        above = all(x['ci_by_book'][0] > 0 for x in d); below = any(x['ci_by_book'][1] < 0 for x in d)
        within = all(x['ci_by_book'][0] <= 0 <= x['ci_by_book'][1] for x in d)
        ok = fails <= 0.1 * len(PAGES[L]) and not excess_count
        rule[L] = {'G4L_failed': fails, 'recitation_excess_by_count': excess_count,
                   'verdict': ('G4L replaces Opus' if above and ok else 'G4L joins as an equal' if within and ok else 'Opus stays') + (' (pending by-eye recitation read)' if (above or within) and ok else '')}
    out['rule'] = rule
    os.makedirs(RESULTS, exist_ok=True)
    json.dump(out, open(f'{RESULTS}/scores.json', 'w'), ensure_ascii=False, indent=1)
    # summary
    for L in LANGS:
        print(f"\n== {L} ({out['panels'][L]['pages']} pages)  rule: {rule[L]}")
        for j in JUDGES:
            b = out['panels'][L]['by_judge'][j]
            print(f"  {j:5s} " + '  '.join(f"{a} {x['fidelity']} {x['ci_by_book']} rev{x['reversals_per_100']}" for a, x in b['arms'].items() if x))
            for k in ('G4L-OPUS', 'G4L-C38S', 'OPUS-C38S'):
                x = b[k]
                if x: print(f"        {k}: {x['mean']:+} {x['ci_by_book']} W/L/T {x['wins']}/{x['losses']}/{x['ties']}")
        print('  recitation', {a: (v['median'], v['max'], v['flagged_gt12']) for a, v in out['recitation'][L].items()})
    print('\npooled', json.dumps(out['pooled'], indent=None)[:1500])
    for v in out['reliability'].values(): print(v['line'])
    print('plants', {j: (v['located'], v['n'], v['by_kind']) for j, v in out['plants'].items()})


if __name__ == '__main__':
    main()
