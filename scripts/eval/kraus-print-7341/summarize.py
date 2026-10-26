#!/usr/bin/env python3
# PRIOR ART: scripts/eval/arabic-mss-gate-7341/summarize.py — the gate's rows (estimator long-table shape + usability
# columns), usability rates and route costs. Its intervals resample BOOKS and it prices a manuscript cell; this set is
# one book, so intervals resample PAGES (and say so), the 4 gate pages are pooled in beside the 25, filter cuts are
# counted by agy's fixed message, and the rows go to results/kraus-print-7341/kraus-rows.jsonl for build-arabic-rows.py.
"""
  python3 scripts/eval/kraus-print-7341/summarize.py --out scripts/eval/results/kraus-print-7341

Writes kraus-rows.jsonl (one row per page x engine, the gate's row shape), summary.json and the text-free artefacts
(draw, CER per page, judge verdicts, keys report). No page text is written.
"""
import argparse, collections, json, os, random, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..', '..', '..')
GATE = os.path.join(HERE, '..', 'arabic-mss-gate-7341')
sys.path.insert(0, GATE)
from score import letters  # noqa: E402

JS = os.environ['JOB_SCRATCH']; G = os.path.join(JS, 'g')
ENGINE = {'lite': ('gemini-3.1-flash-lite', 'gemini-lite'), 'f38l': ('gemini-3.8-flash+antigravity-cli', 'gemini-cli'),
          'opus': ('claude-opus-5-5', 'claude')}
STEM = {'lite': 'lite', 'f38l': 'pro', 'opus': 'opus'}
ORDER = ('USABLE', 'NOTICEABLE', 'MISLEADING', 'FAILED')
BLOCK_MSG = "This request was blocked by Gemini's filters"


def ci(vals, B=4000):
    """Mean and 95% interval resampled by PAGE (one book: pages are not independent, so this is too narrow)."""
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    rng = random.Random(7341); n = len(vals)
    bs = sorted(sum(vals[rng.randrange(n)] for _ in range(n)) / n for _ in range(B))
    return [round(sum(vals) / n, 4), round(bs[int(0.025 * B)], 4), round(bs[int(0.975 * B) - 1], 4), n]


def rows_of(path):
    out = {}
    for l in open(path):
        r = json.loads(l); out[r['uid']] = r  # last row wins (run-cli-arm.py restart rule)
    return out


def worse(g):
    return max([v for v in g.values() if v] or ['FAILED'], key=ORDER.index)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    draw = json.load(open(os.path.join(JS, 'draw.json')))
    picks = draw['pages']; uids = [p['uid'] for p in picks]
    score = json.load(open(os.path.join(JS, 'score.json')))
    judge = json.load(open(os.path.join(G, 'judge', 'judge-scores.json')))
    keyo = json.load(open(os.path.join(G, 'setB', 'keys', 'key-o.json')))
    raw = {arm: rows_of(os.path.join(G, 'setB', 'out', f'{s}.jsonl')) for arm, s in STEM.items()}
    gate_dir = os.path.join(REPO, 'scripts', 'eval', 'results', 'arabic-mss-gate-7341')
    gate_rows = [json.loads(l) for l in open(os.path.join(gate_dir, 'gate-rows.jsonl'))]
    gate_print = [r for r in gate_rows if r['chart'] == 'arabic-print']

    rows = []
    for p in picks:
        u = p['uid']; pp = score['per_page'].get(u, {})
        for arm, (eng, fam) in ENGINE.items():
            c = pp.get(f'{arm}|o|skel'); g = judge['per_item'][f'{arm}|{u}']
            r = raw[arm].get(u, {})
            cut = BLOCK_MSG in ((r.get('raw') or '') + (r.get('text') or ''))
            rows.append(dict(chart='arabic-print', panel='jabir-7341', page=f'kraus-7341|{u}', work=f'book:{p["book_id"]}',
                             engine=eng, engine_family=fam, kind='print', period='1900 on', year=1935, cer=c,
                             scored=c is not None, failure=None if c is not None else 'did_not_read',
                             failure_kind=('safety_filter' if cut else 'other') if c is None else None,
                             n_ref=len(letters(keyo[u], 'skel')), n_ref_source='model-key-o (Opus referee; DIRECTIONAL)',
                             cer_marks=pp.get(f'{arm}|o|marks'), cer_key_g=pp.get(f'{arm}|g|skel'),
                             usability_claude=g.get('claude'), usability_gemini=g.get('gemini'), usability_worse=worse(g),
                             leaf=None, stratum=p['stratum'], features=p['features'], source='kraus-7341', script='Arab', language='ar',
                             calls=r.get('attempts') or 1))
    with open(os.path.join(a.out, 'kraus-rows.jsonl'), 'w') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in rows)

    S = {'interval': '95%, resampled by PAGE (one book; pages are not independent, so intervals are too narrow)',
         'usable_definition': 'stricter judge: USABLE or NOTICEABLE', 'arms': {}}
    for arm, (eng, _) in ENGINE.items():
        R = [r for r in rows if r['engine'] == eng]
        Gp = [r for r in gate_print if r['engine'] == eng]
        d = {'given': len(R), 'read': sum(r['scored'] for r in R),
             'filter_cut_fixed_message': sum(r['failure_kind'] == 'safety_filter' for r in R),
             'filter_cut_pages': [r['page'].split('_')[-1] for r in R if r['failure_kind'] == 'safety_filter'],
             'other_failed': sum(r['failure_kind'] == 'other' for r in R),
             'calls': sum(r['calls'] for r in R)}
        for col, name in (('cer', 'key-o|skel'), ('cer_marks', 'key-o|marks'), ('cer_key_g', 'key-g|skel')):
            d[name] = ci([r[col] for r in R if r['scored']])
        d['key-o|skel|fail=1'] = ci([r['cer'] if r['scored'] else 1.0 for r in R])
        for fam in ('claude', 'gemini', 'worse'):
            v = [r[f'usability_{fam}'] or 'unparsed' for r in R]
            d[f'usability|{fam}'] = dict(collections.Counter(v))
            d[f'usable|{fam}'] = ci([int(x in ('USABLE', 'NOTICEABLE')) for x in v])
        d['strict_usable|worse'] = ci([int(r['usability_worse'] == 'USABLE') for r in R])
        d['misleading|worse'] = ci([int(r['usability_worse'] == 'MISLEADING') for r in R])
        # pooled with the gate's 4 Kraus pages (same arms, prompt, key procedure, judges)
        P = R + Gp
        d['pooled29'] = {'pages': len(P), 'read': sum(bool(r['scored']) for r in P),
                         'not_read': sum(not r['scored'] for r in P),
                         'usable|worse': ci([int(r['usability_worse'] in ('USABLE', 'NOTICEABLE')) for r in P]),
                         'key-o|skel': ci([r['cer'] for r in P if r['scored']])}
        S['arms'][arm] = d
    S['judges'] = {'agreement': judge['agreement'], 'unparsed': judge['unparsed'],
                   'plants': {f: {k: v for k, v in x.items() if k != 'pages'} for f, x in judge['plants'].items()},
                   'planted_verdicts': {f: [(x['planted_verdict'], x['original_verdict']) for x in v['pages']] for f, v in judge['plants'].items()}}
    lite_paid = sum(r.get('costUsd') or 0 for r in raw['lite'].values())
    opus_list = [r.get('cost_usd_equiv') or 0 for r in raw['opus'].values()]
    S['cost'] = {'lite_usd_paid_realtime': round(lite_paid, 4), 'lite_usd_per_page_realtime': round(lite_paid / len(raw['lite']), 5),
                 'agy_calls_per_page': round(S['arms']['f38l']['calls'] / len(uids), 3),
                 'opus_list_usd_equiv_per_page': round(sum(opus_list) / len(opus_list), 4)}
    json.dump(S, open(os.path.join(a.out, 'summary.json'), 'w'), indent=1, ensure_ascii=False)

    d = json.loads(json.dumps(draw))
    for p in d['pages']:
        p['image'] = os.path.relpath(p['image'], JS)
    json.dump(d, open(os.path.join(a.out, 'draw.json'), 'w'), indent=1, ensure_ascii=False)
    json.dump(score, open(os.path.join(a.out, 'cer-scores.json'), 'w'), indent=1)
    json.dump(judge, open(os.path.join(a.out, 'judge-scores.json'), 'w'), indent=1, ensure_ascii=False)
    shutil.copyfile(os.path.join(JS, 'gk', 'setB', 'keys', 'keys-report.json'), os.path.join(a.out, 'keys-report.json'))
    shutil.copyfile(os.path.join(JS, 'gk', 'setB', 'second-reader.json'), os.path.join(a.out, 'key-second-reader.json'))
    print(json.dumps(S, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
