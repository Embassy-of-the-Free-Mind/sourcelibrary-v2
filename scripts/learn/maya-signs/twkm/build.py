"""Normalise the Bonn TWKM Digital Sign Catalog into maya_signs records (#6980).
PRIOR ART: scripts/learn/maya-signs/build.py — same record shape and PNG/key convention, but it parses PDFs
(Stuart, Wayeb); TWKM is a JSON snapshot plus per-graph drawings, so it gets its own builder.
  python3 build.py <data.en.json> <graphs-dir> <out>
<graphs-dir> holds the portal's drawings as <imgUrl>.jpg, fetched from
https://classicmayan.org/portal/sc/client/data/images/graphs/<imgUrl>.jpg (see README).
Output: <out>/signs.jsonl (one record per TWKM graph, drawing or not), <out>/img/*.png,
and <out>/raw.jsonl (every entity of the snapshot, one row each, for the maya_twkm collection)."""
import sys, json, hashlib, io, os, re, collections
from PIL import Image
DATA, GRAPHS, OUT = sys.argv[1:4]
os.makedirs(f'{OUT}/img', exist_ok=True)
d = json.load(open(DATA))
SOURCE = 'twkm-signcatalog'
SRC = {'title': 'A Digital Catalog of Maya Hieroglyphs (Textdatenbank und Wörterbuch des Klassischen Maya)',
       'authors': ['Nikolai Grube (director)', 'Christian Prager (development, editing)'],
       'publisher': 'Rheinische Friedrich-Wilhelms-Universität Bonn, Department of the Anthropology of the Americas',
       'url': 'https://classicmayan.org/signcatalog', 'data': 'https://classicmayan.org/portal/sc/client/data/data.en.json',
       'legal': 'https://classicmayan.org/portal/doc/246', 'snapshot': '2026-10-18',
       'style': 'standardised drawings of graphemes by Christian Prager (2014-present)'}
RIGHTS = {'holder': 'Christian Prager (drawings); TWKM project, University of Bonn (catalog data)',
          'terms': 'drawings CC BY 4.0; catalog data: open access, "freely available for scholarly use as well as public access", no licence stated',
          'permission': 'granted: CC BY 4.0 (drawings by Christian Prager)',
          'credit': 'Drawing by Christian Prager, CC BY 4.0. TWKM Digital Catalog of Maya Hieroglyphs, University of Bonn'}
CHECK = {'by': 'claude-opus-5-5', 'date': '2026-10-18',
         'method': 'random 40-drawing sample (seed 6980) viewed on a labelled contact sheet; drawings are fetched by graph id, not cropped'}
KIND = {'logogram': 'logogram', 'phonogram': 'syllabogram', 'numeric': 'numeric', 'diacritic': 'diacritic'}

cat = {c['id']: c['name'] for c in d['catalogs']}
conc = {c['id']: c for c in d['concordances']}
bib = {b['id']: b['abbreviation'] for b in d['bibliography']}
icon = {i['id']: i['label'] for i in d['iconography']}
sign_tr = {s['signNo']: s.get('translation') for s in d['signs']}
dec = collections.defaultdict(list)
for x in d['decipherments']:
    dec[x['signNo']].append({'value': x['value'], 'type': x['type'], 'conf_level': x['confLevelValue'],
                             'conf_criteria': x.get('confCriteria') or [],
                             'bibliography': [f"{bib.get(b['bibId'], b['bibId'])}{', ' + b['pages'] if b.get('pages') else ''}" for b in x.get('bibliography') or []],
                             'twkm_id': x['id']})
# TWKM confidence level: 1 = most secure (AJAW, ka, CHAN are all 1), higher = less secure. Best reading first.
for v in dec.values(): v.sort(key=lambda r: r['conf_level'] if r['conf_level'] is not None else 99)

def png(path):
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); bg = Image.new('RGBA', im.size, 'white'); bg.alpha_composite(im); im = bg
    im = im.convert('L'); b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    return b.getvalue(), im.size

recs, missing = [], []
for g in d['graphs']:
    s = g['signNo']; rd = dec.get(s, [])
    cc = collections.defaultdict(list)
    for cid in g.get('concordances') or []:
        c = conc.get(cid)
        if c and (c.get('catNumber') or '').strip():
            n = c['catNumber'].strip()
            if n not in cc[cat[c['catId']]]: cc[cat[c['catId']]].append(n)
    top = rd[0] if rd else None
    r = {'_id': f"twkm:{g['graphNo']}", 'source': SOURCE,
         'kind': KIND.get(top['type'], top['type']) if top else 'undeciphered',
         'value': top['value'] if top else None, 'values': [x['value'] for x in rd], 'readings': rd,
         'sign_no': s, 'graph_no': g['graphNo'], 'variant': g.get('variant'),
         'translation': g.get('translation') or sign_tr.get(s),
         'nicknames': [n['name'] for n in g.get('nicknames') or []],
         'iconography': [icon.get(i, i) for i in g.get('iconography') or []],
         'occurrence': g.get('occurrence'), 'concordance': dict(cc),
         'thompson': cc.get('Thompson (1962)', []), 'macri_vail': cc.get('Macri & Vail (2009)', []),
         'empty': False, 'src_page': {'url': 'https://classicmayan.org/portal/signcatalog', 'img': g.get('imgUrl')}}  # no per-graph deep link: /signcatalog/<graphNo> 404s
    if r['kind'] == 'syllabogram' and re.fullmatch(r"[a-z'’]*[aeiou]", r['value'] or ''):
        v = r['value'].replace('’', "'"); r['consonant'], r['vowel'] = (v[:-1] or "'"), v[-1]
    f = f"{GRAPHS}/{g.get('imgUrl')}.jpg"
    if g.get('imgUrl') and os.path.exists(f) and os.path.getsize(f) > 0:
        data, size = png(f); h = hashlib.sha256(data).hexdigest()
        fn = f"twkm-{re.sub(r'[^a-z0-9]+', '-', g['graphNo'].lower()).strip('-')}-{h[:8]}.png"
        open(f'{OUT}/img/{fn}', 'wb').write(data)
        r['image'] = {'file': fn, 'key': f'reference/maya/{SOURCE}/{fn}', 'sha256': h, 'w': size[0], 'h': size[1]}
    else:
        r['image'] = None; missing.append(g['graphNo'])
    r['source_ref'] = SRC; r['rights'] = RIGHTS; r['checked'] = CHECK
    recs.append(r)

with open(f'{OUT}/signs.jsonl', 'w') as fo:
    for r in recs: fo.write(json.dumps(r, ensure_ascii=False) + '\n')
# Raw snapshot: entity rows keyed by their own id (graphs by graphNo, signs by signNo).
KEYS = {'graphs': 'graphNo', 'signs': 'signNo'}
n_raw = collections.Counter()
with open(f'{OUT}/raw.jsonl', 'w') as fo:
    for ent, rows in d.items():
        for row in rows:
            k = row.get(KEYS.get(ent, 'id'))
            fo.write(json.dumps({'_id': f'{ent}:{k}', 'entity': ent, 'data': row}, ensure_ascii=False) + '\n'); n_raw[ent] += 1
print(collections.Counter(r['kind'] for r in recs))
print(len(recs), 'records;', sum(1 for r in recs if r['image']), 'with drawing; ids unique:', len({r['_id'] for r in recs}) == len(recs))
print('no drawing:', len(missing), missing[:10])
print('raw rows:', dict(n_raw), 'total', sum(n_raw.values()))
