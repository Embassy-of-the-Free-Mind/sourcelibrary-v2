#!/usr/bin/env python3
# PRIOR ART: scripts/eval/mss-thinking-6544/score.py (the October scorer: fold, failed-read rules, mean page CER capped
# at 1.0, intervals resampled by work, paired differences). Its functions are imported unchanged; it scores a fixed list
# of October arms from one out/ folder, so this file only adds the #92 arms (two draws each), the draw-to-draw spread,
# the best-of-two oracle, the model check and the per-page cost/token columns.
"""
  python3 score-92.py --set setA --root $JOB_SCRATCH --stored /root/jobs/_shared-6544/mss-thinking-6544 --json out.json
  python3 score-92.py --set setB --root $JOB_SCRATCH --json out.json

New reads: <root>/<set>/out/<ARM>-d<k>.jsonl. Stored October reads: <stored>/<set>/out/{opus,pro}.jsonl (setA) or
<root>/setB/out/{opus,pro}.jsonl (setB). A row whose modelUsage does not name the requested model is a failed read
('wrong_model'), never scored.
"""
import argparse, collections, importlib.util, json, os, random, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('sc', os.path.join(HERE, '..', 'mss-thinking-6544', 'score.py'))
sc = importlib.util.module_from_spec(spec); spec.loader.exec_module(sc)
NEW = {'FABLE': 'claude-fable-5-2', 'OPUS2': 'claude-opus-5-5', 'OPUSX': 'claude-opus-5-5'}
# The copy of this image on l7a is a truncated 65,536-byte JPEG (grey below a strip of paper); October read the full
# file on main, so the #92 arms saw a different, broken page. Excluded from every arm, stored ones included (n = 75).
BROKEN_IMAGE_A = {'rasam|BULAC_MS_ARA_417_0069'}
# Set B page whose keys cannot judge it (#92 by eye, #270): KEY-G and KEY-F hold another leaf's text (a commentary
# on Isaiah 54-55), KEY-O is all [?]; the leaf itself was read by Fable. Dropped from Set B (n = 39).
BROKEN_KEY_B = {'699067ef249ce014347d4e4f:260'}
INFRA = __import__('re').compile(r'Failed to authenticate|unrecognized_model|claude-pace-guard')
PRICE = None # list price comes from the CLI's own total_cost_usd per row (cost_usd_equiv)


def pc(x):
    return '—' if x is None else f'{100 * x:.1f}'


def ci(c):
    return '—' if not c or c[0] is None else f'{pc(c[0])} [{pc(c[1])}, {pc(c[2])}]'


def page(c):
    return min(1.0, c['cd'] / max(1, c['cl']))


def load_arm(path, model, uids):
    rows = sc.load(path) if os.path.exists(path) else {}
    # A call that never reached the model (Cloudflare 403 at auth, the CLI not yet knowing the model id, the pace guard
    # refusing a slot) says nothing about the reader: it is 'not run', never a failed read.
    for u, r in list(rows.items()):
        if not r.get('text') and INFRA.search(r.get('error') or ''):
            del rows[u]
    wrong = []
    for u, r in list(rows.items()):
        if model and r.get('text') and model not in (r.get('model_usage') or {}):
            wrong.append(u); rows[u] = {**r, 'text': '', 'error': 'wrong_model: ' + str(r.get('model_resolved'))}
    T, F, S = sc.reads('x', rows, uids)
    if wrong:
        F['wrong_model'] = len(wrong)
    F.pop('missing', None)
    missing = [u for u in uids if u not in rows]
    return rows, T, F, missing, wrong


def mad_pages(a, b):
    common = [u for u in a if u in b]
    return (statistics.mean(abs(page(a[u]) - page(b[u])) for u in common) if common else None), len(common)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', required=True); ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH'))
    ap.add_argument('--stored', default='/root/jobs/_shared-6544/mss-thinking-6544'); ap.add_argument('--json')
    a = ap.parse_args()
    if a.set == 'setA':
        P = [json.loads(l) for l in open(os.path.join(a.stored, 'setA', 'pages.jsonl'), encoding='utf-8') if l.strip()]
        refs = {'reference': {r['uid']: r['gt'] for r in P}}
        work = {r['uid']: r['dataset'] + '/' + r['work'] for r in P}; group = {r['uid']: r['dataset'] for r in P}
        uids = [r['uid'] for r in P if r['uid'] not in sc.EXCLUDE_A and r['uid'] not in BROKEN_IMAGE_A]
        stored_dir = os.path.join(a.stored, 'setA', 'out')
    else:
        P = json.load(open(os.path.join(a.root, 'setB', 'draw.json')))['picks']
        kd = os.path.join(a.root, 'setB', 'keys')
        refs = {k: json.load(open(os.path.join(kd, f'{k}.json'))) for k in ('key-o', 'key-g', 'key-f')}
        work = {r['uid']: r['book_id'] for r in P}; group = {r['uid']: r['stratum'] for r in P}
        uids = [r['uid'] for r in P if r['uid'] not in BROKEN_KEY_B]
        stored_dir = os.path.join(a.root, 'setB', 'out')
    out = os.path.join(a.root, a.set, 'out')
    arms = {}
    for f in sorted(os.listdir(out)):
        if f.endswith('.jsonl') and '-d' in f:
            name = f[:-6]; arms[name] = load_arm(os.path.join(out, f), NEW[name.split('-d')[0]], uids)
    for s in ('opus', 'pro'):
        arms['stored-' + s] = load_arm(os.path.join(stored_dir, f'{s}.jsonl'), None, uids)
    rep = {'set': a.set, 'pages': len(uids), 'keys': {}}
    for key, ref in refs.items():
        K = rep['keys'].setdefault(key, {'arms': {}, 'pairs': {}, 'spread': {}, 'oracle': {}})
        C = {n: {u: sc.counts(t, ref[u]) for u, t in v[1].items() if u in ref} for n, v in arms.items()}
        # best-of-two ORACLE: per page, the draw with the lower CER (needs the reference: not achievable in production)
        for base in NEW:
            d1, d2 = C.get(base + '-d1'), C.get(base + '-d2')
            if d1 and d2:
                C[base + '-best2'] = {u: min((d1.get(u), d2.get(u)), key=lambda c: page(c) if c else 9) for u in set(d1) | set(d2)}
                C[base + '-mean2'] = {u: {'cd': (d1[u]['cd'] + d2[u]['cd']) / 2, 'cl': d1[u]['cl'], 'wd': 0, 'wl': 1, 'sd': 0, 'sl': 1} for u in d1 if u in d2}
        for n, c in C.items():
            rows, T, F, missing, wrong = arms.get(n, ({}, {}, {}, [], []))
            given = [u for u in uids if u in ref and u not in missing] if n in arms else [u for u in uids if u in ref]
            # the CLI's duration_ms (no pace-guard wait) where the row has it; October rows and the first draw-1 rows only have secs
            secs = [r['duration_ms'] / 1000 for u, r in rows.items() if u in uids and r.get('duration_ms')]
            secs_n = len(secs)
            if not secs:
                secs = [r['secs'] for u, r in rows.items() if u in uids and r.get('secs')]
            cost = [r['cost_usd_equiv'] for u, r in rows.items() if u in uids and r.get('cost_usd_equiv')]
            otok = [r['output_tokens'] for u, r in rows.items() if u in uids and r.get('output_tokens')]
            K['arms'][n] = {'read': len(c), 'given': len(given), 'did_not_read': F, 'not_run': len(missing),
                            'mcer': sc.mean_ci(c, work),
                            'mcer_fail1': sc.mean_ci({**{u: {'cd': 1, 'cl': 1} for u in given if u not in c}, **c}, work) if n in arms else None,
                            'cer': sc.agg(c, work), 'secs_mean': statistics.mean(secs) if secs else None, 'secs_from_cli_n': secs_n,
                            'usd_per_page': statistics.mean(cost) if cost else None, 'out_tokens_mean': statistics.mean(otok) if otok else None,
                            'by_group': {g: {'read': len([u for u in c if group[u] == g]), 'mcer': sc.mean_ci({u: x for u, x in c.items() if group[u] == g}, work)} for g in sorted(set(group.values()))},
                            'worst': sorted(((round(page(x), 4), u) for u, x in c.items()), reverse=True)[:10]}
        pairs = [('FABLE-d1', 'OPUS2-d1'), ('FABLE-d2', 'OPUS2-d2'), ('FABLE-mean2', 'OPUS2-mean2'),
                 ('FABLE-d1', 'OPUSX-d1'), ('FABLE-d2', 'OPUSX-d2'), ('FABLE-mean2', 'OPUSX-mean2'),
                 ('OPUSX-d1', 'OPUS2-d1'), ('OPUSX-d2', 'OPUS2-d2'), ('OPUSX-mean2', 'OPUS2-mean2'),
                 ('OPUS2-d1', 'stored-opus'), ('OPUS2-d2', 'stored-opus'), ('OPUS2-mean2', 'stored-opus'),
                 ('FABLE-d1', 'stored-opus'), ('FABLE-mean2', 'stored-opus'), ('FABLE-d1', 'stored-pro'), ('FABLE-mean2', 'stored-pro'),
                 ('FABLE-best2', 'OPUS2-best2')]
        for x, y in pairs:
            if C.get(x) and C.get(y):
                K['pairs'][f'{x} − {y}'] = sc.paired_mean(C[x], C[y], work)
        # the headline pairs per stratum: where does a gap come from?
        for x, y in [('FABLE-mean2', 'OPUS2-mean2'), ('FABLE-d1', 'OPUS2-d1'), ('FABLE-d2', 'OPUS2-d2'), ('FABLE-d1', 'OPUSX-d1')]:
            if C.get(x) and C.get(y):
                for g in sorted(set(group.values())):
                    cx = {u: v for u, v in C[x].items() if group[u] == g}; cy = {u: v for u, v in C[y].items() if group[u] == g}
                    if set(cx) & set(cy):
                        K.setdefault('pairs_by_group', {})[f'{x} − {y} | {g}'] = sc.paired_mean(cx, cy, work)
        for base in NEW:
            if C.get(base + '-d1') and C.get(base + '-d2'):
                K['spread'][base] = {'d1−d2': sc.paired_mean(C[base + '-d1'], C[base + '-d2'], work),
                                     'mean_abs_page_change': mad_pages(C[base + '-d1'], C[base + '-d2'])}
        # per-page FABLE vs OPUS2 differences (for the by-eye pick)
        if C.get('FABLE-d1') and C.get('OPUS2-d1'):
            f, o = C.get('FABLE-mean2') or C['FABLE-d1'], C.get('OPUS2-mean2') or C['OPUS2-d1']
            K['fable_vs_opus2_pages'] = sorted(((round(page(f[u]) - page(o[u]), 4), u) for u in f if u in o), key=lambda t: -abs(t[0]))[:15]
    for n, v in arms.items():
        rep.setdefault('model_check', {})[n] = {'rows': len(v[0]), 'wrong_model': v[4],
                                                'models_seen': dict(collections.Counter(r.get('model_resolved') for r in v[0].values()))}
    for key, K in rep['keys'].items():
        print(f'== {a.set} key {key}')
        for n, v in K['arms'].items():
            print(f"{n:13s} read {v['read']:2d}/{v['given']:2d} fail {v['did_not_read']} notrun {v['not_run']} mCER {ci(v['mcer'])} fail=1 {ci(v['mcer_fail1'])} "
                  f"pooled {ci(v['cer'])} s {v['secs_mean'] and round(v['secs_mean'])} $ {v['usd_per_page'] and round(v['usd_per_page'], 3)} otok {v['out_tokens_mean'] and round(v['out_tokens_mean'])}")
            print('              ' + '  '.join(f"{g}: {pc(x['mcer'][0])} ({x['read']})" for g, x in v['by_group'].items()))
        for k, v in K['pairs'].items():
            print(f'  {k:28s} {ci(v[:3])} n={v[3]}')
        for k, v in K.get('pairs_by_group', {}).items():
            print(f'    {k:44s} {ci(v[:3])} n={v[3]}')
        for k, v in K['spread'].items():
            print(f"  spread {k}: d1−d2 {ci(v['d1−d2'][:3])} n={v['d1−d2'][3]}; mean |page change| {pc(v['mean_abs_page_change'][0])}")
    print('model check', json.dumps(rep['model_check']))
    if a.json:
        json.dump(rep, open(a.json, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
