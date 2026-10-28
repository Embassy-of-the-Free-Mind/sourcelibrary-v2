#!/usr/bin/env python3
"""E0 of #7567: freeze one European-print panel with TYPED references only.

PRIOR ART: /root/jobs/pareto-chains-6740 (job of PR for #6740) holds the images and the flash-lite drafts of
eebo-tcp-5488, latin-period-5126 and ref-ws, plus lite->Opus and lite->agy-Flash corrections of those drafts; this
panel reuses them so E2's arm (a) has a stored lite draft and arm (f) a stored Opus correction (no new Gemini API).
scripts/eval/harvest-wikisource-gt.mjs harvested fr / it (validated Wikisource pages, run unchanged with
--wiki=fr|it --from=1500 --to=1800 --max=48). German early-modern print comes from the Deutsches Textarchiv
(page-aligned diplomatic TEI of the same scan, as scripts/eval/ground-truth/german-*.json already use).
Not used, with reasons: latin-r4-acc (no stored lite drafts and no images on this box; Latin is already the largest
cell), german-fraktur and longs-en-fr (agreement references, not typed), GT4HistOCR (lines, shuffled), CATMuS/modern
(line crops, no pages; Italian print is 266 lines) — FR/IT come from Wikisource instead.

  build-panel.py <job dir>      writes <job dir>/img/<slug>.jpg and, in this directory, panel.json + refs.jsonl.gz
"""
import gzip, hashlib, html, io, json, os, random, re, sys, time, urllib.request

J = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PC = '/root/jobs/pareto-chains-6740'
IMG = os.path.join(J, 'img'); os.makedirs(IMG, exist_ok=True)
UA = {'User-Agent': 'SourceLibrary-eval/1.0 (https://sourcelibrary.org; #7567)', 'Cookie': 'verified=1'}
rng = random.Random(7567)

CANON_DE = re.compile(r'goethe|schiller|luther|kant|lessing|herder|hegel|klopstock|wieland|grimmelshausen|opitz|gryphius|'
                      r'kleist|novalis|hölderlin|leibniz|humboldt|heine|fichte|schelling|jean paul|hoffmann', re.I)
CANON_ROM = re.compile(r'moli[eè]re|racine|corneille|montaigne|rabelais|pascal|la fontaine|voltaire|rousseau|descartes|'
                       r'dante|petrarca|boccaccio|ariosto|tasso|machiavelli|galilei|castiglione|goldoni|metastasio', re.I)


def get(url, binary=False, tries=4):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            return r if binary else r.decode('utf-8')
        except Exception as e:  # noqa: BLE001
            err = e; time.sleep(2 + 3 * i)
    raise RuntimeError(f'{url}: {err}')


def save_img(slug, data):
    p = os.path.join(IMG, slug + '.jpg')
    with open(p, 'wb') as f: f.write(data)
    return hashlib.sha256(data).hexdigest()


rows = []
def add(**r):
    r['image'] = f'img/{r["slug"]}.jpg'
    rows.append(r)

# 1-2. EEBO-TCP (English + Latin) and latin-period-5126: library pages, typed same-edition references.
for stratum in ['eebo-tcp-5488', 'latin-period-5126']:
    man = json.load(open(f'{REPO}/scripts/eval/benchmark/{stratum}.json'))
    for p in man['pages']:
        s = p['slug']; sub = p.get('substratum', '')
        if 'corrected-OCR' in sub: continue                      # a corrected OCR read is not a typed reference
        src = f'{PC}/bench/{stratum}/{s}.jpg'; ref = f'{REPO}/scripts/eval/benchmark/refs/{s}.txt'
        lite = f'{PC}/bench/{stratum}/out/gemini-3.1-flash-lite/{s}.txt'
        if not (os.path.exists(src) and os.path.exists(ref)): continue
        meta = json.load(open(ref[:-4] + '.json'))
        data = open(src, 'rb').read()
        lang = 'en' if sub.startswith('English') else 'la'
        add(slug=s, set=stratum, lang=lang, century=int(re.search(r'1[4-8]00', sub).group(0)[:2]) if re.search(r'1[4-8]00', sub) else None,
            year=p.get('year'), book_id=p.get('book_id'), page_number=p.get('page_number'), title=p.get('title'),
            ref_source=meta.get('source'), ref_kind=meta.get('reference_kind'), fidelity='diplomatic-tcp' if 'EEBO' in (meta.get('source') or '') else 'edition',
            canonical=str(meta.get('canonical')) == 'True', image_sha256=save_img(s, data),
            ref_text=open(ref).read(), lite=os.path.exists(lite) and os.path.getsize(lite) > 0, pc_stratum=stratum)

# 3. Wikisource la + de already in the ref-ws bench (lite drafts and corrections exist); Latin 1800s dropped.
ws_meta = {}
for f in ['la-1450-1900.json', 'la-1450-1850.json', 'la-1500-1800.json', 'de-1500-1850.json']:
    d = json.load(open(f'{REPO}/scripts/eval/ground-truth-wikisource/{f}'))
    for p in (d['pages'] if isinstance(d, dict) else d): ws_meta.setdefault(p['slug'], p)
res = {p['slug']: p for p in json.load(open(f'{REPO}/scripts/eval/results/benchmark/ref-ws-2026-09-16.json'))['pages']}
for fn in sorted(os.listdir(f'{PC}/bench/ref-ws/out/gemini-3.1-flash-lite')):
    if not fn.endswith('.txt'): continue
    s = fn[:-4]; m = ws_meta.get(s); r = res.get(s, {})
    if not m or not os.path.exists(f'{PC}/bench/ref-ws/{s}.jpg') or len(re.sub(r'\W', '', m.get('reference') or '')) < 200: continue
    lang = m['wiki']; yr = int(str(m.get('year') or 0)[:4] or 0)
    if lang == 'la' and yr >= 1800: continue
    add(slug=s, set='ref-ws', lang=lang, century=yr // 100, year=yr, title=m.get('work'), ref_source=m.get('source'),
        ref_kind='same-scan-transcription', fidelity=m.get('fidelity'), canonical=r.get('non_canonical') is False,
        image_sha256=save_img(s, open(f'{PC}/bench/ref-ws/{s}.jpg', 'rb').read()), ref_text=m['reference'], lite=True, pc_stratum='ref-ws')

# 4. Wikisource fr / it, harvested for this job (no lite draft exists; $0 API means none is made).
for lang in ['fr', 'it']:
    d = json.load(open(f'{J}/ws-{lang}/{lang}-1500-1800.json'))
    ps = sorted(d['pages'] if isinstance(d, dict) else d, key=lambda p: p['slug'])
    rng.shuffle(ps); n = 0
    for m in ps:
        if n >= 40: break
        ref = re.sub(r'^\[versione diplomatica\]\s*', '', m['reference'])
        if len(re.sub(r'\W', '', ref)) < 500: continue
        try: data = get(m['image_url'], binary=True)
        except Exception as e: print('skip', m['slug'], e); continue  # noqa: BLE001
        add(slug=m['slug'], set=f'ws-{lang}', lang=lang, century=int(str(m['year'])[:2]), year=int(str(m['year'])[:4]), title=m.get('work'),
            ref_source=m.get('source'), ref_kind='same-scan-transcription', fidelity=m.get('fidelity'),
            canonical=bool(CANON_ROM.search((m.get('work') or '') + ' ' + (m.get('commons_file') or ''))),
            image_sha256=save_img(m['slug'], data), ref_text=ref, lite=False, source_url=m.get('source_url'))
        n += 1

# 5. DTA German 1550-1799: 16 non-canonical works, 2 interior pages each (30-80% of the book, >= 700 letters).
works = []
for lp in sorted(rng.sample(range(1, 56), 14)):
    h = get(f'https://www.deutschestextarchiv.de/list?p={lp}')
    for name, label in re.findall(r'book/show/([a-z0-9_]+)">([^<]+)</a>', h):
        y = re.search(r'_(1[5-7]\d\d)$', name)
        if y and 1550 <= int(y.group(1)) <= 1799 and not CANON_DE.search(label): works.append((name, html.unescape(label), int(y.group(1))))
works = sorted(set(works)); rng.shuffle(works)
taken = 0
for name, label, yr in works:
    if taken >= 16: break
    try: txt = get(f'https://www.deutschestextarchiv.de/book/download_txt/{name}')
    except Exception as e: print('skip', name, e); continue  # noqa: BLE001
    # DTA marks a page as [0040] or, where the leaf carries a printed number, [36/0040]: split on both (the frozen
    # panel's Walter p68/p118 references were cut by hand, panel.json `amended`)
    parts = re.split(r'^\[(?:\d+/)?(\d{4})\]\s*$', txt, flags=re.M)
    pages = {int(parts[i]): parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
    if len(pages) < 40: continue
    keys = sorted(pages); lo, hi = keys[int(len(keys) * .30)], keys[int(len(keys) * .80)]
    cand = [k for k in keys if lo <= k <= hi and len(re.sub(r'\W', '', pages[k])) >= 700 and '[Abbildung]' not in pages[k]
            and '[Formel' not in pages[k] and '[Tabelle]' not in pages[k]]
    if len(cand) < 6: continue
    half = len(cand) // 2
    picks = [rng.choice(cand[:half]), rng.choice(cand[half:])]
    ok = []
    for k in picks:
        slug = f'dta-{name}-p{k}'
        try: data = get(f'https://www.deutschestextarchiv.de/media/images/{name}/{name}_{k:04d}_1600px.jpg', binary=True)
        except Exception as e: print('skip', slug, e); continue  # noqa: BLE001
        ok.append(dict(slug=slug, set='dta', lang='de', century=yr // 100, year=yr, title=label[:160], ref_source=f'Deutsches Textarchiv {name}',
                       ref_kind='same-scan-transcription', fidelity='glyph', canonical=False, image_sha256=save_img(slug, data),
                       ref_text=pages[k], lite=False, source_url=f'https://www.deutschestextarchiv.de/book/view/{name}?p={k}'))
    if len(ok) == 2:
        for r in ok: add(**r)
        taken += 1

# Freeze: non-canonical first, then set, then slug. Reference texts go in refs.jsonl.gz, the manifest stays small.
order = ['eebo-tcp-5488', 'latin-period-5126', 'ref-ws', 'dta', 'ws-fr', 'ws-it']
rows.sort(key=lambda r: (r['canonical'], order.index(r['set']), r['slug']))
with gzip.open(os.path.join(HERE, 'refs.jsonl.gz'), 'wt') as f:
    for r in rows: f.write(json.dumps({'slug': r['slug'], 'ref_text': r['ref_text']}, ensure_ascii=False) + '\n')
for r in rows:
    r['ref_sha256'] = hashlib.sha256(r.pop('ref_text').encode()).hexdigest()
cells = {}
for r in rows: cells[r['lang']] = cells.get(r['lang'], 0) + 1
json.dump({'issue': 7567, 'stage': 'E0', 'frozen_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'seed': 7567,
           'n': len(rows), 'by_lang': cells, 'with_lite': sum(r['lite'] for r in rows), 'canonical': sum(r['canonical'] for r in rows),
           'pages': rows}, open(os.path.join(HERE, 'panel.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(cells), len(rows), 'lite', sum(r['lite'] for r in rows))
