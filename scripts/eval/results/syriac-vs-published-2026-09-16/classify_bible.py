"""Classify each page of a printed Bible scan: a printed Bible runs monotonically, so a page whose aligned span
is out of sequence is a recitation of the wrong passage; a page with plenty of Syriac but no anchor is fabricated text.
usage: classify_bible.py <align-full.jsonl> <pages.jsonl> <corpus NT|OT> <out.tsv>"""
import json, sys, bisect
D = '/Users/dereklomas/sourcelibrary/scratchpad/syriac-vs-published'
alignf, pagesf, corpus, outf = sys.argv[1:5]
NT = ['Matthew', 'Mark', 'Luke', 'John', 'Acts', 'James', '1_Peter', '1_John', 'Romans', '1_Corinthians', '2_Corinthians',
      'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1_Thessalonians', '2_Thessalonians', '1_Timothy', '2_Timothy',
      'Titus', 'Philemon', 'Hebrews', '2_Peter', '2_John', '3_John', 'Jude', 'Revelation']
OT = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', 'Samuel_1', 'Samuel_2', 'Kings_1',
      'Kings_2', 'Chronicles_1', 'Chronicles_2', 'Ezra', 'Nehemia', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes',
      'Song_of_Songs', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah',
      'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi']
order = {b: i for i, b in enumerate(NT + OT)}
verses = []
for l in open(f'{D}/ref/peshitta-verses.jsonl'):
    d = json.loads(l)
    verses.append((order.get(d['b'], 999), d['ch'], d['v'], d['c'], f"{d['b']} {d['ch']}:{d['v']}"))
verses.sort()
idx = {v[4]: i for i, v in enumerate(verses)}
corp = {v[4]: v[3] for v in verses}
pages = {json.loads(l)['pn']: json.loads(l) for l in open(pagesf)}
rows = [json.loads(l) for l in open(alignf)]
for r in rows:
    if r['aligned']:
        a = r['span'].split(' .. ')[0]; r['gi'] = idx[a]; r['corp'] = corp[a]
seq = sorted((r for r in rows if r['aligned'] and r['corp'] == corpus), key=lambda r: r['pn'])
tails, prev, tailidx = [], [None] * len(seq), []
for i, r in enumerate(seq):
    g = r['gi']; k = bisect.bisect_left(tails, g)
    if k == len(tails): tails.append(g); tailidx.append(i)
    else: tails[k] = g; tailidx[k] = i
    prev[i] = tailidx[k - 1] if k > 0 else None
lis = set(); i = tailidx[-1] if tailidx else None
while i is not None: lis.add(seq[i]['pn']); i = prev[i]
chain = sorted((r['pn'], r['gi']) for r in seq if r['pn'] in lis)
def expected(pn):
    ks = [c[0] for c in chain]; k = bisect.bisect_left(ks, pn)
    if k == 0: return chain[0][1]
    if k == len(chain): return chain[-1][1]
    (p0, g0), (p1, g1) = chain[k - 1], chain[k]
    return g0 + (g1 - g0) * (pn - p0) / max(p1 - p0, 1)
TOL = 120
cls = {}
for r in rows:
    pn = r['pn']
    if not r['aligned']:
        c = 'F-too-few-syriac' if r.get('why') == 'too-few-syriac-words' else 'E-fabricated-unaligned'
    elif r['corp'] != corpus or abs(r['gi'] - expected(pn)) > TOL:
        c = 'D-wrong-passage'
    elif r['cer'] <= 0.10: c = 'A-right-passage-cer<=10'
    elif r['cer'] <= 0.50: c = 'B-right-passage-cer10-50'
    else: c = 'C-right-passage-cer>50'
    r['cls'] = c; cls[c] = cls.get(c, 0) + 1
with open(outf, 'w') as o:
    o.write('pn\tclass\tspan\tcer\twer\tsyr_words\thas_tr\ttr_head\n')
    for r in sorted(rows, key=lambda r: r['pn']):
        p = pages[r['pn']]
        o.write(f"{r['pn']}\t{r['cls']}\t{r.get('span', '')}\t{r.get('cer', '')}\t{r.get('wer', '')}\t{r['syr_words']}\t{r['has_tr']}\t{(p.get('tr') or '')[:160].replace(chr(9), ' ')}\n")
n = len(rows); print(f'{corpus}: {n} pages; LIS chain length {len(chain)}')
for k in sorted(cls): print(f'  {k:28s} {cls[k]:4d}  {cls[k] / n:5.1%}')
withtext = [r for r in rows if r['cls'] != 'F-too-few-syriac']
bad = [r for r in withtext if r['cls'][0] in 'CDE']
print(f'  pages with Syriac text {len(withtext)}; of these wrong-passage/fabricated/CER>50 = {len(bad)} ({len(bad) / len(withtext):.0%})')
print('  wrong-passage pages:', [(r['pn'], r['span'].split(' .. ')[0]) for r in rows if r['cls'] == 'D-wrong-passage'][:40])
print('  fabricated pages:', [r['pn'] for r in rows if r['cls'] == 'E-fabricated-unaligned'][:40])
