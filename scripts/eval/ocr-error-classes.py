#!/usr/bin/env python3
# PRIOR ART: benchmark-score.mjs — scores CER / reading-order gap / invention per engine, but does not say
# WHAT the errors are. .claude/docs/page-error-taxonomy.md — 44 page-level classes by eye, no counts. This
# script sorts the word-level differences between an engine and a page reference into named classes and
# counts them, so a CER can be read ("half of lite's error on early print is ſ read as f").
"""
ocr-error-classes.py — what kinds of errors make up an engine's CER, per stratum (#5488).

  python3 scripts/eval/ocr-error-classes.py --root=<bench-images root> --stratum=eebo-tcp-5488,ref-ws \
      [--engines=gemini-3.1-flash-lite,gemini-3-flash-preview] [--out=scripts/eval/results/ocr-error-classes]

Inputs: <root>/<stratum>/out/<engine>/<slug>.txt (benchmark-run-api.mjs), and a PAGE-level reference per slug:
benchmark/refs/<slug>.txt (private refs via SL_PRIVATE_REFS_DIR) or, for ref-ws, ground-truth-ws/<slug>.json
`ocr_ground_truth`. ref-pinned is NOT supported: its references are passages, and every omission or insertion
outside the passage would be miscounted.

Method: tokens are aligned on a folded key (lowercase, punctuation off, ſ→s, æ→ae, œ→oe) with difflib; every
non-equal span is classified. Each class has a KIND:
  ocr       — the engine departs from the page (ſ read as f, misread letters, omissions, refusals …)
  convention— a transcription-convention difference, not a misread (u/v, i/j, accents, case, æ/ae)
  reference — a defect of the reference (TCP illegible-letter marks leave split words; the engine is right)
  alignment — an artefact of the window or the aligner (padding words, running heads, catchwords)
Weights are characters of the affected words (word-weighted, so a ranking of classes, NOT a CER).
How it fails: a class is a heuristic. Examples are written out for reading by eye; quote a class only
after reading its examples (the 2026-10-01 run found tag residue and page numbers inside 'other misread').
"""
import argparse, collections, datetime, difflib, json, os, re, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--root', required=True)
ap.add_argument('--stratum', required=True)
ap.add_argument('--engines', default='gemini-3.1-flash-lite,gemini-3-flash-preview')
ap.add_argument('--out', default=os.path.join(HERE, 'results', 'ocr-error-classes'))
ap.add_argument('--examples', type=int, default=12)
args = ap.parse_args()
PRIV = os.environ.get('SL_PRIVATE_REFS_DIR') or os.path.expanduser('~/sourcelibrary-ops/evals/refs-private')
EDGE = 15

KIND = {
    'long-s read as f': 'ocr', 'f read as s': 'ocr', 'other misread': 'ocr', 'garbled phrase': 'ocr',
    'spelling normalised': 'ocr', 'abbreviation expanded or contracted': 'ocr', 'numerals': 'ocr',
    'word split / joined': 'ocr', 'omitted word(s)': 'ocr', 'omitted run (≥6 words)': 'ocr',
    'inserted word(s)': 'ocr', 'inserted run (≥6 words)': 'ocr', 'refusal (empty output)': 'ocr',
    'markup leaked (html entity / latex)': 'ocr', 'marginal note / note marker / furniture order': 'ocr',
    'u/v i/j convention': 'convention', 'diacritics convention': 'convention', 'case only': 'convention',
    'reference illegible-letter gap (engine right)': 'reference',
    'edge: reference padding not on page': 'alignment', 'edge: running head / page no. / catchword added': 'alignment',
}

TAG = re.compile(r'<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab|header|catchword|sig|page-num)\b[^>]*>[\s\S]*?</\1>|<[^>]+>|```\w*', re.I)
LEAK = re.compile(r'&nbsp;|&[a-z]+;|\$[^$\n]{1,80}\$')
MD = re.compile(r'^#+\s|\*+|(?<!\w)_+|_+(?!\w)', re.M)
def clean(t):
    t = re.sub(r'->|<-', ' ', t or '')                    # centred-line markers BEFORE tag stripping (#5564)
    t = unicodedata.normalize('NFC', TAG.sub(' ', t)).replace('ſ', 's')
    t = re.sub(r'(\w)[-¬]\s*\n\s*(\w)', r'\1\2', t)        # rejoin line-end hyphenation
    return MD.sub(' ', LEAK.sub(' ', t))
def key(w): return re.sub(r'[^\w]', '', w.lower().replace('æ', 'ae').replace('œ', 'oe'))
def toks(t): return [w for w in clean(t).split() if key(w)]
def deacc(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c))
def lev(a, b):
    p = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        c = [i]
        for j, cb in enumerate(b, 1): c.append(min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (ca != cb)))
        p = c
    return p[-1]
ABBR_CH = set('ãẽĩõũñēōūāīꝑꝓꝗ̃̄ꝰ')
ABBR_W = {'ye', 'yt', 'wt', 'wch', 'agst', 'yu', 'ym', 'yr', '&c', 'viz', 'q'}
def modern(w):
    w = w.replace('vv', 'w').replace('v', 'u').replace('j', 'i')
    w = re.sub(r'(.)\1', r'\1', w).replace('y', 'i').replace('ie', 'i').replace('ck', 'c').replace('ph', 'f')
    return re.sub(r'e$', '', w)

def classify_pair(r, h):
    rk, hk = key(r), key(h)
    if rk != hk and deacc(rk) == deacc(hk): return 'diacritics convention'
    if any(c.isdigit() for c in r + h): return 'numerals'
    nfd = unicodedata.normalize('NFD', r + h)
    if any(c in ABBR_CH for c in nfd) or '&' in r + h or rk in ABBR_W or hk in ABBR_W: return 'abbreviation expanded or contracted'
    if len(rk) == len(hk):
        d = [(a, b) for a, b in zip(rk, hk) if a != b]
        if d and all(x == ('s', 'f') for x in d): return 'long-s read as f'
        if d and all({a, b} in ({'u', 'v'}, {'i', 'j'}) for a, b in d): return 'u/v i/j convention'
        if d and all(x == ('f', 's') for x in d): return 'f read as s'
    if modern(rk) == modern(hk): return 'spelling normalised'
    return 'other misread'
def classify_phrase(rs, hs):
    rj, hj = ''.join(map(key, rs)), ''.join(map(key, hs))
    if any(len(key(w)) <= 2 for w in rs) and lev(rj, hj) <= 2: return 'reference illegible-letter gap (engine right)'
    if any(re.search(r'\d|^\(|\)$|^\[|\]$', w) for w in rs + hs): return 'marginal note / note marker / furniture order'
    return 'garbled phrase'

def load_ref(stratum, slug):
    if stratum == 'ref-ws':
        f = os.path.join(HERE, 'ground-truth-ws', slug + '.json')
        return json.load(open(f)).get('ocr_ground_truth') if os.path.exists(f) else None
    for d in (os.path.join(HERE, 'benchmark', 'refs'), PRIV):
        f = os.path.join(d, slug + '.txt')
        if os.path.exists(f): return open(f).read()
    return None
def page_meta(stratum, slug):
    if stratum == 'ref-ws':
        g = json.load(open(os.path.join(HERE, 'ground-truth-ws', slug + '.json')))
        return {'language': g.get('language'), 'year': g.get('year'), 'title': g.get('work'), 'image_url': g.get('image_url'), 'book_id': None, 'page_number': g.get('page_number')}
    reg = os.path.join(HERE, 'benchmark', stratum + '.json')
    if os.path.exists(reg):
        for p in json.load(open(reg)).get('pages', []):
            if p['slug'] == slug: return {k: p.get(k) for k in ('language', 'year', 'title', 'image_url', 'book_id', 'page_number')}
    return {}

def ctx(words, i1, i2, n=5): return ' '.join(words[max(0, i1 - n):i1]), ' '.join(words[i1:i2]), ' '.join(words[i2:i2 + n])

def run(stratum, engine):
    outd = os.path.join(args.root, stratum, 'out', engine)
    chars, pages, ex = collections.Counter(), collections.defaultdict(set), collections.defaultdict(list)
    total, n_pages = 0, 0
    for f in sorted(os.listdir(outd)):
        if not f.endswith('.txt') or f.startswith('_'): continue
        slug = f[:-4]; ref = load_ref(stratum, slug)
        if not ref: continue
        hyp = open(os.path.join(outd, f)).read()
        R, H = toks(ref), toks(hyp); n_pages += 1
        total += sum(map(len, R))
        def add(c, n, i1=None, i2=None, j1=None, j2=None):
            chars[c] += n; pages[c].add(slug)
            if i1 is not None:
                a, rm, b = ctx(R, i1, i2); ex[c].append({'slug': slug, 'ref_before': a, 'ref': rm, 'ref_after': b, 'engine': ' '.join(H[j1:j2])})
        leaks = sum(len(m.group(0)) for m in LEAK.finditer(TAG.sub(' ', re.sub(r'->|<-', ' ', hyp))))
        if leaks: add('markup leaked (html entity / latex)', leaks)
        if sum(len(key(w)) for w in H) < 30:
            add('refusal (empty output)', sum(map(len, R))); ex['refusal (empty output)'].append({'slug': slug, 'ref': ' '.join(R[:25]), 'engine': hyp.strip()[:80]}); continue
        rk, hk = list(map(key, R)), list(map(key, H))
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, rk, hk, autojunk=False).get_opcodes():
            edge = i1 < EDGE or i2 > len(R) - EDGE
            if op == 'equal':
                for k in range(i2 - i1):
                    if R[i1 + k] != H[j1 + k] and R[i1 + k].lower() == H[j1 + k].lower(): add('case only', len(R[i1 + k]), i1 + k, i1 + k + 1, j1 + k, j1 + k + 1)
                continue
            rs, hs = R[i1:i2], H[j1:j2]
            if op == 'replace' and ''.join(rk[i1:i2]) == ''.join(hk[j1:j2]): add('word split / joined', sum(map(len, rs)), i1, i2, j1, j2); continue
            if op == 'replace' and len(rs) == len(hs):
                for k in range(len(rs)): add(classify_pair(rs[k], hs[k]), max(len(rs[k]), len(hs[k])), i1 + k, i1 + k + 1, j1 + k, j1 + k + 1)
                continue
            if op == 'replace' and abs(len(rs) - len(hs)) <= 2 and rs and hs:
                add(classify_phrase(rs, hs), max(sum(map(len, rs)), sum(map(len, hs))), i1, i2, j1, j2); continue
            if rs: add('edge: reference padding not on page' if edge else ('omitted run (≥6 words)' if len(rs) >= 6 else 'omitted word(s)'), sum(map(len, rs)), i1, i2, j1, j1)
            if hs: add('edge: running head / page no. / catchword added' if edge else ('inserted run (≥6 words)' if len(hs) >= 6 else 'inserted word(s)'), sum(map(len, hs)), i2, i2, j1, j2)
    return total, n_pages, chars, pages, ex

def pick(examples, n):
    """Spread examples over pages: one per page first, in slug order, deterministic."""
    seen, first, rest = set(), [], []
    for e in examples: (rest if e['slug'] in seen else first).append(e); seen.add(e['slug'])
    return (first + rest)[:n]

os.makedirs(args.out, exist_ok=True)
date = datetime.date.today().isoformat()
for stratum in args.stratum.split(','):
    res = {'stratum': stratum, 'date': date, 'issue': 5488, 'weights': 'characters of affected words (word-weighted ranking, not CER)', 'kinds': KIND, 'engines': {}}
    for engine in args.engines.split(','):
        if not os.path.isdir(os.path.join(args.root, stratum, 'out', engine)): continue
        total, n, chars, pages, ex = run(stratum, engine)
        ocr_total = sum(v for c, v in chars.items() if KIND.get(c) == 'ocr')
        res['engines'][engine] = {'pages': n, 'ref_chars': total, 'ocr_error_chars': ocr_total,
            'classes': [{'class': c, 'kind': KIND.get(c), 'chars': v, 'share_of_ref': round(v / total, 4) if total else None,
                         'share_of_ocr_errors': round(v / ocr_total, 4) if ocr_total and KIND.get(c) == 'ocr' else None,
                         'pages': len(pages[c]), 'examples': pick(ex[c], args.examples)} for c, v in chars.most_common()]}
        print(f'\n## {stratum} · {engine}: {n} pages, OCR-error chars {ocr_total / total:.1%} of reference (word-weighted)')
        for c, v in chars.most_common():
            k = KIND.get(c)
            if k == 'alignment': continue
            print(f'  {k:10s} {c:48s} {v / total:6.2%} of ref  {(v / ocr_total if k == "ocr" else 0):5.1%} of OCR errors  pages {len(pages[c])}')
    for p in res['engines'].values():
        for c in p['classes']:
            for e in c['examples']: e.update({k: v for k, v in page_meta(stratum, e['slug']).items() if v is not None})
    json.dump(res, open(os.path.join(args.out, f'{stratum}-{date}.json'), 'w'), ensure_ascii=False, indent=1)
