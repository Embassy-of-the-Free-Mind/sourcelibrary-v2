#!/usr/bin/env python3
"""score.py — score engine reads of the Chinese held-residue reference pages per class (#6871 item 3).

PRIOR ART: scripts/eval/zh-residue-refs-6871/compare.py — its han()/lev()/bag() are imported unchanged (it compares
two Opus reads with each other); this scores engine output against the resolved reference with the rules
preregistered in scripts/eval/experiments/2026-10-18-zh-residue-bakeoff-prereg-6871.md.

  python3 score.py <arms dir> [--noise B1 B1r] > results.json
<arms dir>/<ARM>.jsonl rows: {page_id, text}. A page missing from an arm's file scores as empty output.
"""
import json, os, re, random, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'zh-residue-refs-6871'))
from compare import han, lev, bag  # noqa: E402

PLACEHOLDER = re.compile(r'\[(?:滿文|蒙文|藏文|other)\]')
TAGS = re.compile(r'<[^>]+>')
CLASSES = ['table', 'mixed', 'seal', 'reverted']


def ref_strings(r):
    """(full Han string, per-char is_head flags) of the reference text, ▣ / placeholders / □ excluded."""
    t = PLACEHOLDER.sub('', r['text'] or '')
    s, flags, inhead = [], [], False
    for ch in t:
        if ch == '⟨': inhead = True; continue
        if ch == '⟩': inhead = False; continue
        h = han(ch, box=False)
        if h: s.append(h); flags.append(inhead)
    return ''.join(s), flags


def hyp_string(text, margin):
    """Han string of an engine output, HTML stripped, fold-strip lines (≥80% margin chars, ≥2 chars) dropped."""
    text = TAGS.sub('\n', text or '')
    mbag = Counter(han(margin or '', box=False))
    keep = []
    for line in text.split('\n'):
        h = han(line, box=False)
        if len(h) >= 2 and mbag:
            inm = sum((Counter(h) & mbag).values())
            if inm / len(h) >= 0.8: continue
        keep.append(h)
    return ''.join(keep)


def align_counts(ref, flags, hyp):
    """Levenshtein alignment of ref to hyp; errors split by head/gloss position. Insertions go to gloss."""
    n, m = len(ref), len(hyp)
    D = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1): D[i][0] = i
    for j in range(m + 1): D[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i][j] = min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]))
    i, j, eh, eg, ins = n, m, 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i][j] == D[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            if ref[i - 1] != hyp[j - 1]:
                if flags[i - 1]: eh += 1
                else: eg += 1
            i -= 1; j -= 1
        elif i > 0 and D[i][j] == D[i - 1][j] + 1:
            if flags[i - 1]: eh += 1
            else: eg += 1
            i -= 1
        else:
            ins += 1; j -= 1
    return eh, eg, ins


def page_scores(r, text):
    ref, flags = ref_strings(r)
    hyp = hyp_string(text, r.get('margin'))
    out = {'n_ref': len(ref), 'n_hyp': len(hyp),
           'cer': lev(ref, hyp) / len(ref) if ref else None,
           'bag': bag(ref, hyp) if (ref or hyp) else 0.0}
    nh = sum(flags)
    if r['cls'] == 'seal' and ref:
        eh, eg, ins = align_counts(ref, flags, hyp)
        ng = len(ref) - nh
        out.update(gloss_cer=(eg + ins) / ng if ng else None, head_acc=1 - eh / nh if nh else None, n_heads=nh)
    out['primary'] = out['bag'] if r['cls'] == 'table' else out.get('gloss_cer') if r['cls'] == 'seal' else out['cer']
    return out


def hallucinated(r, text):
    allowed = Counter(han((r['text'] or '') + (r.get('margin') or ''), box=False))
    h = Counter(han(TAGS.sub('', text or ''), box=False))
    excess = sum((h - allowed).values())
    return excess, excess >= 5


def median(v):
    v = sorted(v); n = len(v)
    return None if not n else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2)


def boot_ci(v, B=10000, seed=6871):
    if not v: return None
    rnd = random.Random(seed)
    ms = sorted(median([rnd.choice(v) for _ in v]) for _ in range(B))
    return [ms[int(0.025 * B)], ms[int(0.975 * B) - 1]]


def scored(r):
    return r['cls'] in CLASSES and '清文鑑' not in r['title'] and len(ref_strings(r)[0]) >= 20


def main():
    d = sys.argv[1]
    refs = [json.loads(l) for l in open(os.path.join(HERE, '..', 'zh-residue-refs-6871', 'refs.jsonl'))]
    arms = sorted(f[:-6] for f in os.listdir(d) if f.endswith('.jsonl'))
    reads = {a: {} for a in arms}
    for a in arms:
        for l in open(os.path.join(d, a + '.jsonl')):
            if l.strip():
                x = json.loads(l); reads[a][x['page_id']] = x.get('text') or ''
    res = {'arms': arms, 'n_scored': {c: sum(1 for r in refs if r['cls'] == c and scored(r)) for c in CLASSES},
           'pages': {}, 'classes': {}, 'halluc': {}}
    for a in arms:
        res['pages'][a] = {}
        for r in refs:
            if scored(r): res['pages'][a][r['page_id']] = dict(page_scores(r, reads[a].get(r['page_id'], '')), cls=r['cls'])
        hs = [(r['page_id'], *hallucinated(r, reads[a].get(r['page_id'], ''))) for r in refs if r['cls'] == 'other']
        res['halluc'][a] = {'pages': sum(1 for x in hs if x[2]), 'of': len(hs),
                            'detail': [{'page_id': p, 'excess': e} for p, e, f in hs if e]}
    for c in CLASSES:
        res['classes'][c] = {}
        for a in arms:
            ps = [v for v in res['pages'][a].values() if v['cls'] == c]
            m = {}
            for k in ['primary', 'cer', 'bag', 'gloss_cer', 'head_acc']:
                v = [p[k] for p in ps if p.get(k) is not None]
                if v: m[k] = {'median': median(v), 'ci': boot_ci(v), 'mean': sum(v) / len(v), 'n': len(v)}
            m['chars_ref'] = sum(p['n_ref'] for p in ps); m['chars_hyp'] = sum(p['n_hyp'] for p in ps)
            res['classes'][c][a] = m
    if '--noise' in sys.argv:
        x, y = sys.argv[sys.argv.index('--noise') + 1: sys.argv.index('--noise') + 3]
        res['noise'] = {}
        for c in CLASSES:
            ids = [p for p, v in res['pages'][x].items() if v['cls'] == c]
            dd = [abs(res['pages'][x][p]['primary'] - res['pages'][y][p]['primary']) for p in ids]
            res['noise'][c] = {'pair': [x, y], 'median_abs': median(dd), 'mean_abs': sum(dd) / len(dd)}
    base = [b for b in ['B1', 'B2'] if b in arms]
    res['vs_best_baseline'] = {}
    for c in CLASSES:
        if not base: break
        best = min(base, key=lambda b: res['classes'][c][b]['primary']['median'])
        res['vs_best_baseline'][c] = {'baseline': best, 'arms': {}}
        ids = [p for p, v in res['pages'][best].items() if v['cls'] == c]
        for a in arms:
            if a in ('B1', 'B2', 'B1r'): continue
            dd = [res['pages'][a][p]['primary'] - res['pages'][best][p]['primary'] for p in ids]
            ci = boot_ci(dd)
            nf = res.get('noise', {}).get(c, {}).get('median_abs')
            ok = ci[1] < 0 and (nf is None or abs(median(dd)) > nf) and res['halluc'][a]['pages'] == 0
            res['vs_best_baseline'][c]['arms'][a] = {'median_d': median(dd), 'ci': ci, 'passes_bar': ok}
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
