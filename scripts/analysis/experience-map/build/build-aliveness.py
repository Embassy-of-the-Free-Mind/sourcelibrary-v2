#!/usr/bin/env python3
"""
Assemble the aliveness atlas (#6652) data from the two-pass instrument:
  screen  classify/classify-aliveness.mjs  (flash-lite, per-layer verbatim evidence gate)
  judge   classify/judge-aliveness.mjs     (Gemini CLI, strict rubric; only screen positives are judged)
A layer counts only when the screen marked it, its evidence sentence is verbatim on the page, AND the judge confirmed it.

Writes aliveness-data.json (points for the map) and aliveness-numbers.json (every figure the page quotes), both
next to the inputs. Rates on the RANDOM baseline are the corpus base rates; rates on the retrieved set are
probe-dependent and are only compared within the instrument.
PRIOR ART: build/project-v2.py + build-deploy.py build the experience atlas from classify-v3 output; they assume
its fields (features/trigger/aftermath) and a UMAP layout, which the July paper showed is organised by language.
The fourth layer, the inhabited world (animism), is optional and read from its own files when present:
classified-animism.jsonl, judged-animism.jsonl, baseline-animism.jsonl, baseline-animism-judged.jsonl,
lexical-counts-animism.json and jev-animism.jsonl (the Jev cross-family rater, classify/jev-animism.py).
  python3 build/build-aliveness.py <dir>   (dir holds classified-aliveness.jsonl, judged-aliveness.jsonl,
                                            baseline-aliveness.jsonl, baseline-judged.jsonl)
"""
import json, sys, math, collections as C, os

D = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/sourcelibrary/scripts/output/experience-map/aliveness')
LAYERS = ['felt', 'world', 'made']

# pages whose text was found by eye not to be on the leaf (probes/excluded-pages.json, each with its issue): never shown
# phrases whose every hit is on excluded pages: "the sky is our father" occurs only in the invented plate-backs of #6783
EXCLUDED_PHRASES = {'the sky is our father'}
EXCLUDED = set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'probes', 'excluded-pages.json')))['pages'])

def load(p):
    return [r for r in (json.loads(l) for l in open(os.path.join(D, p)) if l.strip()) if r.get('page_id') not in EXCLUDED]

def confirmed(screen, judged):
    J = {j['page_id']: j for j in judged}
    out = []
    for r in screen:
        j = J.get(r['page_id'])
        row = dict(r); row['judged'] = j is not None
        for L in LAYERS:
            ok = bool(r.get(L)) and bool(r.get(L + '_quote')) and j is not None and bool(j.get(L))
            row[L + '_final'] = j[L] if ok else None
            row[L + '_reason'] = j.get(L + '_reason') if j else None
        out.append(row)
    return out

def wilson(k, n, z=1.96):
    if n == 0: return [0, 0, 0]
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(100 * p, 1), round(100 * max(0, c - h), 1), round(100 * min(1, c + h), 1)]

base = confirmed(load('baseline-aliveness.jsonl'), load('baseline-judged.jsonl'))
def lane(screen_f, judged_f, name):
    if not os.path.exists(os.path.join(D, screen_f)): return []
    rows = confirmed(load(screen_f), load(judged_f) if os.path.exists(os.path.join(D, judged_f)) else [])
    for r in rows: r['lane'] = name
    return rows
emb = lane('classified-aliveness.jsonl', 'judged-aliveness.jsonl', 'embedding')
lex = lane('classified-lex.jsonl', 'judged-lex.jsonl', 'lexical')
seen = set(); hits = []
for r in lex + emb:  # a page found by both lanes is counted once, under the lexical lane
    if r['page_id'] in seen: continue
    seen.add(r['page_id']); hits.append(r)
probes = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'probes', 'probes-aliveness.json')))
dim_layer = {d['id']: d['layer'] for d in probes['dimensions']}
dim_label = {d['id']: d['label'] for d in probes['dimensions']}

N = {}
nb = len(base)
N['baseline_n'] = nb
N['baseline'] = {}
for L in LAYERS:
    for pole in ['alive', 'dead']:
        screened = sum(1 for r in base if r.get(L) == pole)
        conf = sum(1 for r in base if r[L + '_final'] == pole)
        N['baseline'][f'{L}_{pole}'] = {'screened': screened, 'confirmed': conf, 'rate': wilson(conf, nb)}
any_b = sum(1 for r in base if any(r[L + '_final'] for L in LAYERS)); scr_b = sum(1 for r in base if any(r.get(L) for L in LAYERS))
N['baseline_any'] = {'screened': scr_b, 'confirmed': any_b, 'rate': wilson(any_b, nb), 'screen_rate': wilson(scr_b, nb)}

nh = len(hits)
N['hits_n'] = nh; N['hits_judged'] = sum(1 for r in hits if r['judged'])
N['hits_screened_any'] = sum(1 for r in hits if any(r.get(L) for L in LAYERS))
N['hits_confirmed_any'] = sum(1 for r in hits if any(r[L + '_final'] for L in LAYERS))
N['hits_unjudged_positive'] = sum(1 for r in hits if any(r.get(L) for L in LAYERS) and not r['judged'])
N['lanes'] = {}
for name, rows in (('embedding', emb), ('lexical', lex)):
    sc = [r for r in rows if any(r.get(L) for L in LAYERS)]; jd = [r for r in sc if r['judged']]
    cf = [r for r in jd if any(r[L + '_final'] for L in LAYERS)]
    N['lanes'][name] = {'retrieved': len(rows), 'screened': len(sc), 'judged': len(jd), 'confirmed': len(cf),
                        'confirm_of_judged': wilson(len(cf), len(jd)), 'est_yield': round(100 * len(sc) / max(1, len(rows)) * len(cf) / max(1, len(jd)), 1)}
N['books'] = len({r['book_id'] for r in hits if any(r[L + '_final'] for L in LAYERS)})
N['languages'] = len({r['book_language'] for r in hits if any(r[L + '_final'] for L in LAYERS)})

# per probe dimension: did the passages it found land on its own layer?
per_dim = C.defaultdict(lambda: {'n': 0, 'own': 0, 'any': 0})
for r in hits:
    d = r.get('probe_dim'); L = dim_layer.get(d)
    if not L: continue
    s = per_dim[d]; s['n'] += 1
    if r[L + '_final']: s['own'] += 1
    if any(r[x + '_final'] for x in LAYERS): s['any'] += 1
N['per_dim'] = [{'id': d, 'label': dim_label[d], 'layer': dim_layer[d], **v, 'own_rate': wilson(v['own'], v['n'])} for d, v in sorted(per_dim.items(), key=lambda kv: (LAYERS.index(dim_layer[kv[0]]), kv[0]))]

# Alexander's sense: places, gardens, buildings-as-bodies, wholeness, spirit of place — retrieved vs confirmed on any layer
ALEX = ['living_place', 'garden', 'building_body', 'wholeness', 'genius_loci']
N['alexander'] = {'retrieved': sum(per_dim[d]['n'] for d in ALEX), 'judged': sum(1 for r in hits if r.get('probe_dim') in ALEX and r['judged']),
                  'confirmed': sum(per_dim[d]['any'] for d in ALEX)}
FELT = [d for d in dim_layer if dim_layer[d] == 'felt']
N['felt_probes'] = {'retrieved': sum(per_dim[d]['n'] for d in FELT), 'judged': sum(1 for r in hits if r.get('probe_dim') in FELT and r['judged']),
                    'confirmed_own': sum(per_dim[d]['own'] for d in FELT)}

# layer x pole counts in the confirmed set
N['confirmed'] = {f'{L}_{p}': sum(1 for r in hits if r[L + '_final'] == p) for L in LAYERS for p in ['alive', 'dead']}

# what is alive, and what gives it life (world layer, alive pole), and qualities by layer x pole
def counts(rows, key, top=14):
    c = C.Counter(r[key] for r in rows); return c.most_common(top)
wa = [r for r in hits if r['world_final'] == 'alive']
N['world_carriers'] = counts(wa, 'carrier'); N['world_sources'] = counts(wa, 'source_of_life')
ma = [r for r in hits if r['made_final'] == 'alive']
N['made_carriers'] = counts(ma, 'carrier'); N['made_sources'] = counts(ma, 'source_of_life')
q = {}
for L in LAYERS:
    for p in ['alive', 'dead']:
        rows = [r for r in hits if r[L + '_final'] == p]
        c = C.Counter(x for r in rows for x in r.get('qualities', []))
        q[f'{L}_{p}'] = {'n': len(rows), 'q': {k: round(100 * v / max(1, len(rows)), 1) for k, v in c.items()}}
N['qualities'] = q

# traditions: confirmed rows per layer
trad = C.defaultdict(lambda: C.Counter())
for r in hits:
    for L in LAYERS:
        if r[L + '_final']: trad[r.get('tradition') or 'other'][f'{L}_{r[L + "_final"]}'] += 1
tops = sorted(trad.items(), key=lambda kv: -sum(kv[1].values()))[:14]
N['traditions'] = [{'tradition': t, **dict(c), 'total': sum(c.values())} for t, c in tops]

# where the layers meet, at the BOOK level (passage-level overlap is too sparse to read)
book = C.defaultdict(set)
for r in hits:
    for L in LAYERS:
        if r[L + '_final']: book[r['book_id']].add(f'{L}_{r[L + "_final"]}')
nbk = len(book)
def cond(a, b):
    A = [s for s in book.values() if a in s]; notA = [s for s in book.values() if a not in s]
    return {'given': a, 'then': b, 'with': wilson(sum(1 for s in A if b in s), len(A)), 'n_with': len(A),
            'without': wilson(sum(1 for s in notA if b in s), len(notA)), 'n_without': len(notA)}
N['book_overlap'] = [cond('world_alive', 'felt_alive'), cond('world_alive', 'made_alive'), cond('made_alive', 'felt_alive'), cond('world_dead', 'felt_dead')]
N['books_by_layers'] = C.Counter(len({x.split('_')[0] for x in s}) for s in book.values())

# century distribution of confirmed passages per layer (alive and dead)
cent = C.defaultdict(C.Counter)
for r in hits:
    y = r.get('book_year')
    if not isinstance(y, (int, float)): continue
    c = int(y // 100 * 100)
    for L in LAYERS:
        if r[L + '_final']: cent[c][f'{L}_{r[L + "_final"]}'] += 1
N['centuries'] = [{'c': c, **dict(v)} for c, v in sorted(cent.items())]

# lexical lane, model-free: phrase occurrences per 10K translated pages by EDITION century (retrieve-aliveness-lexical.mjs)
lc_path = os.path.join(D, 'lexical-counts.json')
if os.path.exists(lc_path):
    LC = json.load(open(lc_path)); den = LC['translated_pages_by_century']
    BINS = [('before 1400', lambda c: c < 1400)] + [(f'{c}s', (lambda cc: (lambda c: c == cc))(c)) for c in (1400, 1500, 1600, 1700, 1800, 1900)]
    def binned(d):
        return [sum(n for c, n in d.items() if c != 'nd' and f(int(c))) for _, f in BINS]
    dens = binned(den)
    agg = C.defaultdict(C.Counter)
    for ph, v in LC['phrases'].items():
        for c, n in v['byCentury'].items(): agg[v['dim']][c] += n
    N['lexical'] = {
        'bins': [b for b, _ in BINS], 'denominators': dens, 'zero_hit': LC['zero_hit'],
        'dims': {d: {'layer': dim_layer[d], 'label': dim_label[d], 'rate': [round(10000 * x / y, 1) if y else None for x, y in zip(binned(agg[d]), dens)], 'total': sum(agg[d].values())} for d in agg},
        'phrases': sorted([{'ph': ph, 'dim': v['dim'], 'pages': v['pages'], 'books': v['books']} for ph, v in LC['phrases'].items()], key=lambda x: -x['pages']),
    }

# second rater (build/second-rater-sample.py): a different model family, blind to the judge, any-layer yes/no
sk, sr = os.path.join(D, 'second-rater-key.json'), os.path.join(D, 'second-rater.json')
if os.path.exists(sk) and os.path.exists(sr):
    K = json.load(open(sk)); R = json.load(open(sr)); Y = set(R['yes'])
    t = C.Counter((k['group'], any(k['judge'].values()), k['k'] in Y) for k in K)
    agree = sum(v for (g, j, m), v in t.items() if j == m); n2 = len(K)
    po = agree / n2; pj = sum(1 for k in K if any(k['judge'].values())) / n2; pm = len(Y) / n2
    pe = pj * pm + (1 - pj) * (1 - pm)
    N['second_rater'] = {'rater': R['rater'], 'n': n2, 'agree': agree, 'kappa': round((po - pe) / (1 - pe), 2),
                         'cells': [{'group': g, 'judge': j, 'rater': m, 'n': v} for (g, j, m), v in sorted(t.items())],
                         'disagree': [{'k': k['k'], 'group': k['group'], 'judge_yes': any(k['judge'].values()), 'rater_yes': k['k'] in Y} for k in K if any(k['judge'].values()) != (k['k'] in Y)]}

# points
pts = []
for r in hits:
    for L in LAYERS:
        p = r[L + '_final']
        if not p: continue
        pts.append({'l': L, 'p': p, 'y': r.get('book_year'), 't': (r.get('book_title') or '')[:110], 'a': (r.get('book_author') or '')[:60],
                    'lg': r.get('book_language') or '', 'tr': r.get('tradition') or 'other', 'c': r.get('carrier'), 's': r.get('source_of_life'),
                    'q': r[L + '_quote'], 'why': (r[L + '_reason'] or '')[:220], 'fp': r.get('first_person'),
                    # front matter has a negative page_number in the mirror and the reader cannot open it by ?page=:
                    # link the book and say so, rather than send the reader to a page that does not hold the quote
                    'u': f"https://sourcelibrary.org/book/{r['book_id']}" + (f"?page={r['page_number']}" if r['page_number'] > 0 else ''), 'fm': r['page_number'] <= 0, 'd': r.get('probe_dim'), 'ln': r['lane'], 'ph': r.get('probe') if r['lane'] == 'lexical' else None})

# Fourth layer, the inhabited world (animism): classify/classify-animism.mjs screen + judge-animism.mjs judge, over its own
# phrase draw (retrieve-aliveness-lexical.mjs --tag animism) and the same random baseline. Counted only when the screen's
# evidence sentence is verbatim on the page AND the judge confirmed. Voice is the judge's when it gave one.
def anim_confirmed(screen, judged):
    J = {j['page_id']: j for j in judged}; out = []
    for r in screen:
        j = J.get(r['page_id']); row = dict(r); row['judged'] = j is not None
        row['inh_final'] = j['inhabited'] if (r.get('inhabited') and r.get('inhabited_quote') and j and j.get('inhabited')) else None
        row['inh_reason'] = j.get('reason') if j else None
        row['voice_final'] = (j.get('voice') if j and j.get('voice') else r.get('voice'))
        out.append(row)
    return out
if os.path.exists(os.path.join(D, 'classified-animism.jsonl')):
    opt = lambda f: load(f) if os.path.exists(os.path.join(D, f)) else []
    AB = anim_confirmed(opt('baseline-animism.jsonl'), opt('baseline-animism-judged.jsonl'))
    AH = anim_confirmed(load('classified-animism.jsonl'), opt('judged-animism.jsonl'))
    A = {}
    A['baseline_n'] = len(AB)
    A['baseline'] = {p: {'screened': sum(1 for r in AB if r.get('inhabited') == p), 'confirmed': sum(1 for r in AB if r['inh_final'] == p),
                         'rate': wilson(sum(1 for r in AB if r['inh_final'] == p), len(AB))} for p in ['person', 'denied']}
    A['baseline_world_alive'] = N['baseline']['world_alive']['rate']
    sc = [r for r in AH if r.get('inhabited')]; jd = [r for r in sc if r['judged']]; cf = [r for r in AH if r['inh_final']]
    A['draw'] = {'retrieved': len(AH), 'screened': len(sc), 'judged': len(jd), 'confirmed': len(cf),
                 'confirm_of_judged': wilson(len(cf), len(jd)), 'unjudged_positive': len(sc) - len(jd)}
    A['confirmed'] = {p: sum(1 for r in cf if r['inh_final'] == p) for p in ['person', 'denied']}
    A['books'] = len({r['book_id'] for r in cf}); A['languages'] = len({r['book_language'] for r in cf})
    per = [r for r in cf if r['inh_final'] == 'person']
    A['voice'] = dict(C.Counter(r['voice_final'] or 'unknown' for r in per))
    A['dwelling'] = counts(per, 'dwelling'); A['being'] = counts(per, 'being'); A['relation'] = counts(per, 'relation')
    A['register'] = counts(cf, 'register')
    tv = C.defaultdict(C.Counter)
    for r in cf: tv[r.get('tradition') or 'other'][r['voice_final'] or 'unknown'] += 1; tv[r.get('tradition') or 'other']['denied' if r['inh_final'] == 'denied' else 'person'] += 1
    A['traditions'] = [{'tradition': t, **dict(c), 'total': c['person'] + c['denied']} for t, c in sorted(tv.items(), key=lambda kv: -(kv[1]['person'] + kv[1]['denied']))[:14]]
    pd = C.defaultdict(lambda: [0, 0, 0])
    for r in AH: s = pd[r.get('probe_dim')]; s[0] += 1; s[1] += 1 if r.get('inhabited') else 0; s[2] += 1 if r['inh_final'] else 0
    A['per_group'] = [{'id': d, 'n': v[0], 'screened': v[1], 'confirmed': v[2], 'rate': wilson(v[2], v[0])} for d, v in sorted(pd.items(), key=lambda kv: -kv[1][2] / max(1, kv[1][0]))]
    cv = C.defaultdict(C.Counter)
    for r in per:
        y = r.get('book_year')
        if isinstance(y, (int, float)): cv[int(y // 100 * 100)][r['voice_final'] or 'unknown'] += 1
    A['centuries'] = [{'c': c, **dict(v)} for c, v in sorted(cv.items())]
    dated = lambda v, f: sum(n for c, x in cv.items() if f(c) for k, n in x.items() if k == v)
    A['voice_dated'] = {v: {'from_1800': dated(v, lambda c: c >= 1800), 'all': dated(v, lambda c: True)} for v in ['insider', 'outsider', 'literary']}
    for v in A['voice_dated'].values(): v['share_from_1800'] = round(100 * v['from_1800'] / max(1, v['all']))
    tmap = tv  # all traditions, not only the top 14 in the table
    A['trad'] = {t.replace('-', '_'): {k: tmap.get(t, {}).get(k, 0) for k in ['person', 'insider', 'outsider', 'literary']} for t in ['tibetan-buddhist', 'chinese-folk', 'greco-roman', 'african', 'shinto', 'native-american', 'pacific']}
    # which books meet the other layers: of books with a confirmed inhabited passage, how many also have world_alive
    inh_books = {r['book_id'] for r in cf}
    A['books_also_world_alive'] = sum(1 for b in inh_books if 'world_alive' in book.get(b, set()))
    lc = os.path.join(D, 'lexical-counts-animism.json')
    if os.path.exists(lc):
        LCA = json.load(open(lc))
        # the FTS index folds diacritics, so "naga king" and "nāga king" are one search: list it once
        import unicodedata
        fold = lambda t: ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c))
        seen_ph = set(); A['phrases'] = []
        for ph, v in sorted(LCA['phrases'].items(), key=lambda kv: -kv[1]['pages']):
            if fold(ph) in seen_ph or ph in EXCLUDED_PHRASES: continue
            seen_ph.add(fold(ph)); A['phrases'].append({'ph': ph, 'dim': v['dim'], 'pages': v['pages'], 'books': v['books'], 'langs': list(v['byLanguage'].items())[:3]})
    # Jev (classify/jev-animism.py), a non-Gemini rater: does its score separate what the judge confirmed from what it rejected?
    jf = os.path.join(D, 'jev-animism.jsonl')
    if os.path.exists(jf):
        JV = {}
        for l in open(jf):
            if l.strip():
                x = json.loads(l)
                if x.get('jev') is not None: JV[x['page_id']] = x['jev']
        def auc(pos, neg):
            if not pos or not neg: return None
            s = sum((p > q) + 0.5 * (p == q) for p in pos for q in neg); return round(s / (len(pos) * len(neg)), 3)
        jp = [JV[r['page_id']] for r in jd if r['inh_final'] and r['page_id'] in JV]
        jn = [JV[r['page_id']] for r in jd if not r['inh_final'] and r['page_id'] in JV]
        bp = [JV[r['page_id']] for r in AB if r['inh_final'] and r['page_id'] in JV]
        bn = [JV[r['page_id']] for r in AB if not r['inh_final'] and r['page_id'] in JV]
        allp = [JV[r['page_id']] for r in AH + AB if r['inh_final'] and r['page_id'] in JV]
        alln = [JV[r['page_id']] for r in AH + AB if not r['inh_final'] and r['page_id'] in JV]
        # at threshold 0.5: agreement with the full two-pass instrument on every scored page
        agree = sum(1 for v in allp if v >= .5) + sum(1 for v in alln if v < .5)
        A['jev'] = {'scored': len(JV), 'auc_judged': auc(jp, jn), 'n_judged_pos': len(jp), 'n_judged_neg': len(jn),
                    'auc_baseline': auc(bp, bn), 'n_baseline_pos': len(bp),
                    'auc_all': auc(allp, alln), 'n_all_pos': len(allp), 'n_all_neg': len(alln),
                    'agree_at_half': wilson(agree, len(allp) + len(alln)),
                    'recall_at_half': wilson(sum(1 for v in allp if v >= .5), len(allp)),
                    'flag_rate_baseline_at_half': wilson(sum(1 for r in AB if JV.get(r['page_id'], 0) >= .5), len(AB))}
    N['animism'] = A
    # header figures over all four senses: books and languages with any confirmed passage, and random pages holding any
    N['books_all'] = len({r['book_id'] for r in hits if any(r[L + '_final'] for L in LAYERS)} | {r['book_id'] for r in cf})
    N['languages_all'] = len({r['book_language'] for r in hits if any(r[L + '_final'] for L in LAYERS)} | {r['book_language'] for r in cf})
    b4 = {r['page_id'] for r in base if any(r[L + '_final'] for L in LAYERS)} | {r['page_id'] for r in AB if r['inh_final']}
    N['baseline_any4'] = {'confirmed': len(b4), 'rate': wilson(len(b4), nb)}
    for r in cf:
        pts.append({'l': 'inhabited', 'p': 'alive' if r['inh_final'] == 'person' else 'dead', 'y': r.get('book_year'), 't': (r.get('book_title') or '')[:110],
                    'a': (r.get('book_author') or '')[:60], 'lg': r.get('book_language') or '', 'tr': r.get('tradition') or 'other',
                    'c': r.get('dwelling'), 's': r.get('being'), 'v': r['voice_final'], 'rel': r.get('relation'),
                    'q': r['inhabited_quote'], 'why': (r['inh_reason'] or '')[:220], 'fp': False,
                    'u': f"https://sourcelibrary.org/book/{r['book_id']}" + (f"?page={r['page_number']}" if r['page_number'] > 0 else ''), 'fm': r['page_number'] <= 0,
                    'd': r.get('probe_dim'), 'ln': 'animism', 'ph': r.get('probe')})
    print('animism', json.dumps({k: A[k] for k in ['baseline_n', 'baseline', 'draw', 'confirmed', 'books', 'languages', 'voice']}))
    if 'jev' in A: print('jev', json.dumps(A['jev']))

N.setdefault('books_all', N['books']); N.setdefault('languages_all', N['languages'])  # without the fourth layer
N.setdefault('baseline_any4', N['baseline_any'])
# work dates (build/export-work-dates.mjs, from source_work_dates_meta schema 2, #6721): each point carries the date of
# the WORK beside the date of the EDITION it was read in, with the basis of the work date, so the map can place it either way
wd_path = os.path.join(D, 'work-dates.json')
if os.path.exists(wd_path):
    WD = json.load(open(wd_path))
    for p in pts:
        bid = p['u'].split('/book/')[1].split('?')[0]
        w = WD.get(bid)
        if w:
            p['yw'] = w['y']; p['wd'] = w.get('display') or ''; p['wb'] = w.get('basis'); p['wc'] = w.get('confidence')
            p['wf'] = w.get('from'); p['wt'] = w.get('to')  # the work date's range, so the map can spread a mark within it
    have = [p for p in pts if p.get('yw') is not None]
    N['work_dates'] = {'points_with_work_date': len(have), 'points': len(pts),
                       'by_basis': dict(C.Counter(p['wb'] for p in have)),
                       'older_than_edition_100y': sum(1 for p in have if isinstance(p.get('y'), (int, float)) and p['y'] - p['yw'] >= 100)}
    # where each sense sits by work date, by era
    ERAS = [('before 500', -9999, 500), ('500–1399', 500, 1400), ('1400s–1500s', 1400, 1600), ('1600s', 1600, 1700), ('1700 on', 1700, 9999)]
    N['work_eras'] = {'eras': [e[0] for e in ERAS], 'rows': {}}
    for L in LAYERS + ['inhabited']:
        for pole in ['alive', 'dead']:
            sel = [p for p in have if p['l'] == L and p['p'] == pole]
            if len(sel) < 10: continue
            N['work_eras']['rows'][f'{L}_{pole}'] = {'n': len(sel),
                'work': [round(100 * sum(1 for p in sel if lo <= p['yw'] < hi) / len(sel)) for _, lo, hi in ERAS],
                'edition': [round(100 * sum(1 for p in sel if isinstance(p.get('y'), (int, float)) and lo <= p['y'] < hi) / len(sel)) for _, lo, hi in ERAS]}
    print('work dates', json.dumps(N['work_dates']))

N['points'] = len(pts)
json.dump(pts, open(os.path.join(D, 'aliveness-data.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(N, open(os.path.join(D, 'aliveness-numbers.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: N[k] for k in ['baseline_n', 'baseline_any', 'hits_n', 'hits_judged', 'hits_screened_any', 'hits_confirmed_any', 'hits_unjudged_positive', 'books', 'languages', 'points', 'confirmed']}, indent=1))
print('baseline', json.dumps(N['baseline']))
