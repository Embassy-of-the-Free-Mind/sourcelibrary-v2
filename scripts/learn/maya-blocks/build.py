"""Join the parsed readings (readings.py) to the block boxes (grid.py), crop each block from the PDF at the
drawing's native resolution, and write <work-dir>/out/blocks.jsonl + <work-dir>/out/img/*.png for the loader.
Usage: build.py <pm.pdf> <work-dir> [checks.json]
A range entry ("A1-B2:") gets one crop covering all its blocks and lists them in `blocks`. Entries whose block is
not on the drawing, or that checks.json drops after the by-eye pass, are kept as records with image: null and
`dropped` saying why, so the answer key stays complete."""
import pymupdf, json, re, hashlib, os, sys, collections
PDF, WORK = sys.argv[1:3]
CHECKS = json.load(open(sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), 'checks.json')))
d = pymupdf.open(PDF)
R = json.load(open(f'{WORK}/readings.json')); C = json.load(open(f'{WORK}/cells.json'))
OUT = f'{WORK}/out'; os.makedirs(f'{OUT}/img', exist_ok=True)

SOURCE = {'title': 'The Palenque Mythology: Inscriptions from the Cross Group at Palenque', 'author': 'David Stuart', 'year': 2006,
          'series': 'Sourcebook for the 30th Maya Meetings, March 14-19, 2006', 'publisher': 'The Mesoamerica Center, Department of Art and Art History, The University of Texas at Austin'}
PERMISSION = 'granted: open access per David Stuart to Derek Lomas 2026-10-18'
CHECK = {'by': 'claude-opus-5-5', 'date': '2026-10-18', 'method': 'every crop viewed on a labelled contact sheet next to its reading; grid overlays checked against the printed column letters and row numbers'}
PRE = {'The Temple of the Cross': 'tc', 'The Temple of the Foliated Cross': 'tfc', 'The Temple of the Sun': 'ts'}
NAMES = {'tc-alfardas': 'Temple of the Cross, alfardas (balustrades)', 'tc-shrine-facade': 'Temple of the Cross, shrine façade glyph band',
         'tc-sanctuary-panel-left': 'Temple of the Cross, left sanctuary panel caption', 'tc-sanctuary-jamb': 'Temple of the Cross, sanctuary jamb',
         'tc-main-tablet': 'Tablet of the Cross', 'tfc-alfardas': 'Temple of the Foliated Cross, alfardas (balustrades)',
         'tfc-sanctuary-jamb': 'Temple of the Foliated Cross, sanctuary jamb', 'tfc-main-tablet': 'Tablet of the Foliated Cross',
         'ts-alfardas': 'Temple of the Sun, alfardas (balustrades)', 'ts-sanctuary-jamb': 'Temple of the Sun, sanctuary jamb', 'ts-main-tablet': 'Tablet of the Sun'}

def slug(temple, section):
    p = PRE[temple]; s = (section or '').lower()
    if 'balustrade' in s: return f'{p}-alfardas'
    if 'façade' in s: return f'{p}-shrine-facade'
    if 'sanctuary panel' in s: return f'{p}-sanctuary-panel-left'
    if 'jamb' in s: return f'{p}-sanctuary-jamb'
    return f'{p}-main-tablet'

# Credit lines as printed beside the drawings (p.24 "Drawings by D. Stuart"; p.50 signed "L. Schele '78").
# The other drawing pages carry no credit line; the sourcebook's drawings are mostly Linda Schele's.
CREDIT = {24: 'David Stuart', 50: 'Linda Schele (signed 1978)'}
def drawing_credit(page):
    return CREDIT.get(page, 'uncredited on the page (most of the sourcebook\'s drawings are Linda Schele\'s)')

cell = {(c['monument'], c['coord']): c for c in C}
def split(co):
    m = re.match(r'^(p?[A-Z]{1,2}?)(p?\d+)$', co); return m.groups() if m else None
def expand(mon, co):
    if '-' not in co: return [co]
    A, B = map(split, co.split('-'))
    if not A or not B: return None
    num = lambda s: int(re.sub(r'\D', '', s))
    out = [k[1] for k in cell if k[0] == mon and split(k[1])
           and min(A[0], B[0]) <= split(k[1])[0] <= max(A[0], B[0])
           and min(num(A[1]), num(B[1])) <= num(split(k[1])[1]) <= max(num(A[1]), num(B[1]))]
    return out or None

recs, drop, seen = [], collections.Counter(), collections.Counter()
for r in R:
    mon = slug(r['temple'], r['section']); co = r['coord']; flags = []
    fix = CHECKS['coord_fixes'].get(f"{mon}:{co}:p{r['pdf_page']}")
    if fix: flags.append(f"coord_corrected: printed {co}; {fix['why']}"); co = fix['coord']
    rid = f'{mon}-{co}'; seen[rid] += 1
    if seen[rid] > 1: raise SystemExit(f'duplicate block {rid}: add a coord_fixes entry')
    text = ' '.join([r['transliteration'], r['transcription'], r['translation']])
    if '?' in text: flags.append('uncertain')
    if '[' in text or '…' in text: flags.append('bracketed')
    if '-' in co: flags.append('range')
    if not (r['transliteration'] and r['transcription'] and r['translation']): flags.append('incomplete_entry')
    if rid in CHECKS['partial']: flags.append('partial_on_drawing')
    parts = expand(mon, co)
    boxes = [cell[(mon, p)] for p in (parts or []) if (mon, p) in cell]
    rec = {'_id': f'palenque-mythology-2006:{rid}', 'monument': mon, 'monument_name': NAMES[mon], 'section': r['section'], 'coord': co,
           'blocks': parts if parts and len(parts) > 1 else None,
           'transliteration': r['transliteration'], 'transcription': r['transcription'], 'translation': r['translation'],
           'flags': flags, 'pdf_page': r['pdf_page'], 'printed_page': r['printed_page'], 'image': None, 'dropped': None}
    reason = CHECKS['drop'].get(rid) or (None if boxes else 'block not on the drawing (broken off or not drawn)')
    if reason:
        rec['dropped'] = reason; drop[reason] += 1; recs.append(rec); continue
    pg, z = boxes[0]['page'], boxes[0]['zoom']
    b = [min(x['box_pt'][0] for x in boxes), min(x['box_pt'][1] for x in boxes), max(x['box_pt'][2] for x in boxes), max(x['box_pt'][3] for x in boxes)]
    pix = d[pg - 1].get_pixmap(matrix=pymupdf.Matrix(z, z), clip=pymupdf.Rect(*b), colorspace=pymupdf.csGRAY)
    png = pix.tobytes('png'); h = hashlib.sha256(png).hexdigest()
    fn = f'{mon}-{co}-{h[:8]}.png'; open(f'{OUT}/img/{fn}', 'wb').write(png)
    rec['image'] = {'file': fn, 'key': f'reference/maya/palenque-mythology-2006/{fn}', 'sha256': h, 'w': pix.width, 'h': pix.height}
    rec['source_ref'] = SOURCE | {'pdf_page': r['pdf_page'], 'printed_page': r['printed_page'],
                                  'drawing_pdf_page': pg, 'box_pt': [round(v, 1) for v in b], 'zoom': z, 'panel': boxes[0]['panel']}
    rec['rights'] = {'holder': 'David Stuart; drawings by their credited artists', 'permission': PERMISSION,
                     'drawing_credit': drawing_credit(pg), 'credit': f'Drawing: {drawing_credit(pg)}. From David Stuart, The Palenque Mythology (2006), used with permission'}
    rec['checked'] = CHECK
    recs.append(rec)
with open(f'{OUT}/blocks.jsonl', 'w') as f:
    for r in recs: f.write(json.dumps(r, ensure_ascii=False) + '\n')
by = collections.Counter(r['monument'] for r in recs if r['image'])
print(f"{len(recs)} entries; {sum(by.values())} with a crop; dropped {sum(drop.values())}: {dict(drop)}")
print(dict(by))
