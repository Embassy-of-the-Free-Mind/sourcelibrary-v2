#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-pareto-6293/analyze-cli-tiers.py — the same paired statistics (median Δ, page bootstrap,
# sign test) for the Amendment 2 tiers, but it is a fixed report over 3.8/3.7/3.6 and has no repeat arm, no mean Δ, no
# plan-note or doubled-reply counts and no decision rule, so this file reuses its method for Amendment 3.
"""
analyze-cli-effort.py — $0, read-only. Amendment 3 of PREREGISTRATION-ocr-pareto-6293.md: is the CLI gap to 3 Flash on
Latin and Early English the model, or the route and its effort level?

  R=scripts/eval/results/ocr-pareto-6293
  python3 scripts/eval/ocr-pareto-6293/analyze-cli-effort.py $R/cli-effort-rows.json \
      --meter-rep $R/meter-gemini-3.8-flash+antigravity-cli-rep.jsonl \
      --outputs-rep $R/outputs-gemini-3.8-flash+antigravity-cli-rep.jsonl > $R/cli-effort.json

cli-effort-rows.json is the Latin and Early English slice of `build-ocr-pareto.mjs --dump-rows` run with the repeat
engine scored beside the chart engines (the chart itself never takes the repeat), so every row rule (#6304 drops, a
CLI failed read = CER 1.0) is the chart's own.

Per panel (latin, english; the frozen set after the #6304 drops):
  - median CER [page bootstrap 95 %] for C38H, C38L-rep, stored C38, 3 Flash, lite;
  - paired (pages both answered; refusals out, empties in at CER 1.0, the chart's rule): median Δ and mean Δ (arm −
    other; negative = the arm reads better) with page bootstrap 95 % CIs, W/L/T, sign-test p, for C38H vs C38,
    C38H vs 3 Flash, C38H vs lite, C38L-rep vs C38, and C38H vs C38L-rep;
  - per CLI arm: nudged share, plan-note share, doubled replies, refusals, empties after 2 attempts;
  - per CLI arm, what each reply is (clean, empty, safety-cut, prose refusal, plan/agent note, doubled), and how many
    of each score above 0.5 CER;
  - sensitivity (not the rule): the same C38H comparisons on the pages C38H returned text for, and each CLI arm
    against 3 Flash and lite on its clean replies only;
  - the preregistered branch: route/effort, model, or route noise.
Bootstrap: 2,000 resamples, seeded per panel × comparison.
"""
import hashlib, json, math, os, random, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'results', 'ocr-pareto-6293')
opt = lambda k, d=None: sys.argv[sys.argv.index(f'--{k}') + 1] if f'--{k}' in sys.argv else d
ROWS = json.load(open(sys.argv[1]))
SEL = json.load(open(os.path.join(RES, 'pages.json')))['charts']
LITE, FLASH = 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'
C38, C38H, REP = 'gemini-3.8-flash+antigravity-cli', 'gemini-3.8-flash-high+antigravity-cli', 'gemini-3.8-flash+antigravity-cli-rep'
NAMES = {C38: 'C38 (stored)', C38H: 'C38H', REP: 'C38L-rep', FLASH: '3 Flash', LITE: 'lite'}
METER = {C38: os.path.join(RES, f'meter-{C38}.jsonl'), C38H: os.path.join(RES, f'meter-{C38H}.jsonl'), REP: opt('meter-rep')}
OUTS = {C38: os.path.join(RES, f'outputs-{C38}.jsonl'), C38H: os.path.join(RES, f'outputs-{C38H}.jsonl'), REP: opt('outputs-rep')}
# The plan-mode note (Amendment 2's sensitivity rule, cli-queue-b-6293 strip.py): a first line "I have … plan/artifact".
NOTE = re.compile(r"^\s*(I have|I've)\b.*\b(plan|artifact|transcri\w*|image|manuscript)\b", re.I)


def jl(f):
    return [json.loads(l) for l in open(f, encoding='utf-8') if l.strip()] if f and os.path.exists(f) else []


PROSE = re.compile(r"(unable to (provide|reproduce)|cannot (provide|reproduce)|can't (provide|reproduce)|summar(y|ize)|content (filter|safety)|copyright)", re.I)


def kind(t, m):
    # What a CLI reply is, by eye-checked surface shape (2026-10-09): the first match wins.
    if not t.strip():
        return 'empty'
    if m.get('finishReason') == 'SAFETY':
        return 'safety-cut'
    if PROSE.search(t[-600:]) or PROSE.search(t[:300]):
        return 'prose-refusal'
    if NOTE.search(t.split('\n')[0]) or t.startswith('The user invoked'):
        return 'plan/agent note'
    if doubled(t):
        return 'doubled'
    return 'clean'


def doubled(t):
    # The same reply emitted twice: the opening 120 non-space characters recur later in the text.
    s = re.sub(r'\s+', '', t)
    return len(s) > 400 and s[:120] in s[120:]


def seed(*k):
    return int(hashlib.sha256('|'.join(k).encode()).hexdigest()[:12], 16)


def ci(xs, s, f=statistics.median):
    rnd = random.Random(s)
    bs = sorted(f(rnd.choices(xs, k=len(xs))) for _ in range(2000))
    return [round(bs[49], 4), round(bs[1949], 4)]


def sign_p(w, l):
    n = w + l
    return None if not n else round(min(1.0, 2 * sum(math.comb(n, i) for i in range(min(w, l) + 1)) / 2 ** n), 4)


def paired(a, b, pages, s):
    both = [p for p in pages if p in a and p in b and not a[p]['refused'] and not b[p]['refused']]
    if not both:
        return None
    d = [a[p]['cer'] - b[p]['cer'] for p in both]
    w, l = sum(x < 0 for x in d), sum(x > 0 for x in d)
    return {'n': len(both), 'wins': w, 'losses': l, 'ties': len(d) - w - l,
            'median_delta': round(statistics.median(d), 4), 'median_delta_ci95': ci(d, s),
            'mean_delta': round(statistics.mean(d), 4), 'mean_delta_ci95': ci(d, s + 1, statistics.mean), 'sign_p': sign_p(w, l)}


def contains0(c):
    return c is not None and c[0] <= 0 <= c[1]


meters = {e: {f"{m['stratum']}|{m['slug']}": m for m in jl(f)} for e, f in METER.items()}
texts = {e: {f"{o['stratum']}|{o['slug']}": o['text'] for o in jl(f)} for e, f in OUTS.items()}
out = {'issue': 6293, 'amendment': 3, 'generated_by': 'scripts/eval/ocr-pareto-6293/analyze-cli-effort.py',
       'sign': 'delta = arm − other; negative means the arm reads better', 'panels': {}}
for chart in ('latin', 'english'):
    by = {}
    for r in ROWS.get(chart) or []:
        by.setdefault(r['engine'], {})[r['page']] = r
    pages = [p for p in SEL[chart]['pages'] if any(p in by.get(e, {}) for e in (LITE, FLASH))]
    res = {'n_frozen_after_drops': len(pages), 'arms': {}, 'paired': {}, 'sensitivity_c38h_answered': {}}
    for e in (C38H, REP, C38, FLASH, LITE):
        if e not in by:
            res['arms'][NAMES[e]] = None
            continue
        have = [p for p in pages if p in by[e]]
        ans = [p for p in have if not by[e][p]['refused']]
        cers = [by[e][p]['cer'] for p in ans]
        a = {'engine': e, 'n_scored': len(have), 'refused': len(have) - len(ans),
             'median_cer': round(statistics.median(cers), 4), 'cer_ci95': ci(cers, seed(chart, e, 'med'))}
        if e in meters:
            m, t = meters[e], texts[e]
            a.update({'nudged': sum(1 for p in have if m.get(p, {}).get('nudged')),
                      'empty_after_2': sum(1 for p in have if m.get(p, {}).get('finishReason') == 'CLI_EMPTY'),
                      'safety_cut': sum(1 for p in have if m.get(p, {}).get('finishReason') == 'SAFETY'),
                      'plan_note': sum(1 for p in have if NOTE.search((t.get(p) or '').split('\n')[0])),
                      'doubled': sum(1 for p in have if doubled(t.get(p) or ''))})
            ks = [kind(t.get(p) or '', m.get(p, {})) for p in have]
            a['reply_kinds'] = {k: ks.count(k) for k in sorted(set(ks))}
            a['reply_kinds_cer_over_0_5'] = {k: sum(1 for p, kk in zip(have, ks) if kk == k and by[e][p]['cer'] > 0.5) for k in sorted(set(ks))}
        res['arms'][NAMES[e]] = a
    for x, y in ((C38H, C38), (C38H, FLASH), (C38H, LITE), (REP, C38), (C38H, REP), (C38, FLASH), (REP, FLASH)):
        if x in by and y in by:
            res['paired'][f'{NAMES[x]} vs {NAMES[y]}'] = paired(by[x], by[y], pages, seed(chart, x, y))
    if C38H in by:
        txt = [p for p in pages if (texts[C38H].get(p) or '').strip()]
        res['sensitivity_c38h_answered']['n'] = len(txt)
        for y in (C38, FLASH, LITE, REP):
            if y in by:
                res['sensitivity_c38h_answered'][f'C38H vs {NAMES[y]}'] = paired(by[C38H], by[y], txt, seed(chart, 'txt', y))
    # Sensitivity (not the rule): reading quality where the CLI reply is a clean transcription, i.e. none of the
    # route's failure shapes above, for each CLI arm against 3 Flash and lite.
    res['sensitivity_clean_replies'] = {}
    for e in (C38H, REP, C38):
        if e in by:
            clean = [p for p in pages if p in by[e] and kind(texts[e].get(p) or '', meters[e].get(p, {})) == 'clean']
            res['sensitivity_clean_replies'][NAMES[e]] = {'n': len(clean), 'median_cer': round(statistics.median(by[e][p]['cer'] for p in clean), 4) if clean else None,
                **{f'vs {NAMES[y]}': paired(by[e], by[y], clean, seed(chart, 'clean', e, y)) for y in (FLASH, LITE)}}
    rep, hf = res['paired'].get('C38L-rep vs C38 (stored)'), res['paired'].get('C38H vs 3 Flash')
    if rep and hf:
        if not contains0(rep['median_delta_ci95']):
            branch = 'route noise: C38L-rep does not reproduce C38'
        elif hf['median_delta_ci95'][0] > 0:
            branch = 'model: C38L-rep reproduces C38 and C38H stays behind 3 Flash'
        else:
            branch = 'route/effort: C38L-rep reproduces C38 and C38H closes the gap to 3 Flash'
        res['branch'] = branch
    out['panels'][chart] = res
json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
print()
