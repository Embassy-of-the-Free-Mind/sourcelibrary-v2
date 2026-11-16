# PRIOR ART: scripts/eval/error-zoo/zoo-stats.py heat() (the weekly audit's "serious" page share, one source) and
# scripts/eval/confidence-7866/results/served-grades.json (severe defects per 1,000 words by language, the measure
# /quality publishes, from a 160-book severity-graded draw: too thin to cut by language AND period on its own).
"""The /quality heat map (#244): defects that change the sense, per 1,000 words, by language × half-century.

Pools the two whole-page random draws of served pages, each judged against the page image:
  - the weekly audit: findings rated `serious` ("a reader would be misled about what the source says"); `moderate`
    ("wrong but recoverable from context") and `minor` are not counted, per the severe-defects standard
    (.claude/docs/quality-statements.md; Derek 2026-11-01);
  - paired-fifths-check: every defect its reader rated `misleads` or `wrong_text` (book_checks page_notes, via
    labels.mjs `notes`); `cosmetic` is not counted. Rows from before labels.mjs kept notes fall back to page_findings.
Each draw is put on the served-grades (7866) scale by one factor: the ratio, over the languages all three cover with
5+ books, of 7866 severe_per_1k to the draw's own per-1k rate, words-weighted. Words as
route-judge-6740/defect-rate.mjs words(), Han at 1.5 characters a word (as 7866 book-grades), over the page's OCR text.

Measured 2026-11-13 on /root/jobs/error-zoo-v2 (gex45): by language the weekly serious rate ranks as 7866 does
(Spearman 1.0, 5 languages), fifths at 0.89; cell by cell weekly vs fifths 0.57 (15 cells). Page shares agreed worse
(0.37 on "serious"). A class-based severity rule fails: 2 of 41 classes are mostly rated serious.

Two more cuts, each language × one factor (Derek 2026-11-13: "split by script type, and any other factor we know"):
  - script: print | manuscript | mixed | unknown, as the router decides it (lane-judge-sampler.mjs scriptClass): the
    page's <script> tag, then pages.script_type, then the book's majority among its pages here.
  - density: words on the page (the same count as the rate's denominator), in four bins.

  python3 scripts/eval/error-zoo/pooled-defects.py scripts/eval/error-zoo/zoo-stats.py <zoo dir> \
      scripts/eval/confidence-7866/results/served-grades.json <out.json>
"""
import sys, re, json, collections as C
src_path, d, sg_path, out = sys.argv[1:5]
code = open(src_path).read().split("stats = dict(threshold_note")[0]
code = code.replace("recs.append(dict(src=r['source'], ",
                    "recs.append(dict(src=r['source'], meth=r.get('method'), sel=r.get('selection'), exp=r.get('exposure'), bid=r.get('book_id'), notes=r.get('notes'), ")
sys.argv = [src_path, d]
g = {'__name__': 'zoo_stats_inline'}
exec(compile(code, src_path, 'exec'), g)
recs, pages, BINS = g['recs'], g['pages'], g['BINS']

HAN = re.compile(r'[㐀-鿿豈-﫿\U00020000-\U0002ffff]')
TIB = re.compile(r'[ཀ-ྼ]')
LET = re.compile(r'[^\W\d_]', re.U)
def words(t):
    if not t: return 0
    b = re.sub(r'<[^>]*>', ' ', str(t)); b = re.sub(r'^\s*#+\s*', ' ', b, flags=re.M).replace('|', ' ')
    han = len(HAN.findall(b)); tib = len(TIB.findall(b)); lat = len(LET.findall(b)) - han - tib
    if han > lat and han >= tib: return han / 1.5
    if tib > lat: return len([x for x in re.split(r'[་།༎\s]+', b) if TIB.search(x)])
    return len([x for x in b.split() if re.search(r'\w', x)])

FOLD = {'lat': 'Latin', 'la': 'Latin', 'de': 'German', 'fr': 'French', 'it': 'Italian', 'grc': 'Greek', 'zh': 'Chinese', 'nl': 'Dutch',
        'Latin-German': 'Latin', 'Greek-Latin': 'Greek', 'Middle Dutch': 'Dutch', 'Law French': 'French', 'Anglo-Saxon': 'English', 'Old English': 'English'}
SKIP = {'und', 'Unknown', 'Multiple', '?', None, ''}
UNDATED = 'date unknown'
MIN_WORDS_PAGE = 20
SEVERE = ('misleads', 'wrong_text')
TAG = re.compile(r'<script>\s*(printed|handwritten|mixed)\s*</script>', re.I)
HAND = {'printed': 'print', 'handwritten': 'manuscript', 'mixed': 'mixed'}
SCRIPTS = ['print', 'manuscript', 'mixed', 'unknown']
DENSITY = [(150, 'under 150 words'), (300, '150–300 words'), (500, '300–500 words'), (10 ** 9, '500+ words')]
def density(w): return next(lab for hi, lab in DENSITY if w < hi)

# The book's majority hand, from the pages of it we hold (scriptClass's third step).
book_hand = C.defaultdict(C.Counter)
for pg in pages.values():
    h = HAND.get(pg.get('script_type'))
    if h in ('print', 'manuscript'): book_hand[pg.get('book_id')][h] += 1
def script_of(pg, bid):
    m = TAG.search(pg.get('ocr_text') or '')
    if m: return HAND[m.group(1).lower()]
    if HAND.get(pg.get('script_type')): return HAND[pg['script_type']]
    bh = book_hand.get(bid)
    return bh.most_common(1)[0][0] if bh else 'unknown'

rows, dropped = [], C.Counter()
for x in recs:
    if x['exp'] != 'served' or x['src'] == 'spare_audit_gemini': continue
    if x['meth'] == 'convergent-audit-weekly' and x['sel'] == 'random':
        src, e = 'weekly', sum(1 for c, s in x['errs'] if s == 'serious')
    elif x['meth'] == 'paired-fifths-check':
        notes = x.get('notes')
        src, e = 'fifths', (sum(1 for n in notes if n.get('severity') in SEVERE) if notes is not None else len(x['errs']))
    else:
        continue
    L = FOLD.get(x['lang'], x['lang'])
    if L in SKIP: dropped[f'{src}: no language'] += 1; continue
    pg = pages.get(x['pid']) or {}
    w = words(pg.get('ocr_text'))
    if w < MIN_WORDS_PAGE: dropped[f'{src}: no text'] += 1; continue
    rows.append(dict(src=src, lang=L, bin=x['yb'] or UNDATED, w=w, e=e, bid=x['bid'], ocr=x.get('ocr') or 'unknown',
                     script=script_of(pg, x['bid']), density=density(w)))

# Calibrate each draw to the 7866 severe_per_1k scale, by language.
SG = {r['language']: r for r in json.load(open(sg_path))['by_language'] if r.get('books', 0) >= 5}
factor, fit = {}, {}
for src in ('weekly', 'fifths'):
    W, E = C.Counter(), C.Counter()
    for r in rows:
        if r['src'] == src: W[r['lang']] += r['w']; E[r['lang']] += r['e']
    ls = [l for l in SG if W.get(l, 0) > 3000 and E.get(l, 0) > 0]
    target = sum(SG[l]['severe_per_1k'] * W[l] for l in ls)      # 7866 rate × this draw's words = expected defects
    own = sum(1000 * E[l] for l in ls)
    factor[src] = target / own
    fit[src] = {l: dict(own_per_1k=round(1000 * E[l] / W[l], 2), served_grades_per_1k=SG[l]['severe_per_1k']) for l in ls}

W, E, B, P, S = C.Counter(), C.Counter(), C.defaultdict(set), C.Counter(), C.defaultdict(C.Counter)
for r in rows:
    k = (r['lang'], r['bin'])
    W[k] += r['w']; E[k] += factor[r['src']] * r['e']; B[k].add(r['bid']); P[k] += 1; S[k][r['src']] += 1
cells = [dict(lang=k[0], bin=k[1], pages=P[k], books=len(B[k]), words=round(W[k]), value=round(1000 * E[k] / W[k], 2),
              weekly_pages=S[k]['weekly'], fifths_pages=S[k]['fifths']) for k in W]
langs = [l for l, _ in C.Counter(r['lang'] for r in rows).most_common()]
res = dict(measure='defects that change the sense per 1,000 words, on the served-grades (7866) scale',
           factors={k: round(v, 3) for k, v in factor.items()}, calibration=fit, dropped=dict(dropped),
           n_pages=len(rows), n_weekly=sum(r['src'] == 'weekly' for r in rows), n_fifths=sum(r['src'] == 'fifths' for r in rows),
           n_books=len({r['bid'] for r in rows}), words=round(sum(W.values())),
           per_1k_all=round(1000 * sum(E.values()) / sum(W.values()), 2),
           heat=dict(langs=langs, bins=[b[2] for b in BINS] + [UNDATED], cells=cells))
# By OCR engine (admin only: model names stay off reader pages, Derek 2026-11-04). Engines are routed by language and
# script, so the useful cut is language × engine: compare engines within a row, not down the totals.
EW, EE, EB, EP = C.Counter(), C.Counter(), C.defaultdict(set), C.Counter()
for r in rows:
    k = (r['lang'], r['ocr'])
    EW[k] += r['w']; EE[k] += factor[r['src']] * r['e']; EB[k].add(r['bid']); EP[k] += 1
engines = [e for e, _ in C.Counter(r['ocr'] for r in rows).most_common()]
res['by_engine'] = dict(langs=langs, bins=engines, cells=[
    dict(lang=k[0], bin=k[1], pages=EP[k], books=len(EB[k]), words=round(EW[k]), value=round(1000 * EE[k] / EW[k], 2)) for k in EW])
res['engine_totals'] = {e: dict(pages=sum(EP[k] for k in EP if k[1] == e), books=len(set().union(*[EB[k] for k in EB if k[1] == e])),
                                value=round(1000 * sum(EE[k] for k in EE if k[1] == e) / sum(EW[k] for k in EW if k[1] == e), 2)) for e in engines}
# Language × one factor, same pages and scale as the map.
def cut(key, cols):
    W2, E2, B2, P2 = C.Counter(), C.Counter(), C.defaultdict(set), C.Counter()
    for r in rows:
        k = (r['lang'], r[key]); W2[k] += r['w']; E2[k] += factor[r['src']] * r['e']; B2[k].add(r['bid']); P2[k] += 1
    tot = {c: dict(pages=sum(P2[k] for k in P2 if k[1] == c), books=len(set().union(*([B2[k] for k in B2 if k[1] == c] or [set()]))),
                   value=round(1000 * sum(E2[k] for k in E2 if k[1] == c) / max(1, sum(W2[k] for k in W2 if k[1] == c)), 2)) for c in cols}
    return dict(langs=langs, bins=cols, cells=[dict(lang=k[0], bin=k[1], pages=P2[k], books=len(B2[k]), words=round(W2[k]),
                value=round(1000 * E2[k] / W2[k], 2)) for k in W2]), {c: t for c, t in tot.items() if t['pages']}
res['by_script'], res['script_totals'] = cut('script', SCRIPTS)
res['by_density'], res['density_totals'] = cut('density', [lab for _, lab in DENSITY])
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
print('script', json.dumps(res['script_totals']))
print('density', json.dumps(res['density_totals']))
print('engines', json.dumps(res['engine_totals']))
for c in sorted([c for c in res['by_engine']['cells'] if c['pages'] >= 8 and c['books'] >= 4], key=lambda c: (c['lang'], -c['pages'])):
    print(f"  {c['lang']:9s} {c['bin']:18s} {c['value']:6.1f}/1k  pages {c['pages']:4d} books {c['books']:3d}")
print('factors', res['factors'], 'dropped', res['dropped'])
print(f"pages {res['n_pages']} (weekly {res['n_weekly']}, fifths {res['n_fifths']}), books {res['n_books']}, all {res['per_1k_all']} per 1k")
solid = sorted([c for c in cells if c['pages'] >= 8 and c['books'] >= 4], key=lambda c: -c['words'])
print('solid cells', len(solid))
for c in solid: print(f"  {c['lang']:9s} {c['bin']:13s} {c['value']:6.1f}/1k  pages {c['pages']:4d} books {c['books']:3d} words {c['words']:6d}")
