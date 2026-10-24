#!/usr/bin/env python3
"""score_confirm.py — score guarded Paddle against agy Flash on the fresh table + mixed draw (#6871 row 3).

PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/score.py (page_scores / scored / median / boot_ci, imported
unchanged); this adds the guarded arm (guard.py over P0 + ink.py), the guard's catch / pass rates and the bar exactly
as preregistered in scripts/eval/experiments/2026-10-18-zh-guarded-paddle-prereg-6871.md.

  python3 score_confirm.py > results.json      (reads refs.jsonl, ink-fresh.jsonl, out/{P0,B2,B2r}.jsonl[.gz] here)
"""
import gzip, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'zh-residue-bakeoff-6871'))
sys.path.insert(0, HERE)
import score  # noqa: E402
from score import page_scores, scored, median, boot_ci, ref_strings, hyp_string  # noqa: E402
from guard import guard, K  # noqa: E402

CLASSES = ['table', 'mixed']
BAKEOFF_FLOOR = {'table': 0.008, 'mixed': 0.018}  # bake-off B1 vs B1r median |Δ| (results.json there)


def rows(path):
    for p in (path, path + '.gz'):
        if os.path.exists(p):
            return [json.loads(l) for l in (gzip.open(p, 'rt') if p.endswith('.gz') else open(p)) if l.strip()]
    return []


def texts(name):
    out = {}
    for r in rows(os.path.join(HERE, 'out', name + '.jsonl')):
        out[r.get('page_id') or r.get('uid')] = r.get('text') or ''
    return out


def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]


def failure(r, hyp_text):
    """Preregistered: collapsed / looped P0 output, from the reference."""
    ref = len(ref_strings(r)[0])
    t = r['text'] or ''
    hyp = len(hyp_string(hyp_text, r.get('margin')))
    if r['page_kind'] != 'body':  # blank set
        from collections import Counter
        from compare import han
        allowed = Counter(han(t + (r.get('margin') or ''), box=False))
        return 'loop' if sum((Counter(han(hyp_text or '', box=False)) - allowed).values()) >= 20 else ''
    if ref >= 20 and hyp < 0.5 * ref: return 'collapse'
    if hyp > 1.5 * (ref + t.count('▣') + t.count('□')) + 20: return 'loop'
    return ''


def main():
    refs = [json.loads(l) for l in open(os.path.join(HERE, 'refs.jsonl'))]
    ink = {json.loads(l)['page_id']: json.loads(l) for l in open(os.path.join(HERE, 'ink-fresh.jsonl'))}
    P0, B2, B2r = texts('P0'), texts('B2'), texts('B2r')
    res = {'guard_constants': K, 'pages': {}, 'classes': {}, 'routes': {}, 'guard_test': {}, 'bar': {}}
    for r in refs:
        pid = r['page_id']
        g = guard(P0.get(pid, ''), ink[pid])
        gp = P0.get(pid, '') if g['route'] == 'PADDLE' else B2.get(pid, '') if g['route'] == 'FLASH' else None
        row = {'cls': r['cls'], 'title': r['title'], 'scored': scored(r), 'blank': r['page_kind'] != 'body', 'route': g['route'], 'flags': g['flags'],
               'feat': {k: g[k] for k in ('n', 'zlib', 'rep6', 'num', 'ink', 'blobs')}, 'fail': failure(r, P0.get(pid, ''))}
        if scored(r):
            for a, t in (('P0', P0.get(pid, '')), ('B2', B2.get(pid, '')), ('B2r', B2r.get(pid, '')), ('GP', gp)):
                if t is None: continue
                s = page_scores(r, t)
                row[a] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in s.items()}
                if r['cls'] == 'table': row[a]['order_cer'] = round(s['cer'], 4) if s['cer'] is not None else None
            p = row['P0']['primary']
            row['good'] = not row['fail'] and p <= 0.25
        res['pages'][pid] = row
    S = [v for v in res['pages'].values() if v['scored']]
    for c in CLASSES:
        ps = [v for v in S if v['cls'] == c]
        m = {'n': len(ps)}
        for a in ('P0', 'B2', 'B2r', 'GP'):
            v = [p[a]['primary'] for p in ps if a in p]
            m[a] = {'median': median(v), 'ci': boot_ci(v), 'mean': sum(v) / len(v) if v else None, 'n': len(v),
                    'bad_over_50pct': sum(1 for x in v if x > 0.5)}
            if c == 'table':
                o = [p[a]['order_cer'] for p in ps if a in p and p[a].get('order_cer') is not None]
                m[a]['order_cer_median'] = median(o)
        nf_fresh = median([abs(p['B2']['primary'] - p['B2r']['primary']) for p in ps if 'B2r' in p and 'B2' in p])
        m['noise_fresh_B2_B2r'] = nf_fresh
        m['noise_floor'] = max(nf_fresh or 0, BAKEOFF_FLOOR[c])
        for a in ('GP', 'P0'):
            d = [p[a]['primary'] - p['B2']['primary'] for p in ps if a in p]
            m[f'd_{a}_vs_B2'] = {'median': median(d), 'ci': boot_ci(d), 'n': len(d)}
        res['classes'][c] = m
        allc = [v for v in res['pages'].values() if v['cls'] == c]
        res['routes'][c] = {rt: {'k': sum(1 for v in allc if v['route'] == rt), 'n': len(allc),
                                 'wilson': wilson(sum(1 for v in allc if v['route'] == rt), len(allc))} for rt in ('PADDLE', 'FLASH', 'HOLD')}
        res['routes'][c]['flags'] = {f: sum(1 for v in allc if f in v['flags']) for f in ('LOOP', 'OVERRUN', 'COLLAPSE', 'NUMERIC')}
    fails = [(pid, v) for pid, v in res['pages'].items() if v['fail'] and (v['scored'] or v['blank'])]
    goods = [(pid, v) for pid, v in res['pages'].items() if v.get('good')]
    caught = [pid for pid, v in fails if v['route'] != 'PADDLE']
    passed = [pid for pid, v in goods if v['route'] == 'PADDLE']
    gt = {'failures': len(fails), 'caught': len(caught), 'catch_rate': len(caught) / len(fails) if fails else None,
          'catch_wilson': wilson(len(caught), len(fails)), 'missed': [pid for pid, v in fails if v['route'] == 'PADDLE'],
          'good': len(goods), 'passed': len(passed), 'pass_rate': len(passed) / len(goods) if goods else None,
          'pass_wilson': wilson(len(passed), len(goods)), 'good_flagged': [pid for pid, v in goods if v['route'] != 'PADDLE'],
          'neither': [pid for pid, v in res['pages'].items() if v['scored'] and not v['fail'] and not v.get('good')]}
    if len(fails) < 3:
        # preregistered fallback: pool with the bake-off's in-scope (table + mixed, scored) failures, all 5 caught there
        gt['pooled_with_bakeoff'] = {'failures': len(fails) + 5, 'caught': len(caught) + 5,
                                     'catch_rate': (len(caught) + 5) / (len(fails) + 5), 'label': 'partly in-sample'}
    res['guard_test'] = gt
    catch = gt['catch_rate'] if len(fails) >= 3 else gt['pooled_with_bakeoff']['catch_rate']
    for c in CLASSES:
        m = res['classes'][c]
        c1 = m['d_GP_vs_B2']['ci'][1] <= m['noise_floor']
        res['bar'][c] = {'c1_cer': c1, 'c1_upper': m['d_GP_vs_B2']['ci'][1], 'noise_floor': m['noise_floor'],
                         'c2_catch': catch >= 0.9, 'c3_pass': (gt['pass_rate'] or 0) >= 0.8,
                         'passes': bool(c1 and catch >= 0.9 and (gt['pass_rate'] or 0) >= 0.8)}
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
