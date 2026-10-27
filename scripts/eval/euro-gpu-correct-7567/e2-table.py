#!/usr/bin/env python3
"""e2-table.py — #7567 E2: CER of every arm against the typed references, the noise floor, and the decision rule.

PRIOR ART: score.py (this directory) scores one page per arm; scripts/eval/latin-bakeoff-5924/bar-a5.mjs has the paired
bootstrap of a median difference against a comparator. This adds what E2's decision needs: arm outputs read from the
e2-correct.mjs directories, a per-page paired difference against arm (a), and the A-vs-A noise floor.

Decision rule (written before any GPU-draft arm was scored, from the issue text):
  per language, on the pages every compared arm answered, δ_X = mean(folded CER_X − folded CER_a) with a 95% paired
  bootstrap CI (10,000 resamples, seed 7567). The noise floor NF = the larger |end| of the same CI for a2 − a.
  X is WITHIN THE NOISE FLOOR of (a) when the upper end of δ_X's CI ≤ NF. Mean, not median: a dropped passage is the
  failure that matters, and a median hides it.
  The second clause (no more worse-than-draft pages than a) comes from the judge (judge-table.py).
  Where there is no lite draft (fr, it, DTA de) there is no (a): b2 − b is the floor and the arms are compared with b and e.

  e2-table.py <J> <out.json>
"""
import gzip, json, os, random, subprocess, sys

J, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from score import score_page, flag_lengths  # noqa: E402

pages = json.load(open(os.path.join(HERE, 'panel.json')))['pages']
refs = {json.loads(l)['slug']: json.loads(l)['ref_text'] for l in gzip.open(os.path.join(HERE, 'refs.jsonl.gz'), 'rt')}


def from_dir(arm):
    d = os.path.join(J, 'e2', arm)
    if not os.path.isdir(d): return {}
    out = {}
    for f in os.listdir(d):
        r = json.load(open(os.path.join(d, f)))
        out[f[:-5]] = {'text': r.get('final') or '', 'outcome': r.get('outcome'), 'usage': r.get('usage'), 'secs': r.get('secs')}
    return out


def from_jsonl(name):
    p = os.path.join(J, 'drafts', f'{name}.jsonl')
    return {json.loads(l)['page_id']: json.loads(l) for l in open(p)} if os.path.exists(p) else {}


ARMS = {k: from_jsonl(k) for k in ['S', 'L', 'G', 'X', 'f', 'a-hist']}
for a in ['a', 'a2', 'b', 'b2', 'c', 'd', 'e', 'a-noimg', 'b-noimg', 'c-noimg', 'd-noimg', 'a-noimg-literal']:
    ARMS[a] = from_dir(a)
ARMS = {k: v for k, v in ARMS.items() if v}

per = {}
for p in pages:
    s = p['slug']; row = {a: score_page(refs[s], v.get(s)) for a, v in ARMS.items()}
    flag_lengths(row); per[s] = row
lang_of = {p['slug']: p['lang'] for p in pages}
lite = {p['slug'] for p in pages if p['lite']}


def has(s, a): return not per[s].get(a, {'missing': True}).get('missing', False)


def boot(diffs, n=10000, seed=7567):
    rng = random.Random(seed); m = len(diffs)
    means = sorted(sum(diffs[rng.randrange(m)] for _ in range(m)) / m for _ in range(n))
    return round(sum(diffs) / m, 4), round(means[int(.025 * n)], 4), round(means[int(.975 * n)], 4)


def paired(x, y, slugs):
    ok = [s for s in slugs if has(s, x) and has(s, y)]
    if len(ok) < 5: return None
    m, lo, hi = boot([per[s][x]['folded'] - per[s][y]['folded'] for s in ok])
    return {'n': len(ok), 'mean': m, 'lo': lo, 'hi': hi}


def outcome_counts(arm, slugs):
    c = {}
    for s in slugs:
        r = ARMS.get(arm, {}).get(s)
        if r and r.get('outcome'): c[r['outcome']] = c.get(r['outcome'], 0) + 1
    return c


def tokens(arm, slugs):
    u = [ARMS[arm][s]['usage'] for s in slugs if s in ARMS.get(arm, {}) and ARMS[arm][s].get('usage')]
    if not u: return None
    return {'calls': len(u), 'input_per_page': round(sum(x.get('input_tokens', 0) for x in u) / len(u)),
            'output_per_page': round(sum(x.get('output_tokens', 0) for x in u) / len(u))}


res = {'by_lang': {}}
for lang in ['la', 'en', 'de', 'fr', 'it', 'all']:
    sl = [s for s in per if lang in ('all', lang_of[s])]
    sll = [s for s in sl if s in lite]
    L = {'n_pages': len(sl), 'n_lite_pages': len(sll), 'arms': {}, 'vs_a': {}, 'vs_b': {}, 'vs_e': {}, 'image_vs_noimage': {}}
    for a in ARMS:
        got = [per[s][a] for s in sl if has(s, a)]
        if not got: continue
        fs = sorted(g['folded'] for g in got); rs = sorted(g['raw'] for g in got)
        L['arms'][a] = {'n': len(got), 'median_raw': rs[len(rs) // 2], 'median_folded': fs[len(fs) // 2], 'mean_folded': round(sum(fs) / len(fs), 4),
                        'loops': sum(g['loop'] for g in got), 'trunc': sum(g['trunc'] for g in got), 'outcomes': outcome_counts(a, sl), 'tokens': tokens(a, sl)}
    if sll:
        nf = paired('a2', 'a', sll); L['noise_floor_a2_minus_a'] = nf
        NF = max(abs(nf['lo']), abs(nf['hi'])) if nf else None; L['NF'] = NF
        for x in ['b', 'c', 'd', 'e', 'f', 'L', 'S', 'G', 'X', 'a-hist']:
            d = paired(x, 'a', sll)
            if d: d['within_noise_floor'] = bool(NF is not None and d['hi'] <= NF); L['vs_a'][x] = d
    nfb = paired('b2', 'b', [s for s in sl if s not in lite]); L['noise_floor_b2_minus_b_nonlite'] = nfb
    for x in ['c', 'd', 'e', 'G', 'X']:
        d = paired(x, 'b', sl)
        if d: L['vs_b'][x] = d
    for x in ['b', 'c', 'd', 'G', 'X']:
        d = paired(x, 'e', sl)
        if d: L['vs_e'][x] = d
    for a in ['a', 'b', 'c', 'd']:
        d = paired(f'{a}-noimg', a, sl)
        if d: L['image_vs_noimage'][a] = d
    res['by_lang'][lang] = L
res['per_page'] = per
json.dump(res, open(OUT, 'w'), indent=1)
for lang, L in res['by_lang'].items():
    print(f"== {lang} ({L['n_pages']} pages, {L['n_lite_pages']} with lite)  NF={L.get('NF')}")
    for a, v in sorted(L['arms'].items(), key=lambda kv: kv[1]['median_folded']):
        print(f"  {a:16s} n={v['n']:3d} med raw {v['median_raw']*100:5.2f} folded {v['median_folded']*100:5.2f} mean {v['mean_folded']*100:5.2f} loops {v['loops']} trunc {v['trunc']} {v['outcomes'] or ''}")
    for x, d in L['vs_a'].items(): print(f"    {x} − a: {d['mean']*100:+.2f} [{d['lo']*100:+.2f}, {d['hi']*100:+.2f}] n={d['n']} within NF: {d['within_noise_floor']}")
    for x, d in L['image_vs_noimage'].items(): print(f"    {x}-noimg − {x}: {d['mean']*100:+.2f} [{d['lo']*100:+.2f}, {d['hi']*100:+.2f}] n={d['n']}")
