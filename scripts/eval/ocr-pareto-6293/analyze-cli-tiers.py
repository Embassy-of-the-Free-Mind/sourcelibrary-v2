#!/usr/bin/env python3
# PRIOR ART: scripts/eval/syriac-pareto-6295/analyze-ocr.mjs (the paired CLI-vs-lane numbers for ONE Syriac print panel,
# from its own score file) and the #6293 Part A paired table, which cli-queue-6293 computed inline and did not commit.
# Neither covers several CLI tiers across the eight #6293 charts, the capped subsample, or the nudged/plain split, so
# this does, reading build-ocr-pareto.mjs --dump-rows so every row rule (#6304 drops, CLI failed read = 1.0) is the
# chart's own.
"""
analyze-cli-tiers.py — $0, read-only. The paired comparisons and the nudge split for the #6293 CLI arms
(PREREGISTRATION-ocr-pareto-6293.md, Amendments 1 and 2).

  node scripts/eval/build-ocr-pareto.mjs --dump-rows=/tmp/rows.json
  python3 scripts/eval/ocr-pareto-6293/analyze-cli-tiers.py /tmp/rows.json > scripts/eval/results/ocr-pareto-6293/cli-tiers.json

Per chart and CLI arm, on the arm's preregistered pages (the frozen chart set; for 3.7/3.6 the capped set) after the
#6304 drops:
  - n, pages refused (#5581: an empty safety-filter read), median CER [page bootstrap 95 %];
  - paired against lite, 3 Flash and 3.8 Flash CLI on the pages both answered: wins/losses/ties, median Δ CER
    (arm − other; negative = the arm reads better) [bootstrap 95 %], two-sided sign-test p;
  - the nudge (Amendment 2): nudged share; median CER on nudged and on plain rows, each beside lite's median on the same
    rows. Descriptive.
Bootstrap: 2,000 resamples, seeded per chart × arm × comparison, so the file is reproducible.
"""
import hashlib, json, math, os, random, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'results', 'ocr-pareto-6293')
ROWS = json.load(open(sys.argv[1]))
SEL = json.load(open(os.path.join(RES, 'pages.json')))['charts']
CAP = set(json.load(open(os.path.join(RES, 'capped-set.json')))['uids'])
LITE, FLASH = 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'
ARMS = [(v, f'gemini-{v}-flash+antigravity-cli') for v in ('3.8', '3.7', '3.6')]
C38 = ARMS[0][1]


def meter(engine):
    f = os.path.join(RES, f'meter-{engine}.jsonl')
    return {f"{m['stratum']}|{m['slug']}": m for m in map(json.loads, open(f, encoding='utf-8'))} if os.path.exists(f) else {}


def seed(*k):
    return int(hashlib.sha256('|'.join(k).encode()).hexdigest()[:12], 16)


def med_ci(xs, s):
    rnd = random.Random(s)
    bs = sorted(statistics.median(rnd.choices(xs, k=len(xs))) for _ in range(2000))
    return [round(bs[49], 4), round(bs[1949], 4)]


def sign_p(w, l):
    n = w + l
    if not n:
        return None
    k = min(w, l)
    return round(min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n), 4)


def paired(a, b, pages, s):
    both = [p for p in pages if p in a and p in b and not a[p]['refused'] and not b[p]['refused']]
    if not both:
        return None
    d = [a[p]['cer'] - b[p]['cer'] for p in both]
    w, l = sum(x < 0 for x in d), sum(x > 0 for x in d)
    return {'n': len(both), 'wins': w, 'losses': l, 'ties': len(d) - w - l, 'median_delta': round(statistics.median(d), 4),
            'delta_ci95': med_ci(d, s), 'sign_p': sign_p(w, l)}


out = {'issue': 6293, 'generated_by': 'scripts/eval/ocr-pareto-6293/analyze-cli-tiers.py',
       'sign': 'median_delta = arm − other; negative means the arm reads better', 'charts': {}}
meters = {e: meter(e) for _, e in ARMS}
for chart, sel in SEL.items():
    rows = ROWS.get(chart) or []
    by = {}
    for r in rows:
        by.setdefault(r['engine'], {})[r['page']] = r
    frozen = [p for p in sel['pages'] if any(p in x for x in by.values())]
    res = {}
    for v, e in ARMS:
        if e not in by:
            continue
        pages = [p for p in frozen if v == '3.8' or p in CAP]
        have = [p for p in pages if p in by[e]]
        if len(have) < len(pages):
            res[v] = {'n_set': len(pages), 'n_scored': len(have), 'incomplete': True}
            continue
        ans = [p for p in pages if not by[e][p]['refused']]
        cers = [by[e][p]['cer'] for p in ans]
        r = {'n_set': len(pages), 'capped': len(pages) < len(frozen), 'refused': len(pages) - len(ans),
             'median_cer': round(statistics.median(cers), 4), 'cer_ci95': med_ci(cers, seed(chart, e, 'med'))}
        for name, other in (('vs_lite', LITE), ('vs_3_flash', FLASH), ('vs_3_8_cli', C38)):
            if other != e and other in by:
                r[name] = paired(by[e], by[other], pages, seed(chart, e, other))
        m = meters[e]
        nud = [p for p in ans if m.get(p, {}).get('nudged')]
        pln = [p for p in ans if p not in set(nud)]
        lite = by.get(LITE, {})

        def split(ps):
            if not ps:
                return {'n': 0}
            lp = [lite[p]['cer'] for p in ps if p in lite and not lite[p]['refused']]
            return {'n': len(ps), 'median_cer': round(statistics.median(by[e][p]['cer'] for p in ps), 4),
                    'lite_median_same_rows': round(statistics.median(lp), 4) if lp else None}
        r['nudge'] = {'nudged_share': round(len(nud) / len(ans), 3) if ans else None, 'nudged': split(nud), 'plain': split(pln)}
        res[v] = r
    if res:
        out['charts'][chart] = res
json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
print()
