#!/usr/bin/env python3
# PRIOR ART: scripts/eval/opus10-6690/score.py (PR #6700) — parse_obj, decode, locate, the page bootstrap, the
# book-then-page bootstrap and the plant catch are its code. New here: three arms and two judges, a page's score is the
# mean of its two label orders, the pairwise O10 − F / O1 − F / O10 − O1 tables per judge, position bias, and the
# judges' agreement through scripts/eval/lib/agreement-stats.mjs judgeReliability() (eval-design.md §2, #6730).
"""
score.py — $0. Reads $W/judge/{key.json, texts.json} and one out file per judge:
  $W/judge/out-opus.jsonl   (claude-arm.py --sealed, Opus)       $W/judge/out-g38h.jsonl  (run-cli-arm.py, gemini-3.8-flash-high)
Writes scripts/eval/results/opus10-flash-6690/scores.json (numbers only) and prints the tables.
"""
import importlib.util, json, os, random, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
W = os.environ.get('W6690', os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'w'))
RESULTS = os.path.join(HERE, '..', 'results', 'opus10-flash-6690')
sys.path.insert(0, os.path.join(HERE, '..', 'pro-translate-6545'))
from prompts import unwrap  # noqa: E402
spec = importlib.util.spec_from_file_location('scorexl', os.path.join(HERE, '..', 'pareto-6182', 'score-xl.py'))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)
read = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
B = 2000
RUNS = ['fa', 'sa', 'zh', 'grc', 'he']
LANG = {'fa': 'Persian', 'sa': 'Sanskrit', 'zh': 'Chinese', 'grc': 'Greek', 'he': 'Hebrew'}
ARMS = ['O1', 'O10', 'F']
PAIRS = [('O10', 'F'), ('O1', 'F'), ('O10', 'O1')]
JUDGES = {'opus': 'Opus 5.5 (claude -p, sealed)', 'g38h': 'gemini-3.8-flash-high (agy -p)'}

KEY = json.load(open(f'{W}/judge/key.json')); ITEMS = KEY['items']
TEXTS = json.load(open(f'{W}/judge/texts.json'))
mean = lambda x: sum(x) / len(x) if x else None
norm_ws = lambda s: re.sub(r'\s+', ' ', s).strip().lower()


def parse_obj(raw):
    t, _ = unwrap(raw)
    m = re.search(r'\{[\s\S]*\}', t)
    if not m: return None
    try: return json.loads(m.group(0))
    except ValueError: return None


def decode(o, labels):
    tier = {}
    for t, grp in enumerate(o.get('ranking') or []):
        for l in (grp if isinstance(grp, list) else [grp]): tier[l] = t
    res = {}
    for l, s in (o.get('scores') or {}).items():
        if l not in labels or not isinstance(s, dict): continue
        try: n = sx.norm(s, tier.get(l))
        except Exception: continue
        try: n['fid'] = float(n['fid']) if n['fid'] is not None else None
        except (TypeError, ValueError): n['fid'] = None
        n['spans'] = [x for x in (s.get('spans') or []) if isinstance(x, dict) and x.get('quote')]
        n['revq'] = (s.get('reversal') or {}).get('candidate') if isinstance(s.get('reversal'), dict) else None
        n['label'] = l
        res[labels[l]] = n
    return res


def load(j):
    p = f'{W}/judge/out-{j}.jsonl'; dec = {}
    if not os.path.exists(p): return dec
    last = {}
    for r in read(p):
        if r.get('text') or r['uid'] not in last: last[r['uid']] = r
    for u, r in last.items():
        o = parse_obj(r.get('raw') or r.get('text') or '')
        if o and u in ITEMS: dec[u] = decode(o, ITEMS[u]['labels'])
    return dec


DEC = {j: load(j) for j in JUDGES}


def ci(vals):
    vals = sorted(v for v in vals if v is not None)
    return [round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3)] if vals else None


def boot(rows, stat, seed=6690):
    rng = random.Random(seed)
    return ci([stat([rows[rng.randrange(len(rows))] for _ in rows]) for _ in range(B)]) if len(rows) > 1 else None


def boot_cluster(rows, run_of, stat, seed=6690):
    """Resample books (runs), then pages within each drawn book."""
    rng = random.Random(seed); by = {}
    for r in rows: by.setdefault(run_of(r), []).append(r)
    ks = list(by); out = []
    for _ in range(B):
        d = []
        for k in (ks[rng.randrange(len(ks))] for _ in ks):
            g = by[k]; d += [g[rng.randrange(len(g))] for _ in g]
        out.append(stat(d))
    return ci(out)


# ---------- per page, per judge: the mean of the two label orders ----------
def page_scores(j, kind='ARMS', field='fid'):
    """{page_id: {arm: value}} averaged over the orders the judge returned (a page needs every arm in some order)."""
    acc = {}
    for i, k in ITEMS.items():
        if k['kind'] != kind or i not in DEC[j]: continue
        for arm, d in DEC[j][i].items():
            v = d.get(field)
            if v is None: continue
            acc.setdefault(k['page_id'], {}).setdefault(arm, []).append(float(v))
    return {p: {a: mean(v) for a, v in arms.items()} for p, arms in acc.items()}


RUN_OF = {k['page_id']: k['run'] for k in ITEMS.values()}


def arm_table(j, pages):
    S = page_scores(j); OM = page_scores(j, field='om')
    out = {}
    for a in ARMS:
        rows = [p for p in pages if p in S and a in S[p]]
        if not rows: continue
        out[a] = {'n': len(rows), 'fidelity': round(mean([S[p][a] for p in rows]), 3),
                  'ci_by_page': boot(rows, lambda d: mean([S[p][a] for p in d])),
                  'omission_pct': round(100 * mean([OM[p][a] for p in rows if a in OM.get(p, {})]), 1)}
        if len({RUN_OF[p] for p in rows}) > 1:
            out[a]['ci_by_book_then_page'] = boot_cluster(rows, RUN_OF.get, lambda d: mean([S[p][a] for p in d]))
    return out


def paired(j, pages, x, y):
    S = page_scores(j)
    rows = [p for p in pages if p in S and x in S[p] and y in S[p]]
    if not rows: return None
    d = lambda s: mean([S[p][x] - S[p][y] for p in s])
    w = sum(1 for p in rows if S[p][x] > S[p][y]); l = sum(1 for p in rows if S[p][x] < S[p][y])
    out = {'n': len(rows), 'mean': round(d(rows), 3), 'ci_by_page': boot(rows, d), 'better': w, 'worse': l, 'ties': len(rows) - w - l}
    if len({RUN_OF[p] for p in rows}) > 1: out['ci_by_book_then_page'] = boot_cluster(rows, RUN_OF.get, d)
    return out


def position(j):
    """Mean fidelity by label position (T1/T2/T3) over ARMS items, and order A vs B agreement per (page, arm)."""
    pos = {}
    by = {}
    for i, k in ITEMS.items():
        if k['kind'] != 'ARMS' or i not in DEC[j]: continue
        for arm, d in DEC[j][i].items():
            if d['fid'] is None: continue
            pos.setdefault(d['label'], []).append(d['fid'])
            by.setdefault((k['page_id'], arm), {})[k['order']] = d['fid']
    both = [(v['A'], v['B']) for v in by.values() if 'A' in v and 'B' in v]
    # arm-relative position effect: fidelity minus the page-arm mean, by position
    rel = {}
    for i, k in ITEMS.items():
        if k['kind'] != 'ARMS' or i not in DEC[j]: continue
        for arm, d in DEC[j][i].items():
            v = by.get((k['page_id'], arm), {})
            if d['fid'] is None or len(v) < 2: continue
            rel.setdefault(d['label'], []).append(d['fid'] - mean(list(v.values())))
    return {'mean_by_position': {t: round(mean(v), 3) for t, v in sorted(pos.items())},
            'relative_by_position': {t: round(mean(v), 3) for t, v in sorted(rel.items())},
            'order_pairs': len(both), 'order_identical': sum(1 for a, b in both if a == b),
            'order_mean_abs_diff': round(mean([abs(a - b) for a, b in both]), 3) if both else None}


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


def plants(j):
    """A plant is LOCATED when a span/reversal quote lands on the planted sentence, LOWER when the planted copy scores
    below the same page's unplanted O1 (both as the same order's score where possible, else the page mean)."""
    S = page_scores(j); rows = []
    for i, k in ITEMS.items():
        if k['kind'] != 'PLANT' or i not in DEC[j]: continue
        d = DEC[j][i].get('O1_PLANT')
        if not d: continue
        text = TEXTS[i][d['label']]; pl = k['plant']
        pos = norm_ws(text).find(norm_ws(pl['new'])[:60])
        region = (pos, pos + len(norm_ws(pl['new']))) if pos >= 0 else None
        quotes = [s['quote'] for s in d['spans']] + ([d['revq']] if d['revq'] else [])
        located = bool(region) and any((lambda loc: loc and loc[0] < region[1] + 20 and loc[1] > region[0] - 20)(locate(q, text)) for q in quotes)
        same = next((x for x, kk in ITEMS.items() if kk['kind'] == 'ARMS' and kk['page_id'] == k['page_id'] and kk['order'] == k['order']), None)
        ref = (DEC[j].get(same, {}).get('O1') or {}).get('fid') if same else None
        if ref is None: ref = S.get(k['page_id'], {}).get('O1')
        rows.append({'item': i, 'run': k['run'], 'order': k['order'], 'kind': pl['kind'], 'how': pl.get('how'), 'located': located, 'fid': d['fid'],
                     'O1_fid_unplanted': ref, 'lower': d['fid'] is not None and ref is not None and d['fid'] < ref})
    return {'n': len(rows), 'located': sum(r['located'] for r in rows), 'lower': sum(r['lower'] for r in rows), 'rows': rows}


# ---------- judge agreement (eval-design §2): alpha per judged measure, bootstrap by book ----------
def alpha(measures):
    """measures: {name: {level, units: [{cluster, values}]}} → {name: {alpha, ci, n_units, level, verdict, line}} via node."""
    js = ("import { judgeReliability, reliabilityLine } from '" + os.path.abspath(os.path.join(HERE, '..', 'lib', 'agreement-stats.mjs')) + "';\n"
          "let s=''; process.stdin.on('data', (c) => { s += c; }); process.stdin.on('end', () => {\n"
          "  let seed = 6690; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };\n"
          "  const M = JSON.parse(s), out = {};\n"
          "  for (const [k, m] of Object.entries(M)) { const r = judgeReliability(m.units, { level: m.level, rng }); out[k] = { ...r, line: reliabilityLine(k, r, m.unit) }; }\n"
          "  process.stdout.write(JSON.stringify(out)); });\n")
    r = subprocess.run(['node', '--input-type=module', '-e', js], input=json.dumps(measures), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def agreement():
    """Units are (item, arm) over ARMS items: both judges saw exactly the same item text and order."""
    fid, om, best = [], [], []
    for i, k in ITEMS.items():
        if k['kind'] != 'ARMS': continue
        a, b = DEC['opus'].get(i), DEC['g38h'].get(i)
        for arm in ARMS:
            fid.append({'cluster': k['run'], 'values': [(a or {}).get(arm, {}).get('fid'), (b or {}).get(arm, {}).get('fid')]})
            om.append({'cluster': k['run'], 'values': [(a or {}).get(arm, {}).get('om'), (b or {}).get(arm, {}).get('om')]})

        def top(d):
            if not d: return None
            t = [x for x in ARMS if (d.get(x) or {}).get('tier') == 0]
            return t[0] if len(t) == 1 else ('tie' if t else None)
        best.append({'cluster': k['run'], 'values': [top(a), top(b)]})
    # the routing question per page: is O10 above, level with or below F (page means over orders)
    So, Sg = page_scores('opus'), page_scores('g38h')
    sgn = lambda S, p: None if p not in S or 'O10' not in S[p] or 'F' not in S[p] else (S[p]['O10'] > S[p]['F']) - (S[p]['O10'] < S[p]['F'])
    o10f = [{'cluster': RUN_OF[p], 'values': [sgn(So, p), sgn(Sg, p)]} for p in sorted(set(So) | set(Sg)) if ITEMS and p in RUN_OF]
    return alpha({'fidelity': {'level': 'ordinal', 'units': fid, 'unit': 'item×arm ratings'},
                  'omission': {'level': 'nominal', 'units': om, 'unit': 'item×arm ratings'},
                  'best arm': {'level': 'nominal', 'units': best, 'unit': 'items'},
                  'O10 vs F (page sign)': {'level': 'ordinal', 'units': o10f, 'unit': 'pages'}})


def main():
    pages_all = sorted({k['page_id'] for k in ITEMS.values() if k['kind'] == 'ARMS'})
    S = {'judges': JUDGES, 'items': len(ITEMS), 'missing': KEY.get('missing'), 'flash_failures': KEY.get('flash_failures'),
         'judged': {j: len(DEC[j]) for j in JUDGES}, 'by_judge': {}}
    for j in JUDGES:
        if not DEC[j]: continue
        J = {'arms': arm_table(j, pages_all), 'paired': {f'{x}-{y}': paired(j, pages_all, x, y) for x, y in PAIRS},
             'by_run': {r: {'arms': arm_table(j, [p for p in pages_all if RUN_OF[p] == r]),
                            'paired': {f'{x}-{y}': paired(j, [p for p in pages_all if RUN_OF[p] == r], x, y) for x, y in PAIRS}} for r in RUNS},
             'position': position(j), 'plants': plants(j)}
        S['by_judge'][j] = J
    if DEC['opus'] and DEC['g38h']: S['agreement'] = agreement()
    # the brief's rule: O10 to Opus-10 routing only if O10 beats F under BOTH judges, book-clustered CI excluding 0
    rule = {}
    for j in S['by_judge']:
        p = S['by_judge'][j]['paired']['O10-F']
        c = (p or {}).get('ci_by_book_then_page')
        rule[j] = {'mean': p and p['mean'], 'ci_by_book_then_page': c, 'ci_by_page': p and p['ci_by_page'], 'excludes_0_above': bool(c and c[0] > 0)}
    S['routing_rule'] = {'per_judge': rule, 'route_O10': len(rule) == 2 and all(v['excludes_0_above'] for v in rule.values())}
    os.makedirs(RESULTS, exist_ok=True)
    json.dump(S, open(f'{RESULTS}/scores.json', 'w'), ensure_ascii=False, indent=1)
    print('judged', S['judged'], '/', len(ITEMS), 'missing', S['missing'], 'flash failures', S['flash_failures'])
    for j, J in S['by_judge'].items():
        print(f'\n== {JUDGES[j]}')
        for a, t in J['arms'].items(): print(f'  {a}: {t}')
        for k, v in J['paired'].items(): print(f'  {k}: {v}')
        for r in RUNS:
            b = J['by_run'][r]
            print(f'  {LANG[r]:9}', {a: b['arms'][a]['fidelity'] for a in b['arms']}, {k: (v['mean'], v['ci_by_page'], f"+{v['better']}/-{v['worse']}/={v['ties']}") for k, v in b['paired'].items() if v})
        print('  position', J['position']); print('  plants', {k: v for k, v in J['plants'].items() if k != 'rows'})
    for k, v in (S.get('agreement') or {}).items(): print(' ', v['line'])
    print('\nrouting rule', json.dumps(S['routing_rule']))


if __name__ == '__main__':
    main()
