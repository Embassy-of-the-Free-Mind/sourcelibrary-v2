"""PRIOR ART: overview-score.mjs scores ONE run (rates); nothing compared two review runs of the same packets (#6174).
Repeated-measures agreement between shelf-overview review runs.
Usage: python3 scripts/eval/spot-check/review-agreement.py NAME=reviews_dir [NAME=reviews_dir ...] > report
Per page: serious (same definition as overview-score.mjs), right_page, ocr_score, tr_score, serious error classes.
Per book: fit_to_show. Pairwise: % agreement, Cohen's kappa, weighted kappa (verdict), Spearman (scores),
class-level Jaccard on pages both runs flagged. Plus Fleiss' kappa across all runs and a bootstrap CI by book.
"""
import json, glob, os, sys, random, itertools, collections

FIT = {'show': 0, 'show_with_caveat': 1, 'do_not_show': 2}

def load(d):
    pages, books = {}, {}
    for f in glob.glob(os.path.join(d, '*.json')):
        for b in json.load(open(f)):
            books[b['book_id']] = FIT.get(b.get('fit_to_show'))
            for p in b.get('pages', []):
                errs = (p.get('ocr_errors') or []) + (p.get('tr_errors') or []) + (p.get('other') or [])
                ser = any(e.get('severity') == 'serious' for e in errs) or p.get('right_page') == 'no'
                classes = {str(e.get('class', '?'))[:3] for e in errs if e.get('severity') == 'serious'}
                pages[(b['book_id'], p.get('page_number'))] = dict(
                    serious=int(ser), wrong=int(p.get('right_page') == 'no'), ocr=p.get('ocr_score'), tr=p.get('tr_score'),
                    classes=classes, book=b['book_id'])
    return pages, books

def kappa(a, b, cats):
    n = len(a)
    if not n: return None
    po = sum(x == y for x, y in zip(a, b)) / n
    pe = sum((a.count(c) / n) * (b.count(c) / n) for c in cats)
    return None if pe == 1 else (po - pe) / (1 - pe)

def wkappa(a, b, k=3):  # linear weights
    n = len(a)
    if not n: return None
    w = lambda i, j: 1 - abs(i - j) / (k - 1)
    po = sum(w(x, y) for x, y in zip(a, b)) / n
    pa = [a.count(c) / n for c in range(k)]; pb = [b.count(c) / n for c in range(k)]
    pe = sum(pa[i] * pb[j] * w(i, j) for i in range(k) for j in range(k))
    return None if pe == 1 else (po - pe) / (1 - pe)

def spearman(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3: return None
    def rank(v):
        s = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v); i = 0
        while i < len(s):
            j = i
            while j + 1 < len(s) and v[s[j + 1]] == v[s[i]]: j += 1
            for t in range(i, j + 1): r[s[t]] = (i + j) / 2
            i = j + 1
        return r
    x, y = rank([p[0] for p in pairs]), rank([p[1] for p in pairs])
    mx, my = sum(x) / len(x), sum(y) / len(y)
    num = sum((a - mx) * (b - my) for a, b in zip(x, y))
    den = (sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y)) ** 0.5
    return num / den if den else None

def boot_kappa(keys, A, B, field, reps=2000):
    books = sorted({k[0] for k in keys}); by = collections.defaultdict(list)
    for k in keys: by[k[0]].append(k)
    out = []
    rnd = random.Random(1)
    for _ in range(reps):
        ks = [k for bk in (rnd.choice(books) for _ in books) for k in by[bk]]
        v = kappa([A[k][field] for k in ks], [B[k][field] for k in ks], [0, 1])
        if v is not None: out.append(v)
    out.sort()
    return (out[int(.025 * len(out))], out[int(.975 * len(out))]) if out else None

def fleiss(runs, keys, field):
    n = len(runs); N = len(keys)
    if N == 0: return None
    P = []; tot = [0, 0]
    for k in keys:
        c = [sum(r[k][field] == v for r in runs) for v in (0, 1)]
        tot[0] += c[0]; tot[1] += c[1]
        P.append((sum(x * x for x in c) - n) / (n * (n - 1)))
    Pbar = sum(P) / N; pj = [t / (N * n) for t in tot]; Pe = sum(p * p for p in pj)
    return None if Pe == 1 else (Pbar - Pe) / (1 - Pe)

def kalpha(units, level='nominal'):
    """Krippendorff's alpha; units = lists of values, None = missing (a page one run did not return). Same formula as
    scripts/eval/second-reader/lib.mjs krippendorffAlpha, pinned there to Krippendorff (2011): 0.743 / 0.815 / 0.849."""
    vals = [[v for v in u if v is not None] for u in units]
    vals = [u for u in vals if len(u) >= 2]
    if not vals: return None
    cats = sorted({v for u in vals for v in u}); ix = {c: i for i, c in enumerate(cats)}; K = len(cats)
    o = [[0.0] * K for _ in range(K)]
    for u in vals:
        m = len(u)
        for i in range(m):
            for j in range(m):
                if i != j: o[ix[u[i]]][ix[u[j]]] += 1 / (m - 1)
    nc = [sum(r) for r in o]; n = sum(nc)
    def d2(c, k):
        if level == 'nominal': return 0 if c == k else 1
        if level == 'interval': return (cats[c] - cats[k]) ** 2
        lo, hi = min(c, k), max(c, k)
        return (sum(nc[lo:hi + 1]) - (nc[c] + nc[k]) / 2) ** 2
    Do = sum(o[c][k] * d2(c, k) for c in range(K) for k in range(K)) / n
    De = sum(nc[c] * nc[k] * d2(c, k) for c in range(K) for k in range(K)) / (n * (n - 1))
    return None if De == 0 else 1 - Do / De

def f(x): return '—' if x is None else f'{x:.2f}'

runs = {}
for arg in sys.argv[1:]:
    name, d = arg.split('=', 1); runs[name] = load(d)
names = list(runs)
print('runs:', ', '.join(f'{n}: {len(runs[n][0])} pages / {len(runs[n][1])} books, serious rate {sum(p["serious"] for p in runs[n][0].values())/max(len(runs[n][0]),1):.0%}' for n in names))
print()
print('| pair | pages | serious agree | serious κ [95% CI by book] | wrong-leaf κ | OCR score ρ | EN score ρ | class Jaccard (both serious) | books | verdict agree | verdict weighted κ |')
print('|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|')
for a, b in itertools.combinations(names, 2):
    A, BA = runs[a]; B, BB = runs[b]
    keys = sorted(set(A) & set(B), key=str)
    sa = [A[k]['serious'] for k in keys]; sb = [B[k]['serious'] for k in keys]
    agree = sum(x == y for x, y in zip(sa, sb)) / len(keys) if keys else None
    ci = boot_kappa(keys, A, B, 'serious')
    both = [k for k in keys if A[k]['serious'] and B[k]['serious'] and (A[k]['classes'] or B[k]['classes'])]
    jac = sum(len(A[k]['classes'] & B[k]['classes']) / len(A[k]['classes'] | B[k]['classes']) for k in both) / len(both) if both else None
    bk = [k for k in set(BA) & set(BB) if BA[k] is not None and BB[k] is not None]
    va = [BA[k] for k in bk]; vb = [BB[k] for k in bk]
    vag = sum(x == y for x, y in zip(va, vb)) / len(bk) if bk else None
    print(f"| {a}–{b} | {len(keys)} | {f(agree)} | {f(kappa(sa, sb, [0, 1]))} [{f(ci[0]) if ci else '—'}, {f(ci[1]) if ci else '—'}] | "
          f"{f(kappa([A[k]['wrong'] for k in keys], [B[k]['wrong'] for k in keys], [0, 1]))} | "
          f"{f(spearman([A[k]['ocr'] for k in keys], [B[k]['ocr'] for k in keys]))} | {f(spearman([A[k]['tr'] for k in keys], [B[k]['tr'] for k in keys]))} | "
          f"{f(jac)} (n={len(both)}) | {len(bk)} | {f(vag)} | {f(wkappa(va, vb))} |")
common = set.intersection(*(set(runs[n][0]) for n in names))
if len(names) > 2:
    print(f"\nFleiss κ across all {len(names)} runs, serious flag, {len(common)} pages: {f(fleiss([runs[n][0] for n in names], sorted(common, key=str), 'serious'))}")
# Krippendorff's alpha over the UNION of pages: a page one run did not return is missing, not dropped (#6338).
union = sorted(set().union(*(set(runs[n][0]) for n in names)), key=str)
col = lambda fld: [[runs[n][0][k][fld] if k in runs[n][0] else None for n in names] for k in union]
print(f"\nKrippendorff α across {len(names)} runs, {len(union)} pages (missing allowed): serious (nominal) {f(kalpha(col('serious')))}, "
      f"OCR score (ordinal) {f(kalpha(col('ocr'), 'ordinal'))}, English score (ordinal) {f(kalpha(col('tr'), 'ordinal'))}")
# per-stratum serious-rate stability
print('\nserious-page rate by book-tradition prefix is in each run\'s overview-score report.')
