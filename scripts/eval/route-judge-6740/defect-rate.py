#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/defect-rate.mjs (stage 1, the inventory this reads) and
# scripts/eval/estimator/router-table/build.py (the k/n router this is compared against; its rules.json cells, evidence
# lists and stage prices are read, never forked). judge.mjs clusterCI is the by-book bootstrap idea, re-done here for a
# RATIO (defects / words), which clusterCI (a mean of per-page values) does not give.
"""Defect rates per 1,000 words, a gamma-Poisson rate model, and the preregistered rule (#6740). Stage 2 of 2.

  python3 scripts/eval/route-judge-6740/defect-rate.py --rows $JOB_SCRATCH/dr/rows-with-text.jsonl.gz \
      [--recheck $JOB_SCRATCH/dr/recheck.jsonl] --out scripts/eval/route-judge-6740/results/defect-rate-2026-10-30
      (repo root; stdlib only, no model calls; --recheck: defect-rate.mjs recheck's output, for amendment S1)
  python3 scripts/eval/route-judge-6740/defect-rate.py --add-pooled scripts/eval/route-judge-6740/results/defect-rate-2026-10-30
      (pools the later studies in ADD into that score.json's router cells and rewrites defect-rates.json; no --rows)

The rule is RULE.md in --out, committed before this ran (950d1cb75). Writes score.json (everything; prices as Claude points / agy calls,
never dollars, build.py's convention; a break-even weight is in dollars per defect at rules.json's default plan fee) and scripts/eval/estimator/router-table/defect-rates.json (the per-route fields
build.py shows beside k/n). Nothing here changes a live route.
"""
import collections, gzip, json, math, os, random, re, statistics, sys, zlib
sh = lambda x: zlib.crc32(repr(x).encode())   # a stable hash (Python's hash() is salted per process)

arg = lambda f, d=None: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else d
ROWS, OUT, RECHECK = arg('--rows'), arg('--out'), arg('--recheck')
RT = 'scripts/eval/estimator/router-table/'
SEED, BOOT = 6740, 2000
SEV = ('cosmetic', 'misleads', 'wrong_text')
CAL = None
DELTA = 0.15                     # RULE.md 2: wrong-text gate, per 1,000 words above the bar
A0_WORDS = 2.0                   # RULE.md: the prior weighs at most 2,000 words
WM = (0.001, 0.01, 0.1)          # RULE.md 3: w_m sensitivity; 0.01 is the rule
MIN_PAGES = 10                   # RULE.md 1: a route is rated with >= 10 item pages with words
CEIL = 1.0                       # POST HOC amendment A1 (after seeing English pre-1800): wrong text <= 1.0 per 1,000 words with P >= 0.9; A2 adds P(within the bar + DELTA) >= 0.8
P = json.load(open(RT + 'rules.json'))
CLAUDE_USD_PT = P['fees']['default_plan_month_usd'] * 12 / 52 / 100
AGY_MONTH = P['fees']['default_plan_month_usd']


STRUCT = re.compile(r'^(I\d+|O11|O14|O16|O18|D1)$')   # positional / markup classes a quote-only re-read cannot see


def recheck_cal():
    """Steer 1 (A): 40 misleads + 40 wrong_text defects re-read by a fresh Opus call on the quote and the leaf."""
    if not RECHECK or not os.path.exists(RECHECK):
        return None
    R = [json.loads(l) for l in open(RECHECK) if l.strip()]
    out = {}
    for sev in ('misleads', 'wrong_text'):
        rs = [r for r in R if r['severity'] == sev and r.get('verdict')]
        c = collections.Counter(r['verdict']['verdict'] for r in rs)
        sub = sum(c[v] for v in ('misleads', 'wrong_text'))
        content = [r for r in rs if not STRUCT.match(r['cls']) and re.sub(r'<[^>]*>', '', r['quote']).strip()]
        cc = collections.Counter(r['verdict']['verdict'] for r in content)
        csub = sum(cc[v] for v in ('misleads', 'wrong_text'))
        out[sev] = dict(n=len(rs), rechecked_as=dict(c), confirmed_substantive=f'{sub}/{len(rs)}', confirmed_rate=round(sub / len(rs), 3), confirmed_ci95=wilson(sub, len(rs)),
                        same_severity=f"{c[sev]}/{len(rs)}", not_an_error=f"{c['same'] + c['cosmetic']}/{len(rs)}", located=sum(bool(r['verdict'].get('located')) for r in rs),
                        content_only=dict(n=len(content), rechecked_as=dict(cc), confirmed_rate=round(csub / len(content), 3) if content else None, confirmed_ci95=wilson(csub, len(content))),
                        downgraded_examples=[dict(cls=r['cls'], cell=r['cell'], route=r['route'], quote=r['quote'][:100], recheck=r['verdict']['verdict'], why=r['verdict'].get('why', '')[:160]) for r in rs if r['verdict']['verdict'] in ('same', 'cosmetic')])
    return out


def load_rows():
    rows = [json.loads(l) for l in gzip.open(ROWS, 'rt')]
    for r in rows:
        r['_lanerun'] = r['source'] == 'lane-judge-sampler'
    return rows


def is_item(r):
    if r['kind'] not in ('item', 'draft'):
        return False
    if r['run'].startswith('lane-accept') and r['route'] == 'lite':
        return False   # drafts judged only where the correction was rejected: a selected sample
    return True


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); s = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - s) / d, 3), round((c + s) / d, 3)]


# ---- positive control -------------------------------------------------------------------------------------------
fold = lambda t: re.sub(r'\s+', '', str(t or '')).replace('ſ', 's').lower()


def overlap(a, b, n=12):
    a, b = fold(a), fold(b)
    if not a or not b:
        return False
    if a in b or b in a:
        return min(len(a), len(b)) >= min(n, len(b), len(a))
    m = min(n, len(b))
    return any(b[i:i + m] in a for i in range(0, max(1, len(b) - m + 1)))


def planted_hit(r):
    """(hit, severity of the hitting defect) under RULE.md's positive-control definition."""
    pl = r.get('plant') or {}
    ds = r.get('defects') or []
    if 'planted' in pl:   # Tibetan: judge.mjs caught()
        T = '་'
        pr = [fold(f"{pl['prev'][-1]}{T}{pl['planted']}"), fold(f"{pl['planted']}{T}{pl['next'][0]}"), fold(f"{pl['planted']}{T}")]
        for d in ds:
            q = fold(d['q'])
            if any(p in q for p in pr[:2]) or q == fold(pl['planted']) or q == pr[2]:
                return True, d['s']
        return False, None
    kind = pl.get('kind')
    for d in ds:
        q = d['q']
        if kind in ('B', 'C') and pl.get('after') and fold(pl['after']) in fold(q):
            return True, d['s']
        if kind == 'E' and overlap(q, pl.get('after', '')):
            return True, d['s']
        if kind == 'D':
            ctx = pl.get('context', '')
            if overlap(q, pl.get('before', '')) or (ctx and overlap(q, ctx, 16)):
                return True, d['s']
    return False, None


def control(rows):
    out = collections.defaultdict(lambda: dict(n=0, hit=0, rejected=0, sev=collections.Counter()))
    detail = []
    for r in rows:
        if r['kind'] != 'planted' or not r.get('plant'):
            continue
        kind = r['plant'].get('kind')
        lang = r.get('lang') or ('Tibetan' if 'planted' in r['plant'] else '?')
        if r['cell'].startswith('planted-'):
            lang = r['cell'][8:]
        g = out[(lang, kind)]
        hit, sev = planted_hit(r)
        g['n'] += 1; g['hit'] += hit; g['rejected'] += (not r['accept'])
        if hit:
            g['sev'][sev] += 1
        detail.append(dict(source=r['source'], run=r['run'], lang=lang, kind=kind, hit=hit, severity=sev, accept=r['accept'], fidelity=r['fidelity']))
    res = {}
    for (lang, kind), g in sorted(out.items(), key=lambda x: (str(x[0][0]), str(x[0][1]))):
        res[f'{lang}/{kind}'] = dict(n=g['n'], quoted=g['hit'], quoted_rate=round(g['hit'] / g['n'], 3), quoted_ci95=wilson(g['hit'], g['n']),
                                     rejected=g['rejected'], hit_severity=dict(g['sev']))
    by_lang = collections.defaultdict(lambda: [0, 0, 0, collections.Counter()])
    for d in detail:
        b = by_lang[d['lang']]; b[0] += 1; b[1] += d['hit']; b[2] += (not d['accept'])
        if d['hit']:
            b[3][d['severity']] += 1
    lang = {l: dict(n=b[0], quoted=b[1], quoted_rate=round(b[1] / b[0], 3), quoted_ci95=wilson(b[1], b[0]), rejected=b[2], hit_severity=dict(b[3]),
                    passes=b[1] / b[0] >= 0.8) for l, b in by_lang.items()}
    # unchanged texts the judge accepted before (judge-planted A): the per-word false-positive floor
    a = [r for r in rows if r['kind'] == 'control_unchanged']
    fp = dict(pages=len(a), words=sum(r.get('words') or 0 for r in a), misleads=sum(r['n_misleads'] for r in a), wrong_text=sum(r['n_wrong_text'] for r in a), reaccepted=sum(r['accept'] for r in a))
    return dict(by_lang_kind=res, by_lang=lang, unchanged_accepted_texts=fp), detail


# ---- rates ------------------------------------------------------------------------------------------------------
def boot_ratio(rs, sev, seed):
    books = collections.defaultdict(lambda: [0, 0])
    for r in rs:
        books[r['book_id'] or r['page_id']][0] += r[f'n_{sev}']; books[r['book_id'] or r['page_id']][1] += r['words']
    B = list(books.values())
    if len(B) < 3 or not sum(b[1] for b in B):
        return None
    rng = random.Random(seed); xs = []
    for _ in range(BOOT):
        s = [B[rng.randrange(len(B))] for _ in B]
        w = sum(b[1] for b in s)
        if w:
            xs.append(1000 * sum(b[0] for b in s) / w)
    xs.sort()
    return [round(xs[int(0.025 * (len(xs) - 1))], 3), round(xs[int(0.975 * (len(xs) - 1))], 3)]


def phi_of(rs, sev):
    books = collections.defaultdict(lambda: [0, 0])
    for r in rs:
        books[r['book_id'] or r['page_id']][0] += r[f'n_{sev}']; books[r['book_id'] or r['page_id']][1] += r['words'] / 1000
    B = list(books.values()); K = sum(b[0] for b in B); E = sum(b[1] for b in B)
    if len(B) < 5 or not K or not E:
        return None
    lam = K / E
    x2 = sum((k - e * lam) ** 2 / (e * lam) for k, e in B if e > 0)
    return max(1.0, x2 / (len(B) - 1))


def summary(rs, seed):
    rw = [r for r in rs if r.get('words')]
    W = sum(r['words'] for r in rw)
    s = dict(pages=len(rs), pages_with_words=len(rw), books=len({r['book_id'] or r['page_id'] for r in rs}), words=W,
             words_own_text=sum(r['words'] for r in rw if r.get('words_src') == 'candidate'),
             median_words_per_page=statistics.median([r['words'] for r in rw]) if rw else None,
             accept=f"{sum(r['accept'] for r in rs)}/{len(rs)}", wrong_text_pages=f"{sum(1 for r in rs if r['n_wrong_text'])}/{len(rs)}",
             fidelity_mean=round(statistics.mean([r['fidelity'] for r in rs]), 2) if rs else None, prompts=dict(collections.Counter(r['prompt'] for r in rs)))
    for i, sev in enumerate(SEV):
        k = sum(r[f'n_{sev}'] for r in rw)
        s[sev] = dict(count=k, per_1k_words=round(1000 * k / W, 3) if W else None, ci95_by_book=boot_ratio(rw, sev, seed + i), phi=phi_of(rw, sev))
    cl = collections.Counter()
    for r in rs:
        for c, n in r['classes'].items():
            if not c.endswith(':cosmetic'):
                cl[c] += n
    s['class_mix'] = dict(cl.most_common(6))
    return s


# ---- gamma-Poisson ----------------------------------------------------------------------------------------------
def nb_loglik(a, b, data):
    # k ~ Poisson(lam E), lam ~ Gamma(a, b): marginal negative binomial; k, E may be fractional (phi-scaled)
    return sum(math.lgamma(a + k) - math.lgamma(a) - math.lgamma(k + 1) + a * math.log(b / (b + E)) + k * math.log(E / (b + E)) for k, E in data)


def fit_prior(data):
    data = [(k, E) for k, E in data if E > 0]
    if len(data) < 3:
        return None
    best = None
    for la in [x / 10 for x in range(-30, 61)]:
        for lb in [x / 10 for x in range(-40, 61)]:
            a, b = math.exp(la), math.exp(lb)
            ll = nb_loglik(a, b, data)
            if best is None or ll > best[0]:
                best = (ll, a, b)
    ll, a, b = best
    a0 = min(1.0, A0_WORDS / b)
    return dict(alpha=round(a, 4), beta=round(b, 4), mean_per_1k=round(a / b, 4), groups=len(data), a0=round(a0, 4), prior_alpha=round(a * a0, 4), prior_beta=round(b * a0, 4))


def posterior(k, E, phi, pr):
    a, b = pr['prior_alpha'] + k / phi, pr['prior_beta'] + E / phi
    return a, b


def gq(a, b, p, rng, n=4000):
    xs = sorted(rng.gammavariate(a, 1 / b) for _ in range(n))
    return xs[int(p * (n - 1))]


# ---- router mapping ---------------------------------------------------------------------------------------------
EVRUN = {'cheap-routes-7701': 'cheap-routes-7701-2026-10-29', 'first-read-7701': 'first-read-7701-2026-10-29', 'german-cheaper-7701': 'german-cheaper-7701-2026-10-30',
         'en-pre1800-gpu-6871': 'en-pre1800-gpu-6871-2026-10-30', 'fresh-7517': 'fresh-7517-2026-10-27', 'lane-accept-7263': 'lane-accept-7263-2026-10-28',
         'router-next-7263': 'router-next-2026-10-28', 'lane-judge-sampler': 'LANE'}


def ev_run(score):
    m = re.search(r'route-judge-6740/results/(.+)/score\.json$', score)
    if m:
        return m.group(1)
    b = os.path.basename(score).replace('.score.json', '')
    return EVRUN.get(b)


def faces():
    f = 'scripts/eval/route-judge-6740/results/german-cheaper-7701-2026-10-30/script-faces.json'
    if not os.path.exists(f):
        return {}
    x = json.load(open(f))
    return {k: v for k, v in x.items() if not k.startswith('_')} if isinstance(x, dict) else {}


def router_groups(rows):
    items = [r for r in rows if is_item(r)]
    idx = collections.defaultdict(list)
    for r in items:
        idx[('LANE' if r['_lanerun'] else r['run'], r['cell'], r['route'])].append(r)
    FACE = faces()
    G, unrated_src = {}, collections.defaultdict(list)
    for cell in P['cells']:
        for rt in cell['routes']:
            srcs = ([dict(score='scripts/eval/route-judge-6740/results/pilot-2026-10-26/score.json', cell=cell['pilot'], route=rt['pilot'])] if rt.get('pilot') else []) + rt.get('evidence', [])
            got, seen = [], set()
            for e in srcs:
                run = ev_run(e['score'])
                cands = []
                if run:
                    base_route = e['route'][:-8] if e['route'].endswith('-written') else e['route']
                    for rr in (e['route'], base_route):
                        cands = idx.get((run, e['cell'], rr), [])
                        if cands:
                            break
                    if not cands:
                        m = re.match(r'(.+)-(fraktur|antiqua)$', e['cell'])
                        if m:
                            for rr in (e['route'], base_route):
                                cands = [r for r in idx.get((run, m.group(1), rr), []) if FACE.get(r['page_id']) == m.group(2)]
                                if cands:
                                    break
                if not cands:
                    unrated_src[(cell['id'], rt['id'])].append(f"{os.path.basename(os.path.dirname(e['score'])) if e['score'].endswith('/score.json') else os.path.basename(e['score'])}:{e['cell']}/{e['route']}")
                for r in cands:
                    key = (r['page_id'], r['verdict_id'])
                    if key not in seen:
                        seen.add(key); got.append(r)
            for r in idx.get(('LANE', cell['id'], rt['id']), []):
                key = (r['page_id'], r['verdict_id'])
                if key not in seen:
                    seen.add(key); got.append(r)
            G[(cell['id'], rt['id'])] = got
    return G, unrated_src


def task_of(rs):
    return collections.Counter(r['task'] for r in rs).most_common(1)[0][0] if rs else 'ocr'


def usd_raw(route):
    ch, u = route.get('channel'), route.get('units') or 0
    if ch == 'claude':
        return u * CLAUDE_USD_PT
    if ch == 'agy':
        return u * P['stages'].get(route['stage'], {}).get('agy_share', 4.45e-06) * AGY_MONTH
    return route.get('api') or 0.0 if route.get('paid') else 0.0


def is_opus(rid):
    return 'opus' in rid and 'agy-opus' not in rid


def main():
    global CAL
    CAL = recheck_cal()
    rows = load_rows()
    os.makedirs(OUT, exist_ok=True)
    ctl, ctl_detail = control(rows)
    # study cells as they ran (every run x cell x route)
    study = {}
    by = collections.defaultdict(list)
    for r in rows:
        if is_item(r):
            by[(r['run'] if not r['_lanerun'] else 'lane-judge-sampler', r['cell'], r['route'])].append(r)
    for i, (k, rs) in enumerate(sorted(by.items())):
        study['|'.join(k)] = summary(rs, SEED + 10 * i)
    # router cells
    G, unrated = router_groups(rows)
    rated = {k: [r for r in v if r.get('words')] for k, v in G.items()}
    # phi per group, pooled prior per task x severity
    PH, PR = {}, {}
    for sev in SEV:
        for task in ('ocr', 'translation'):
            phs = []
            for k, rs in rated.items():
                if len(rs) >= MIN_PAGES and task_of(rs) == task:
                    ph = phi_of(rs, sev)
                    if ph:
                        phs.append(ph); PH[(k, sev)] = ph
            med = statistics.median(phs) if phs else 1.0
            data = []
            for k, rs in rated.items():
                if len(rs) >= MIN_PAGES and task_of(rs) == task:
                    ph = PH.setdefault((k, sev), med)
                    data.append((sum(r[f'n_{sev}'] for r in rs) / ph, sum(r['words'] for r in rs) / 1000 / ph))
            PR[(task, sev)] = dict(fit_prior(data) or dict(prior_alpha=1.0, prior_beta=1.0, a0=None, note='flat: < 3 groups'), phi_median=round(med, 3))
    rng = random.Random(SEED)
    post = {}
    for k, rs in rated.items():
        if len(rs) < MIN_PAGES:
            continue
        task = task_of(rs)
        d = dict(task=task, **summary(G[k], SEED + sh(k) % 1000))
        E = sum(r['words'] for r in rs) / 1000
        for sev in SEV:
            ks = sum(r[f'n_{sev}'] for r in rs)
            a, b = posterior(ks, E, PH[(k, sev)], PR[(task, sev)])
            d[sev]['posterior'] = dict(mean=round(a / b, 4), q05=round(gq(a, b, .05, rng), 4), q95=round(gq(a, b, .95, rng), 4), a=round(a, 3), b=round(b, 3), phi=round(PH[(k, sev)], 3))
        post[k] = d
    # router-table fields
    fields = {}
    for (c, r), d in post.items():
        fields.setdefault(c, {})[r] = dict(pages=d['pages'], books=d['books'], words=d['words'], words_own_text_share=round(d['words_own_text'] / d['words'], 2) if d['words'] else None,
                                            fidelity_mean=d['fidelity_mean'], median_words_per_page=d['median_words_per_page'],
                                            **{f'{s}_per_1k': d[s]['per_1k_words'] for s in SEV}, **{f'{s}_per_1k_ci95_by_book': d[s]['ci95_by_book'] for s in SEV},
                                            **{f'{s}_per_1k_posterior': [d[s]['posterior']['q05'], d[s]['posterior']['mean'], d[s]['posterior']['q95']] for s in SEV},
                                            class_mix=d['class_mix'])
    # decisions
    cur = json.load(open(RT + 'current.json'))['table']
    T = json.load(open(RT + cur + '.json'))
    draws = {}
    def dr(key, sev, n=4000):
        if (key, sev) not in draws:
            p = post[key][sev]['posterior']; g = random.Random(sh((key, sev)))
            draws[(key, sev)] = [g.gammavariate(p['a'], 1 / p['b']) for _ in range(n)]
        return draws[(key, sev)]
    comp = []
    for row in T['rows']:
        base, script = row['base'], row.get('script')
        rts = {r['id']: r for r in row['routes']}
        have = {rid: post.get((base, rid)) for rid in rts if post.get((base, rid))}
        out = dict(row=row['id'], base=base, script=script, current=row['current'], kn_decision=row['decision'], kn_route=row['route'], rated=sorted(have), not_rated=sorted(set(rts) - set(have)))
        if script == 'manuscript':
            out['new'] = 'not compared: the rates are not split by script type, and every judged page here is print or unknown'
            comp.append(out); continue
        if not have:
            out['new'] = 'not rated: no route of this cell has defect verdicts'
            comp.append(out); continue
        opus = [rid for rid in have if is_opus(rid)]
        bar = min(opus or list(have), key=lambda x: have[x]['wrong_text']['posterior']['mean'])
        cands = [rid for rid in have if not is_opus(rid) or bar_scope_all(script)]
        W = statistics.median([r['words'] for rid in have for r in rated[(base, rid)]])
        bm = have[bar]['wrong_text']['posterior']['mean']
        gate, costs = {}, {}
        for rid in cands:
            m = have[rid]['wrong_text']['posterior']['mean']
            dw = dr((base, rid), 'wrong_text')
            pw = sum(x <= y + DELTA for x, y in zip(dw, dr((base, bar), 'wrong_text'))) / 4000
            pc = sum(x <= CEIL for x in dw) / 4000
            gate[rid] = dict(passes=m <= bm + DELTA, wrong_text_mean=round(m, 3), p_within=round(pw, 3), p_below_ceiling=round(pc, 3),
                             passes_A1=m <= bm + DELTA and pc >= 0.9, passes_A2=m <= bm + DELTA and pc >= 0.9 and pw >= 0.8)
            costs[rid] = dict(price=usd_raw(rts[rid]), err=(W / 1000 * have[rid]['misleads']['posterior']['mean'], W / 1000 * 3 * have[rid]['wrong_text']['posterior']['mean']))
        tot = lambda x, wm: costs[x]['price'] + wm * (costs[x]['err'][0] + costs[x]['err'][1])
        def pick(gk, wm):
            ok = [rid for rid in cands if gate[rid][gk]]
            return min(ok, key=lambda x: tot(x, wm)) if ok else None
        picks = {f'pre@{wm}': pick('passes', wm) for wm in WM}
        picks.update({'A1@0.01': pick('passes_A1', 0.01), 'A2@0.01': pick('passes_A2', 0.01)})
        # break-even w_m (preregistered gate): the smallest weight at which the pick moves off the cheapest passing route
        ok = [rid for rid in cands if gate[rid]['passes']]
        be = None
        if len(ok) > 1:
            p0 = min(ok, key=lambda x: (costs[x]['price'], sum(costs[x]['err'])))
            ws = [((costs[r2]['price'] - costs[p0]['price']) / (sum(costs[p0]['err']) - sum(costs[r2]['err'])), r2) for r2 in ok
                  if r2 != p0 and sum(costs[p0]['err']) > sum(costs[r2]['err'])]
            be = min(ws) if ws else None
        # Opus as a candidate (it is the bar in print, never picked): the w_m above which the rated Opus route would cost less
        ob = None
        for o in opus:
            pk = picks['pre@0.01']
            if pk and o != pk:
                eo = W / 1000 * (have[o]['misleads']['posterior']['mean'] + 3 * have[o]['wrong_text']['posterior']['mean'])
                po = usd_raw(rts[o]); de = sum(costs[pk]['err']) - eo
                ob = dict(opus=o, vs=pk, break_even_wm=round((po - costs[pk]['price']) / de, 5) if de > 0 else None, errors_per_page_saved=round(de, 3))
        out['opus_break_even'] = ob
        # AMENDMENT S1 (Derek's steer 1, read after the first results; applied as written): the bar is the LIVE route
        # (what the table runs now), else the stored draft readers see, else (no text) the A1 ceiling. Counts are
        # deflated by the re-check's confirmed share; misleads are a cost, never a gate; wrong text stays a gate.
        live = row['route'] if row['decision'].startswith('switch') else row['current']
        drafts = [rid for rid in have if rts[rid].get('stage') == 'none' and not re.match(r'(scans|gpu|lighton|pero|kraken)', rid)]   # stored text, not a fresh GPU read
        sbar = live if live in have else (drafts[0] if drafts else None)
        if live not in have and live != 'scans-only' and not (rts.get(live, {}).get('stage') == 'none'):   # what it would replace is unmeasured
            out['S1'] = dict(bar=None, bar_is='not comparable: the live route has no defect verdicts in this cell (what a switch would replace is unmeasured)', passes=[], runs={str(wm): live for wm in WM}, differs={str(wm): False for wm in WM})
            out['kn_runs'], out['new_runs'], out['new_pick'] = row['route'] if row['decision'].startswith('switch') else row['current'], {}, {}
            comp.append(out); continue
        cm, cw = (CAL['misleads']['confirmed_rate'], CAL['wrong_text']['confirmed_rate']) if CAL else (1.0, 1.0)
        def s1ok(rid):
            m = cw * have[rid]['wrong_text']['posterior']['mean']
            if sbar:
                return m <= cw * have[sbar]['wrong_text']['posterior']['mean'] + DELTA
            return sum(x <= CEIL for x in dr((base, rid), 'wrong_text')) / 4000 >= 0.9
        s1c = [rid for rid in have if (not is_opus(rid) or bar_scope_all(script)) or rid == sbar]
        for rid in s1c:
            if rid not in costs:
                costs[rid] = dict(price=usd_raw(rts[rid]), err=(W / 1000 * have[rid]['misleads']['posterior']['mean'], W / 1000 * 3 * have[rid]['wrong_text']['posterior']['mean']))
        s1cost = lambda x, wm: costs[x]['price'] + wm * (cm * costs[x]['err'][0] + cw * costs[x]['err'][1])
        s1 = {}
        for wm in WM:
            ok = [rid for rid in s1c if s1ok(rid)]
            s1[wm] = min(ok, key=lambda x: s1cost(x, wm)) if ok else None
        out['S1'] = dict(bar=sbar or 'none (no text): wrong text <= 1.0 per 1,000 words with P >= 0.9', bar_is=('live route' if sbar == live else 'stored draft' if sbar else 'ceiling'),
                         passes=sorted(rid for rid in s1c if s1ok(rid)), runs={str(wm): (v or live) for wm, v in s1.items()}, differs={str(wm): (v or live) != live for wm, v in s1.items()})
        # what RUNS: the k/n table runs its route on switch, the current route on keep / HOLD / UNTESTED; the new rule
        # runs its pick, or the current route when no candidate passes
        kn_runs = row['route'] if row['decision'].startswith('switch') else row['current']
        runs = {k: (v or row['current']) for k, v in picks.items()}
        out.update(bar=bar, bar_wrong_text_per_1k=round(bm, 3), words_per_page=W, gate=gate, current_rated=row['current'] in have,
                   cost=({rid: dict(price=f"{rts[rid].get('units') or 0:g} {dict(claude='Claude points', agy='agy calls').get(rts[rid].get('channel'), '(draft made: 0)')} a page", misleads_per_page=round(c['err'][0], 3), wrong_text_x3_per_page=round(c['err'][1], 3)) for rid, c in costs.items()}),
                   kn_runs=kn_runs, new_runs=runs, new_pick=picks, break_even_wm=(round(be[0], 5), be[1]) if be else None,
                   differs={k: v != kn_runs for k, v in runs.items()})
        comp.append(out)
    # correction passes: defects introduced
    intro = introduced(rows)
    score = dict(recheck=CAL, generated_by='scripts/eval/route-judge-6740/defect-rate.py', rule='RULE.md (commit 950d1cb75, before any rate)', table=cur,
                 coverage=coverage(rows), positive_control=ctl, priors={f'{t}/{s}': v for (t, s), v in PR.items()},
                 router_cells={f'{c}|{r}': v for (c, r), v in post.items()}, unrated_evidence={f'{c}|{r}': v for (c, r), v in unrated.items()},
                 comparison=comp, introduced_by_correction=intro, study_cells=study)
    json.dump(score, open(os.path.join(OUT, 'score.json'), 'w'), indent=1, ensure_ascii=False)
    json.dump(dict(_about='Defect rates per 1,000 words of the candidate text, per router base cell x route, from the stored Opus verdicts (#6740, defect-rate.py; rule RULE.md in scripts/eval/route-judge-6740/results/defect-rate-2026-10-30). build.py shows them beside k/n; they do not enter the decision.',
                   generated_from=os.path.join(OUT, 'score.json'), cells=fields), open(RT + 'defect-rates.json', 'w'), indent=1, ensure_ascii=False)
    json.dump(ctl_detail, open(os.path.join(OUT, 'control-detail.json'), 'w'), indent=0)
    print(json.dumps(ctl['by_lang'], indent=0))
    print('S1', {wm: sum(1 for c in comp if c.get('S1') and c['S1']['differs'][str(wm)]) for wm in WM})
    print({k: sum(1 for c in comp if isinstance(c.get('differs'), dict) and c['differs'][k]) for k in ('pre@0.01', 'A1@0.01', 'A2@0.01')}, 'rows differ of', sum(1 for c in comp if isinstance(c.get('differs'), dict)), 'compared;', len(comp), 'rows')


def bar_scope_all(script):
    return script == 'manuscript'


def coverage(rows):
    c = collections.defaultdict(lambda: dict(verdicts=0, item_rows=0, pages=set(), books=set(), words_src=collections.Counter(), prompts=collections.Counter(), first=None, last=None, cells=set(), routes=set()))
    for r in rows:
        g = c[r['source'] if r['source'] != 'route-judge' else r['run']]
        g['verdicts'] += 1
        g['prompts'][r['prompt']] += 1
        if r.get('at'):
            g['first'] = min(g['first'] or r['at'], r['at']); g['last'] = max(g['last'] or r['at'], r['at'])
        if is_item(r):
            g['item_rows'] += 1; g['pages'].add(r['page_id']); g['books'].add(r['book_id']); g['words_src'][r.get('words_src')] += 1; g['cells'].add(r['cell']); g['routes'].add(f"{r['cell']}/{r['route']}")
    return {k: dict(keyed_rows=v['verdicts'], item_rows=v['item_rows'], pages=len(v['pages']), books=len(v['books']), cells=len(v['cells']), cell_routes=len(v['routes']),
                    words_from=dict(v['words_src']), prompts=dict(v['prompts']), dates=[(v['first'] or '')[:10], (v['last'] or '')[:10]]) for k, v in sorted(c.items())}


def introduced(rows):
    """RULE.md: draft vs draft>corrector on the same page in the same run, both texts held."""
    by = collections.defaultdict(dict)
    for r in rows:
        if is_item(r) and r.get('words_src') == 'candidate' and r.get('_text') is not None:
            by[(r['run'], r['cell'], r['page_id'])][r['route']] = r
    agg = collections.defaultdict(lambda: dict(pairs=0, books=collections.defaultdict(lambda: [0, 0, 0]), words=0, introduced=collections.Counter(), removed=collections.Counter(), cls=collections.Counter(), examples=[]))
    for (run, cell, pid), m in by.items():
        for rid, cr in m.items():
            if '>' not in rid:
                continue
            draft = rid.split('>')[0]
            dr_ = m.get(draft)
            if not dr_:
                continue
            ft, fd = fold(cr['_text']), fold(dr_['_text'])
            g = agg[(cell, rid)]
            g['pairs'] += 1; g['words'] += cr['words'] or 0
            b = g['books'][cr['book_id'] or pid]; b[1] += cr['words'] or 0
            for d in cr['defects']:
                if d['s'] in ('misleads', 'wrong_text'):
                    q = fold(d['q'])
                    if len(q) >= 2 and q in ft and q not in fd:
                        g['introduced'][d['s']] += 1; g['cls'][d['c']] += 1; b[0] += 1
                        if len(g['examples']) < 4 and d['c'] in ('O6', 'O7', 'T8'):
                            g['examples'].append(dict(run=run, page_id=pid, severity=d['s'], cls=d['c'], quote=d['q'][:120], what=d['w'][:200]))
            for d in dr_['defects']:
                if d['s'] in ('misleads', 'wrong_text'):
                    q = fold(d['q'])
                    if len(q) >= 2 and q in fd and q not in ft:
                        g['removed'][d['s']] += 1; b[2] += 1
    out = {}
    for (cell, rid), g in sorted(agg.items()):
        B = list(g['books'].values())
        rng = random.Random(SEED); xs = []
        for _ in range(BOOT):
            s = [B[rng.randrange(len(B))] for _ in B]; w = sum(x[1] for x in s)
            if w:
                xs.append(1000 * sum(x[0] for x in s) / w)
        xs.sort()
        n_in = sum(g['introduced'].values())
        out[f'{cell}|{rid}'] = dict(pairs=g['pairs'], books=len(B), words=g['words'], introduced=dict(g['introduced']), introduced_per_1k=round(1000 * n_in / g['words'], 3) if g['words'] else None,
                                    introduced_ci95_by_book=[round(xs[int(.025 * (len(xs) - 1))], 3), round(xs[int(.975 * (len(xs) - 1))], 3)] if xs and len(B) >= 3 else None,
                                    removed=dict(g['removed']), removed_per_1k=round(1000 * sum(g['removed'].values()) / g['words'], 3) if g['words'] else None,
                                    introduced_classes=dict(g['cls'].most_common(6)), word_swap_examples=g['examples'])
    return out


# ---- later evidence, pooled counts only ---------------------------------------------------------------------------
# Studies judged after the 2026-10-30 inventory whose verdicts live in another box's scratch (gex45), but whose score
# files keep each arm's pooled defects and words (#7824 words()). Each entry mirrors a rules.json evidence entry for the
# same route, so a route's defect rate pools the same sources as its k/n. One page a book in every one of them.
ADD = [
    # (router cell, route, score file, path to the arm's {misleads, wrong_text: {defects, words}}, pages-key, source)
    ('german-lite', 'lite>agy-flash-low', 'scripts/eval/correction-pass-7818/results/score.json', ('amendment_2', 'P', 'de', 'served'), ('amendment_2', 'P', 'de', 'pages'), '#7818 P de served'),
    ('french-lite', 'lite>agy-flash-low', 'scripts/eval/correction-pass-7818/results/score.json', ('amendment_2', 'P', 'fr', 'served'), ('amendment_2', 'P', 'fr', 'pages'), '#7818 P fr served'),
    ('german-lite', 'lite', 'scripts/eval/fraktur-paired-7835/results/score.json', ('T2', 'fraktur', 'arms', 'a', 'defects_per_1000'), 't2-fraktur/a', '#7835 T2 a (stored lite)'),
    ('german-lite', 'lite>agy-flash-low', 'scripts/eval/fraktur-paired-7835/results/score.json', ('T2', 'fraktur', 'arms', 'b', 'defects_per_1000'), 't2-fraktur/b', '#7835 T2 b (the #7558 correction)'),
    ('german-blank-fraktur', 'agy-flash-low@4-written', 'scripts/eval/fraktur-paired-7835/results/score.json', ('T1', 'fraktur', 'arms', 'a', 'defects_per_1000'), 't1-fraktur/a', '#7835 T1 a (read@4)'),
    ('german-blank-antiqua', 'agy-flash-low@4-written', 'scripts/eval/fraktur-paired-7835/results/score.json', ('T1', 'antiqua', 'arms', 'a', 'defects_per_1000'), 't1-antiqua/a', '#7835 T1 a (read@4)'),
]
# Not added: #7845 (open Fraktur models): 6 judged pages an arm (< MIN_PAGES), and no arm is a route in rules.json.


def add_pooled(out_dir):
    """Re-read score.json's router cells (the 2026-10-30 inventory) and pool ADD into them: k/phi and E/phi added to the
    group's gamma posterior, phi = the group's own (the task's median phi for a new group: one page a book gives no
    within-source dispersion to fit). The priors are score.json's. Rewrites defect-rates.json; idempotent."""
    S = json.load(open(os.path.join(out_dir, 'score.json')))
    cells = S['router_cells']
    rng = random.Random(SEED + 7835)
    fields = {}
    for key, d in cells.items():
        c, r = key.split('|', 1)
        fields.setdefault(c, {})[r] = d
    added = collections.defaultdict(list)
    for c, r, f, p, pk, src in ADD:
        x = json.load(open(f))
        for k in p: x = x[k]
        if isinstance(pk, tuple):
            n = json.load(open(f))
            for k in pk: n = n[k]
            fid = None
        else:
            sc = json.load(open(os.path.join(os.path.dirname(f), 'defect-rates.json')))['study_cells'][pk]
            n, fid = sc['n'], sc['fidelity_mean']
        added[(c, r)].append(dict(source=src, file=f, pages=n, words=x['wrong_text']['words'], misleads=x['misleads']['defects'], wrong_text=x['wrong_text']['defects'], fidelity_mean=fid))
    out = {}
    for c, rs in fields.items():
        for r, d in rs.items():
            out.setdefault(c, {})[r] = d
    for (c, r), xs in added.items():
        d0 = out.get(c, {}).get(r)
        task = d0['task'] if d0 else 'ocr'
        d = json.loads(json.dumps(d0)) if d0 else dict(task=task, pages=0, books=0, words=0, words_own_text=0, median_words_per_page=None, fidelity_mean=None, class_mix={},
                                                        **{s: dict(count=0, per_1k_words=None, ci95_by_book=None, phi=None) for s in SEV})
        pages0 = d['pages']
        for x in xs:
            d['pages'] += x['pages']; d['books'] += x['pages']; d['words'] += x['words']; d['words_own_text'] += x['words']
        fids = [(d0['fidelity_mean'], pages0)] if d0 and d0.get('fidelity_mean') is not None else []
        fids += [(x['fidelity_mean'], x['pages']) for x in xs if x['fidelity_mean'] is not None]
        if fids: d['fidelity_mean'] = round(sum(f * w for f, w in fids) / sum(w for _, w in fids), 2)
        if d['median_words_per_page'] is None: d['median_words_per_page'] = round(d['words'] / d['pages'])
        for sev in ('misleads', 'wrong_text'):
            pr = S['priors'][f'{task}/{sev}']
            phi = (d0[sev]['posterior']['phi'] if d0 else pr['phi_median'])
            k_new, E_new = sum(x[sev] for x in xs), sum(x['words'] for x in xs) / 1000
            a, b = (d0[sev]['posterior']['a'], d0[sev]['posterior']['b']) if d0 else (pr['prior_alpha'], pr['prior_beta'])
            a, b = a + k_new / phi, b + E_new / phi
            d[sev]['count'] += k_new
            d[sev]['per_1k_words'] = round(1000 * d[sev]['count'] / d['words'], 3)
            d[sev]['ci95_by_book'] = None   # the added sources keep no per-book rows here: no bootstrap
            d[sev]['posterior'] = dict(mean=round(a / b, 4), q05=round(gq(a, b, .05, rng), 4), q95=round(gq(a, b, .95, rng), 4), a=round(a, 3), b=round(b, 3), phi=round(phi, 3))
        d['added'] = xs
        out.setdefault(c, {})[r] = d
    fl = {}
    for c, rs in out.items():
        for r, d in rs.items():
            fl.setdefault(c, {})[r] = dict(pages=d['pages'], books=d['books'], words=d['words'], words_own_text_share=round(d['words_own_text'] / d['words'], 2) if d['words'] else None,
                                           fidelity_mean=d['fidelity_mean'], median_words_per_page=d['median_words_per_page'],
                                           **{f'{s}_per_1k': d[s]['per_1k_words'] for s in SEV if s in d}, **{f'{s}_per_1k_ci95_by_book': d[s]['ci95_by_book'] for s in SEV if s in d},
                                           **{f'{s}_per_1k_posterior': [d[s]['posterior']['q05'], d[s]['posterior']['mean'], d[s]['posterior']['q95']] for s in SEV if 'posterior' in d.get(s, {})},
                                           **{f'{s}_per_1k_gamma': [d[s]['posterior']['a'], d[s]['posterior']['b']] for s in SEV if 'posterior' in d.get(s, {})},
                                           class_mix=d.get('class_mix', {}), **({'added': [dict(source=x['source'], pages=x['pages'], words=x['words']) for x in d['added']]} if d.get('added') else {}))
    json.dump(dict(_about='Defect rates per 1,000 words of the candidate text, per router base cell x route, from the stored Opus verdicts (#6740, defect-rate.py; rule RULE.md in scripts/eval/route-judge-6740/results/defect-rate-2026-10-30). '
                          'build.py decides on them (rules.json decision_rule, #6740 job defect-router-6740); `added` names the later sources pooled in by --add-pooled (#7818, #7835) from their score files\' pooled counts.',
                   generated_from=os.path.join(out_dir, 'score.json'), recheck=dict(misleads=S['recheck']['misleads']['confirmed_rate'], wrong_text=S['recheck']['wrong_text']['confirmed_rate']) if S.get('recheck') else None,
                   cells=fl), open(RT + 'defect-rates.json', 'w'), indent=1, ensure_ascii=False)
    for (c, r), xs in added.items():
        p = out[c][r]
        print(c, r, '+', ', '.join(x['source'] for x in xs), f"-> {p['books']} books, {p['words']:,} words; misleads {p['misleads']['posterior']['mean']}, wrong text {p['wrong_text']['posterior']['mean']}")


if __name__ == '__main__':
    if '--add-pooled' in sys.argv:
        add_pooled(arg('--add-pooled'))
    else:
        main()
