#!/usr/bin/env python3
"""score.py — does image gain (log p | image − log p | no image) find the bad spans in a stored read? (#6871 row A)

PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/score.py (seeded bootstrap CIs and a noise floor, for CER). Nothing in
scripts/eval scores spans by token likelihood. Committed with PREREGISTRATION.md before any likelihood was scored.

  score.py <items.jsonl> <ll.jsonl> [--rerun ll-rerun.jsonl] [--res2 ll-1200.jsonl] [--out results.json]

Units: each whitespace-delimited word with at least one letter; inside Han runs, 3-character chunks. A unit's tokens
are those whose character offsets overlap it, widened symmetrically to at least W = 4 tokens.
  gain  = mean(log p_img − log p_txt) over the window; FLAGGED when LOW (score = −gain)
  base  = mean(−log p_txt), text-only perplexity, the preregistered baseline; flagged when HIGH
  inll  = mean(−log p_img), image-conditioned surprisal; descriptive only
Label: 1 if the unit overlaps a located bad span (sub_char, sub_lexical, invented, garbled; or a plant), excluded if
it overlaps a masked quote, else 0. AUROC per group and pooled; 95% CI from 2,000 page-cluster bootstrap resamples
(seed 6871); precision at a 10% flag rate within each group.
"""
import json, random, re, sys, unicodedata
from statistics import mean
import numpy as np
from scipy.stats import rankdata

W = 4
HANR = re.compile(r'[㐀-鿿豈-﫿\U00020000-\U0002ffff]+')
args = sys.argv[1:]
opt = lambda k: args[args.index(k) + 1] if k in args else None
items = {j['item']: j for j in map(json.loads, open(args[0]))}
load = lambda f: {r['item']: r for r in map(json.loads, open(f)) if r.get('ok')} if f else {}
LL, RR, R2 = load(args[1]), load(opt('--rerun')), load(opt('--res2'))
REAL_KINDS = {'sub_char', 'sub_lexical', 'invented', 'garbled'}


def units(text):
    out = []
    for m in re.finditer(r'\S+', text):
        s0, w = m.start(), m.group(0)
        segs, k = [], 0
        for h in HANR.finditer(w):
            if h.start() > k: segs.append((k, h.start(), False))
            segs.append((h.start(), h.end(), True)); k = h.end()
        if k < len(w): segs.append((k, len(w), False))
        for a, b, han in segs:
            if han:
                for c in range(a, b, 3): out.append((s0 + c, s0 + min(b, c + 3)))
            elif any(unicodedata.category(ch).startswith('L') for ch in w[a:b]):
                out.append((s0 + a, s0 + b))
    return out


def unit_scores(it, ll):
    off, img, txt = ll['off'], ll['img'], ll['txt']
    n = len(off); rows = []; j0 = 0
    for s, e in units(it['text']):
        while j0 < n and off[j0][1] <= s: j0 += 1
        j = j0; idx = []
        while j < n and off[j][0] < e:
            if off[j][1] > s: idx.append(j)
            j += 1
        if not idx: continue
        a, b = idx[0], idx[-1] + 1
        while b - a < W and (a > 0 or b < n):
            if a > 0: a -= 1
            if b - a < W and b < n: b += 1
        g = mean(img[i] - txt[i] for i in range(a, b))
        rows.append({'s': s, 'e': e, 'gain': g, 'base': mean(-txt[i] for i in range(a, b)), 'inll': mean(-img[i] for i in range(a, b))})
    return rows


def label(it, u, kinds):
    ov = lambda x: x['s'] < u['e'] and x['e'] > u['s']
    if any(ov(m) for m in it.get('masks', [])): return None
    hit = [sp for sp in it['spans'] if ov(sp)]
    if not hit: return 0
    return 1 if any(sp['kind'] in kinds for sp in hit) else None   # a unit on a span of another kind is left out


def auroc(pos, neg):
    """Mann-Whitney AUROC with tied ranks: P(a positive scores above a negative)"""
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    if not len(pos) or not len(neg): return None
    r = rankdata(np.concatenate([pos, neg]))
    return float((r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def collect(ids, kinds, LLx=LL):
    """per page: list of (gain_flag, base_flag, inll_flag, label)"""
    pages = {}
    for k in ids:
        it, ll = items[k], LLx.get(k)
        if not ll: continue
        rows = []
        for u in unit_scores(it, ll):
            y = label(it, u, kinds)
            if y is None: continue
            rows.append((-u['gain'], u['base'], u['inll'], y))
        if rows: pages[k] = rows
    return pages


class WAuc:
    """AUROC under page weights (a page-cluster bootstrap draws weights, not copies): one sort, then O(n) per draw"""
    def __init__(self, v, y):
        o = np.argsort(v, kind='stable'); self.o, self.y = o, y[o]; vs = v[o]
        self.lo = np.searchsorted(vs, vs, 'left'); self.hi = np.searchsorted(vs, vs, 'right')

    def __call__(self, w):
        w = w[self.o]; wn = np.where(self.y, 0.0, w); c = np.concatenate([[0.0], np.cumsum(wn)])
        below = c[self.lo]; tie = c[self.hi] - c[self.lo]
        wp = np.where(self.y, w, 0.0)
        P, N = wp.sum(), wn.sum()
        return float((wp * (below + 0.5 * tie)).sum() / (P * N)) if P and N else None


def metrics(pages, B=2000, seed=6871):
    keys = list(pages)
    arr = [np.asarray(pages[k], float) for k in keys]
    flat = np.concatenate(arr) if keys else np.zeros((0, 4))
    pid = np.concatenate([np.full(len(a), i) for i, a in enumerate(arr)]) if keys else np.zeros(0, int)
    y = flat[:, 3] == 1 if len(flat) else np.zeros(0, bool)
    out = {'pages': len(keys), 'pos_pages': int(sum(1 for a in arr if a[:, 3].any())), 'units': int(len(flat)), 'pos_units': int(y.sum())}
    if y.sum() < 5: return out
    for c, name in ((0, 'gain'), (1, 'base'), (2, 'inll')):
        out[f'auroc_{name}'] = round(auroc(flat[y, c], flat[~y, c]), 4)
        thr = np.sort(flat[:, c])[::-1][max(0, int(0.10 * len(flat)) - 1)]
        fl = flat[:, c] >= thr
        out[f'p10_{name}'] = round(float(y[fl].mean()), 4)
        out[f'r10_{name}'] = round(float(y[fl].sum() / y.sum()), 4)
        if name == 'gain': out['thr10_gain'] = round(float(-thr), 4)   # flag a unit when its mean image gain is below this
    out['base_rate'] = round(float(y.mean()), 4)
    rnd = np.random.default_rng(seed); ag_, ab_ = WAuc(flat[:, 0], y), WAuc(flat[:, 1], y)
    bs = {'gain': [], 'base': [], 'diff': []}
    for _ in range(B):
        cnt = np.bincount(rnd.integers(0, len(keys), len(keys)), minlength=len(keys)).astype(float)
        w = cnt[pid]; ag, ab = ag_(w), ab_(w)
        if ag is None or ab is None: continue
        bs['gain'].append(ag); bs['base'].append(ab); bs['diff'].append(ag - ab)
    for k, v in bs.items(): out[f'ci_{k}'] = [round(float(np.quantile(v, 0.025)), 4), round(float(np.quantile(v, 0.975)), 4)]
    return out


def bar(m):
    return bool(m.get('auroc_gain') is not None and m['auroc_gain'] >= 0.75 and m['ci_gain'][0] > 0.5 and m['ci_diff'][0] > 0)


real = [k for k, it in items.items() if not it.get('plant')]
plant = [k for k, it in items.items() if it.get('plant')]
groups = sorted({items[k]['group'] for k in real})
res = {'scored_pages': {'real': sum(1 for k in real if k in LL), 'plant': sum(1 for k in plant if k in LL)}, 'primary': {}, 'plant': {}, 'by_kind': {}, 'all_located_pages': {}}
for name, ids in [('all', real)] + [(g, [k for k in real if items[k]['group'] == g]) for g in groups]:
    m = metrics(collect(ids, REAL_KINDS)); m['bar'] = bar(m) if 'ci_gain' in m else False; res['primary'][name] = m
for name, ids in [('all', plant)] + [(p, [k for k in plant if items[k]['plant'] == p]) for p in ('word', 'sentence')]:
    res['plant'][name] = metrics(collect(ids, {'plant_word', 'plant_sentence'}))
for kd in sorted(REAL_KINDS):
    res['by_kind'][kd] = metrics(collect(real, {kd}), B=500)
res['all_located_pages']['all'] = metrics(collect([k for k in real if items[k].get('all_located')], REAL_KINDS), B=500)

if RR or R2:   # noise floor on the pages scored twice: unit-gain agreement and AUROC under each pass
    sub = [k for k in real if k in RR or k in R2]
    nf = {'pages': len(sub)}
    base_units = {k: unit_scores(items[k], LL[k]) for k in sub if k in LL}
    for tag, other in (('rerun', RR), ('res1200', R2)):
        a, b = [], []
        for k, us in base_units.items():
            if k not in other: continue
            u2 = {(u['s'], u['e']): u['gain'] for u in unit_scores(items[k], other[k])}
            for u in us:
                if (u['s'], u['e']) in u2: a.append(u['gain']); b.append(u2[(u['s'], u['e'])])
        if len(a) > 10:
            ma, mb = mean(a), mean(b)
            cov = sum((x - ma) * (y - mb) for x, y in zip(a, b)); va = sum((x - ma) ** 2 for x in a); vb = sum((y - mb) ** 2 for y in b)
            nf[tag] = {'units': len(a), 'pearson_gain': round(cov / (va * vb) ** 0.5, 4), 'median_abs_diff': round(sorted(abs(x - y) for x, y in zip(a, b))[len(a) // 2], 4),
                       'sd_gain': round((va / len(a)) ** 0.5, 4)}
            nf[tag]['auroc_this'] = metrics(collect([k for k in sub if k in other], REAL_KINDS, other), B=300)
    nf['auroc_main_same_pages'] = metrics(collect(sub, REAL_KINDS), B=300)
    res['noise_floor'] = nf

js = json.dumps(res, indent=1, ensure_ascii=False)
if opt('--out'): open(opt('--out'), 'w').write(js)
print(js)
