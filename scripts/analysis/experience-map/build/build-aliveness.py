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
  python3 build/build-aliveness.py <dir>   (dir holds classified-aliveness.jsonl, judged-aliveness.jsonl,
                                            baseline-aliveness.jsonl, baseline-judged.jsonl)
"""
import json, sys, math, collections as C, os

D = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/sourcelibrary/scripts/output/experience-map/aliveness')
LAYERS = ['felt', 'world', 'made']

def load(p):
    return [json.loads(l) for l in open(os.path.join(D, p)) if l.strip()]

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

# points
pts = []
for r in hits:
    for L in LAYERS:
        p = r[L + '_final']
        if not p: continue
        pts.append({'l': L, 'p': p, 'y': r.get('book_year'), 't': (r.get('book_title') or '')[:110], 'a': (r.get('book_author') or '')[:60],
                    'lg': r.get('book_language') or '', 'tr': r.get('tradition') or 'other', 'c': r.get('carrier'), 's': r.get('source_of_life'),
                    'q': r[L + '_quote'], 'why': (r[L + '_reason'] or '')[:220], 'fp': r.get('first_person'),
                    'u': f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}", 'd': r.get('probe_dim'), 'ln': r['lane'], 'ph': r.get('probe') if r['lane'] == 'lexical' else None})
N['points'] = len(pts)
json.dump(pts, open(os.path.join(D, 'aliveness-data.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(N, open(os.path.join(D, 'aliveness-numbers.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: N[k] for k in ['baseline_n', 'baseline_any', 'hits_n', 'hits_judged', 'hits_screened_any', 'hits_confirmed_any', 'hits_unjudged_positive', 'books', 'languages', 'points', 'confirmed']}, indent=1))
print('baseline', json.dumps(N['baseline']))
