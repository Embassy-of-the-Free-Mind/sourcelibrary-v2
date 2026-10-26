# PRIOR ART: scripts/eval/benchmark-score.mjs and en-ocr-reference-5124.mjs (score OCR against refs; no script
# census), the #4763 date_dense_rule in benchmark/english-ia-5124.json (applied here, unchanged, to every reference).
# Joins the manifest with: script = Unicode census of the by-eye / corrected reference text (the page's own letters,
# not the catalogue), kind = the #4763 rule on that same reference (>= 6 numeric tokens /^\d{2,4}$/ → date-dense),
# and the Opus check-set labels. Writes labels.jsonl. Usage: python labels.py MANIFEST BENCHDIR CHECKDIR OUT
import sys, json, re, os, glob, collections
man, bench, checkdir, outp = sys.argv[1:5]
RANGES = [('Latn', [(0x41, 0x5A), (0x61, 0x7A), (0xC0, 0x24F), (0x1E00, 0x1EFF), (0xA720, 0xA7FF)]),
          ('Grek', [(0x370, 0x3FF), (0x1F00, 0x1FFF)]), ('Cyrl', [(0x400, 0x52F)]), ('Armn', [(0x530, 0x58F)]),
          ('Hebr', [(0x590, 0x5FF), (0xFB1D, 0xFB4F)]), ('Arab', [(0x600, 0x6FF), (0x750, 0x77F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)]),
          ('Syrc', [(0x700, 0x74F)]), ('Deva', [(0x900, 0x97F)]), ('Beng', [(0x980, 0x9FF)]), ('Tibt', [(0xF00, 0xFFF)]),
          ('Ethi', [(0x1200, 0x139F)]), ('Mong', [(0x1800, 0x18AF)]), ('Geor', [(0x10A0, 0x10FF)]), ('Copt', [(0x2C80, 0x2CFF)]),
          ('Kana', [(0x3040, 0x30FF)]), ('Hani', [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0x20000, 0x2FA1F)]),
          ('Hang', [(0xAC00, 0xD7AF), (0x1100, 0x11FF)])]
def script_of(ch):
    o = ord(ch)
    for n, rs in RANGES:
        for a, b in rs:
            if a <= o <= b: return n
def census(txt):
    txt = re.sub(r'<[^>]{0,80}>', ' ', txt)  # drop tags
    c = collections.Counter(s for s in map(script_of, txt) if s)
    tot = sum(c.values())
    if tot < 30: return None, c
    if c['Kana'] >= 0.05 * (c['Kana'] + c['Hani']) and c['Kana'] + c['Hani'] > 0.5 * tot: return 'Jpan', c
    c2 = collections.Counter(c); c2['Hani'] += c2.pop('Kana', 0)
    return c2.most_common(1)[0][0], c
NUM = re.compile(r'^\d{2,4}$')
def date_dense(txt):
    body = re.sub(r'<[^>]{0,80}>', ' ', txt)
    return sum(1 for t in re.split(r'[^\w]+', body) if NUM.match(t)) >= 6
out = []
for r in map(json.loads, open(man)):
    lab = dict(r.get('labels') or {}); src = {k: r['label_src'] for k in lab}
    if r.get('ref'):
        txt = open(os.path.join(bench, r['ref'])).read()
        s, c = census(txt)
        if s: lab['script'] = s; src['script'] = 'reference Unicode census'
        if s and len(txt) > 200:
            looks_table = txt.count('|') > 40 or '<table' in txt
            lab['kind'] = 'table' if looks_table else ('date-dense' if date_dense(txt) else 'prose')
            src['kind'] = 'reference text (#4763 rule; | or <table> → table)'
    elif r.get('stored_ocr'):
        s, c = census(r['stored_ocr'])
        if s: lab['script_silver'] = s; src['script_silver'] = 'stored OCR Unicode census (silver: training only)'
    if r['set'] == 'dd4763': lab['leaves'] = 1; src['leaves'] = 'Internet Archive per-leaf image (by construction)'
    if r['set'] == 'check':
        f = os.path.join(checkdir, r['uid'].replace(':', '_') + '.json')
        if os.path.exists(f):
            j = json.load(open(f))
            lab = {'script': j.get('script'), 'kind': j.get('kind'), 'leaves': j.get('leaves'), 'confidence': j.get('confidence'), 'note': j.get('note')}
            src = {k: j['labelled_by'] for k in ('script', 'kind', 'leaves')}
    out.append({**{k: r.get(k) for k in ('uid', 'set', 'stratum', 'book_id', 'page_id', 'page_number', 'image_url', 'catalogue_language', 'year')},
                'labels': lab, 'label_src': src})
with open(outp, 'w') as f:
    for o in out: f.write(json.dumps(o, ensure_ascii=False) + '\n')
for h in ('script', 'script_silver', 'kind', 'leaves'):
    print(h, collections.Counter((o['set'], o['labels'].get(h)) for o in out if o['labels'].get(h) is not None).most_common())
